import { createHash, randomBytes } from "node:crypto";

import { decodeJwt } from "jose";
import { expect } from "vitest";
import { z } from "zod";

import {
  APP_URL,
  CLAUDE_CLIENT_ID,
  CLAUDE_REDIRECT_URI,
  MCP_URL,
  PUBLIC_URL,
  type TestApp,
  type TestClient,
} from "./harness.ts";

/**
 * The host's side of the OAuth flow, replayed exactly as prototype 61 captured
 * claude.ai doing it (`.scratch/v01-spec/prototypes/61-claude-connector/observations/`):
 * CIMD client id, PKCE S256, `resource` on both legs, `prompt=consent`, the person
 * driven through sign-in, the pick and consent as a browser would be, then the code
 * exchanged at the token endpoint. Both test files start from this so the surface is
 * always exercised with a token the real flow minted.
 *
 * Since T-037 the middle of that walk is the SPA's, so this file drives what the SPA
 * drives: the two email-code endpoints, `/organization/set-active` and `/oauth2/continue`,
 * posted as JSON from the `app.` origin with one cookie jar across both hostnames — which
 * is what a browser has. Only consent is still a form on a page this tier renders. The
 * screens themselves are held by `apps/web/e2e`; what is held here is the protocol.
 */

export type Pkce = { readonly verifier: string; readonly challenge: string };

export const pkce = (): Pkce => {
  const verifier = randomBytes(64).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

export const authorizeUrl = (params: {
  readonly challenge: string;
  readonly scope: string;
  readonly state?: string;
  readonly resource?: string;
}): string => {
  const query = new URLSearchParams({
    client_id: CLAUDE_CLIENT_ID,
    redirect_uri: CLAUDE_REDIRECT_URI,
    response_type: "code",
    code_challenge: params.challenge,
    code_challenge_method: "S256",
    resource: params.resource ?? MCP_URL,
    prompt: "consent",
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

const redirectOf = z.object({
  url: z.string().min(1).optional(),
  redirect: z.boolean().optional(),
});

/**
 * Where a Better Auth endpoint says the person goes next: a 3xx's `Location`, or the
 * `url` in the JSON it answers a caller that asked for JSON — which is what the SPA's
 * client is and so what these helpers are.
 */
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

/** Where a step sent the person, as an absolute URL: the two hostnames are both in play. */
const sentTo = (response: Response): URL => new URL(location(response), PUBLIC_URL);

/** The signed query a flow step carries forward, `?` and all. */
const carried = (url: URL): string => url.search;

export type Tokens = {
  readonly accessToken: string;
  readonly refreshToken: string | undefined;
  readonly expiresIn: number;
  readonly claims: Readonly<Record<string, unknown>>;
};

/**
 * Sign the person in as the SPA's sign-in screen does: ask for a code, then post the one
 * the harness captured. Both are Better Auth's own endpoints, answered on the origin the
 * product is served from, and the second is what sets the session cookie.
 */
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

/** The pick, as the SPA's picker makes it. */
export const setActiveWorkspace = async (
  client: TestClient,
  workspaceId: string,
): Promise<Response> => client.json("/organization/set-active", { organizationId: workspaceId });

/**
 * The resume, as the SPA's picker makes it: Better Auth's continue endpoint, posted from
 * `app.` with the signed query it was carried here with. Answers where the person goes
 * next — consent, on `mcp.`.
 */
export const continueAfterPostLogin = async (client: TestClient, query: string): Promise<URL> => {
  // Relative: the resume is posted from the origin the picker is served on, which is what
  // makes `app.` a trusted origin and `/oauth2/continue` a path `app.` carries.
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

/**
 * Start the flow and sign the person in; answers where the resumed authorize sent
 * them next — the picker, or consent — as a URL on the public origin.
 */
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
  // The signed-in person re-entering authorize: `shouldRedirect` decides between the
  // picker and consent, which is the same decision a person who was already signed in
  // when the host sent them here gets.
  const resumed = await client.fetch(`${PUBLIC_URL}/oauth2/authorize${query}`, {
    redirect: "manual",
  });
  return sentTo(resumed);
};

/**
 * The whole dance, from the authorize request to the tokens, walked the way the product
 * walks it: the host sends the person to authorize, Better Auth sends them to the SPA's
 * sign-in on `app.`, the SPA signs them in and — carrying the signed query the whole way,
 * never stripping it — picks a workspace where there is a choice and resumes through the
 * continue endpoint. `pick` names the workspace; a person in exactly one has it already,
 * set when the session was created.
 */
export const connectAsHost = async (
  app: TestApp,
  client: TestClient,
  person: { readonly email: string },
  options: { readonly scope?: string; readonly pick?: string } = {},
): Promise<Tokens & { readonly code: string; readonly callback: URL }> => {
  const { verifier, challenge } = pkce();
  const scope = options.scope ?? "knowledge:read feedback:write offline_access";

  // 1. The host sends the person to authorize; with no session that is the product's own
  //    sign-in screen, on the product's own origin.
  let step = await client.fetch(`${PUBLIC_URL}${authorizeUrl({ challenge, scope })}`, {
    redirect: "manual",
  });
  expect(step.status).toBe(302);
  let next = sentTo(step);
  expect(`${next.origin}${next.pathname}`).toBe(`${APP_URL}/sign-in`);
  const query = carried(next);

  // 2. The SPA signs the person in with the captured code.
  await signIn(app, client, person.email);

  // 3. The pick, where there is one to make. A person in exactly one workspace has it
  //    active already (the session-creation hook), so the picker never asks them.
  if (options.pick !== undefined) {
    const picked = await setActiveWorkspace(client, options.pick);
    expect(picked.status).toBe(200);
  }

  // 4. The resume, through Better Auth's continue endpoint with the carried signed query.
  next = await continueAfterPostLogin(client, query);
  expect(`${next.origin}${next.pathname}`).toBe(`${PUBLIC_URL}/consent`);

  // 5. Consent, in the person's words, still rendered by this tier on the issuer's origin.
  const consent = await client.fetch(next.href);
  expect(consent.status).toBe(200);
  step = await client.form(`${PUBLIC_URL}/consent${next.search}`, { accept: "true" });
  expect(step.status).toBe(302);
  const callback = new URL(location(step));
  expect(callback.origin + callback.pathname).toBe(CLAUDE_REDIRECT_URI);
  const code = callback.searchParams.get("code") ?? "";
  expect(code).not.toBe("");

  // 6. The token exchange, `resource` repeated (RFC 8707 on both legs).
  const tokens = await exchange(client, { code, verifier });
  return { ...tokens, code, callback };
};

export const exchange = async (
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

export const tokensOf = (body: unknown): Tokens => {
  const parsed = tokenResponse.parse(body);
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresIn: parsed.expires_in,
    claims: decodeJwt(parsed.access_token),
  };
};
