import { createHash, randomBytes } from "node:crypto";

import { decodeJwt } from "jose";
import { expect } from "vitest";
import { z } from "zod";

import {
  CLAUDE_CLIENT_ID,
  CLAUDE_REDIRECT_URI,
  MCP_URL,
  PUBLIC_URL,
  type TestApp,
  type TestClient,
} from "./harness.ts";

export type Pkce = { readonly verifier: string; readonly challenge: string };

export const pkce = (): Pkce => {
  const verifier = randomBytes(64).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

/** A path on the public origin; the client defaults to Claude, the resource to the MCP surface. */
export const authorizeUrl = (params: {
  readonly challenge: string;
  readonly scope: string;
  readonly state?: string;
  readonly resource?: string;

  readonly clientId?: string;
  readonly prompt?: string;
}): string => {
  const query = new URLSearchParams({
    client_id: params.clientId ?? CLAUDE_CLIENT_ID,
    redirect_uri: CLAUDE_REDIRECT_URI,
    response_type: "code",
    code_challenge: params.challenge,
    code_challenge_method: "S256",
    resource: params.resource ?? MCP_URL,
    prompt: params.prompt ?? "consent",
    scope: params.scope,
    state: params.state ?? "state-from-the-host",
  });
  return `/oauth2/authorize?${query.toString()}`;
};

const location = (response: Response): string => {
  const header = response.headers.get("location");
  expect(header).not.toBeNull();
  return header ?? "";
};

/* jscpd:ignore-start */
const redirectOf = z.object({
  url: z.string().min(1).optional(),
  redirect: z.boolean().optional(),
});

const nextLocation = async (response: Response): Promise<string | undefined> => {
  const header = response.headers.get("location");
  if (header !== null) return header;
  const parsed = redirectOf.safeParse(
    await response
      .clone()
      .json()
      .catch(() => undefined),
  );
  return parsed.success ? parsed.data.url : undefined;
};
/* jscpd:ignore-end */

const sentTo = (response: Response): URL => new URL(location(response), PUBLIC_URL);

const carried = (url: URL): string => url.search;

export type Tokens = {
  readonly accessToken: string;
  readonly refreshToken: string | undefined;
  readonly expiresIn: number;
  /** Decoded from the access token, never verified. */
  readonly claims: Readonly<Record<string, unknown>>;
};

/** Signs `client` in by the emailed code, failing the test unless both steps answer 200. */
export const signIn = async (
  app: TestApp,
  client: TestClient,
  email: string,
): Promise<Response> => {
  const asked = await client.json("/email-otp/send-verification-otp", {
    email,
    type: "sign-in",
  });
  expect(asked.status).toBe(200);
  const code = app.codeSentTo(email);
  const signedIn = await client.json("/sign-in/email-otp", { email, otp: code });
  expect(signedIn.status).toBe(200);
  return signedIn;
};

export const setActiveWorkspace = async (
  client: TestClient,
  workspaceId: string,
): Promise<Response> => client.json("/organization/set-active", { organizationId: workspaceId });

/** `query` is the authorize request's search string. Fails the test when no next step is named. */
export const continueAfterPostLogin = async (client: TestClient, query: string): Promise<URL> => {
  const continued = await client.json("/oauth2/continue", {
    postLogin: true,
    oauth_query: query.replace(/^\?/, ""),
  });
  const next = await nextLocation(continued);
  expect(
    next,
    `the continue endpoint answered ${continued.status} with no next step`,
  ).toBeDefined();
  return new URL(next ?? "", PUBLIC_URL);
};

/** Where the authorize request, resumed once `person` has signed in, sends the browser. */
export const driveToPage = async (
  app: TestApp,
  client: TestClient,
  person: { readonly email: string },
  scope = "knowledge:read",
): Promise<URL> => {
  const { challenge } = pkce();
  const start = await client.fetch(`${PUBLIC_URL}${authorizeUrl({ challenge, scope })}`, {
    redirect: "manual",
  });
  const query = carried(sentTo(start));
  await signIn(app, client, person.email);

  const resumed = await client.fetch(`${PUBLIC_URL}/oauth2/authorize${query}`, {
    redirect: "manual",
  });
  return sentTo(resumed);
};

/**
 * Connects as Claude does: authorize, sign in, `pick` the active workspace if given, consent and
 * exchange. Fails the test at a step that strays.
 */
export const connectAsHost = async (
  app: TestApp,
  client: TestClient,
  person: { readonly email: string },
  options: { readonly scope?: string; readonly pick?: string } = {},
): Promise<Tokens & { readonly code: string; readonly callback: URL }> => {
  const { verifier, challenge } = pkce();
  const scope = options.scope ?? "knowledge:read feedback:write offline_access";

  let step = await client.fetch(`${PUBLIC_URL}${authorizeUrl({ challenge, scope })}`, {
    redirect: "manual",
  });
  expect(step.status).toBe(302);
  let next = sentTo(step);
  expect(`${next.origin}${next.pathname}`).toBe(`${PUBLIC_URL}/sign-in`);
  const query = carried(next);

  await signIn(app, client, person.email);

  if (options.pick !== undefined) {
    const picked = await setActiveWorkspace(client, options.pick);
    expect(picked.status).toBe(200);
  }

  next = await continueAfterPostLogin(client, query);
  expect(`${next.origin}${next.pathname}`).toBe(`${PUBLIC_URL}/consent`);

  const consent = await client.fetch(next.href);
  expect(consent.status).toBe(200);
  step = await client.form(`${PUBLIC_URL}/consent${next.search}`, { accept: "true" });
  expect(step.status).toBe(302);
  const callback = new URL(location(step));
  expect(callback.origin + callback.pathname).toBe(CLAUDE_REDIRECT_URI);
  const code = callback.searchParams.get("code") ?? "";
  expect(code).not.toBe("");

  const tokens = await exchange(client, { code, verifier });
  return { ...tokens, code, callback };
};

const exchange = async (
  client: TestClient,
  params: { readonly code: string; readonly verifier: string },
): Promise<Tokens> => {
  const response = await client.fetch(`${PUBLIC_URL}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: CLAUDE_REDIRECT_URI,
      client_id: CLAUDE_CLIENT_ID,
      code_verifier: params.verifier,
      resource: MCP_URL,
    }).toString(),
  });
  expect(response.status).toBe(200);
  return tokensOf(await response.json());
};

export const refresh = async (client: TestClient, refreshToken: string): Promise<Response> =>
  client.fetch(`${PUBLIC_URL}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLAUDE_CLIENT_ID,
      resource: MCP_URL,
    }).toString(),
  });

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.coerce.number(),
});

const tokensOf = (body: unknown): Tokens => {
  const parsed = tokenResponse.parse(body);
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresIn: parsed.expires_in,
    claims: decodeJwt(parsed.access_token),
  };
};
