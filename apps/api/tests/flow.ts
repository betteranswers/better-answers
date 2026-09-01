import { createHash, randomBytes } from "node:crypto";

import { decodeJwt } from "jose";
import { expect } from "vitest";
import { z } from "zod";

import {
  CLAUDE_CLIENT_ID,
  CLAUDE_REDIRECT_URI,
  MCP_URL,
  type TestApp,
  type TestClient,
} from "./harness.ts";

/**
 * The host's side of the OAuth flow, replayed exactly as prototype 61 captured
 * claude.ai doing it (`.scratch/v01-spec/prototypes/61-claude-connector/observations/`):
 * CIMD client id, PKCE S256, `resource` on both legs, `prompt=consent`, the person
 * driven through sign-in, the picker and consent as a browser would be, then the code
 * exchanged at the token endpoint. Both test files start from this so the surface is
 * always exercised with a token the real flow minted.
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

const relative = (url: string): string => {
  const parsed = new URL(url, "https://mcp.example.test");
  return `${parsed.pathname}${parsed.search}`;
};

export type Tokens = {
  readonly accessToken: string;
  readonly refreshToken: string | undefined;
  readonly expiresIn: number;
  readonly claims: Readonly<Record<string, unknown>>;
};

/** Sign the person in on this client: the email step, then the code from the captured email. */
export const signIn = async (
  app: TestApp,
  client: TestClient,
  email: string,
  query: string,
): Promise<Response> => {
  const asked = await client.form(`/sign-in${query}`, { step: "email", email });
  expect(asked.status).toBe(200);
  const code = app.codeSentTo(email);
  return client.form(`/sign-in${query}`, { step: "code", email, code });
};

/**
 * The whole dance, from the authorize request to the tokens. `pick` names the
 * workspace to choose when the picker appears; a single-membership person never sees it.
 */
export const connectAsHost = async (
  app: TestApp,
  client: TestClient,
  person: { readonly email: string },
  options: { readonly scope?: string; readonly pick?: string } = {},
): Promise<Tokens & { readonly code: string; readonly callback: URL }> => {
  const { verifier, challenge } = pkce();
  const scope = options.scope ?? "knowledge:read feedback:write offline_access";

  // 1. The host sends the person to authorize; with no session that is the sign-in page.
  let step = await client.fetch(authorizeUrl({ challenge, scope }), { redirect: "manual" });
  expect(step.status).toBe(302);
  let next = relative(location(step));
  expect(next.startsWith("/sign-in?")).toBe(true);

  // 2. The person signs in with a code; the flow resumes at /oauth2/authorize.
  step = await signIn(app, client, person.email, next.slice("/sign-in".length));
  expect(step.status).toBe(302);
  next = relative(location(step));
  expect(next.startsWith("/oauth2/authorize?")).toBe(true);
  step = await client.fetch(next, { redirect: "manual" });
  expect(step.status).toBe(302);
  next = relative(location(step));

  // 3. The picker, only for a person in more than one workspace.
  if (next.startsWith("/choose-workspace?")) {
    const page = await client.fetch(next);
    expect(page.status).toBe(200);
    const workspaceId = options.pick;
    if (workspaceId === undefined)
      throw new Error("the picker appeared but no workspace was named to pick");
    step = await client.form(`/choose-workspace${next.slice("/choose-workspace".length)}`, {
      workspaceId,
    });
    expect(step.status).toBe(302);
    next = relative(location(step));
    // Better Auth may route through /oauth2/authorize once more before consent.
    if (next.startsWith("/oauth2/authorize?")) {
      step = await client.fetch(next, { redirect: "manual" });
      expect(step.status).toBe(302);
      next = relative(location(step));
    }
  }

  // 4. Consent, in the person's words.
  expect(next.startsWith("/consent?")).toBe(true);
  const consent = await client.fetch(next);
  expect(consent.status).toBe(200);
  step = await client.form(`/consent${next.slice("/consent".length)}`, { accept: "true" });
  expect(step.status).toBe(302);
  const callback = new URL(location(step));
  expect(callback.origin + callback.pathname).toBe(CLAUDE_REDIRECT_URI);
  const code = callback.searchParams.get("code") ?? "";
  expect(code).not.toBe("");

  // 5. The token exchange, `resource` repeated (RFC 8707 on both legs).
  const tokens = await exchange(client, { code, verifier });
  return { ...tokens, code, callback };
};

export const exchange = async (
  client: TestClient,
  params: { readonly code: string; readonly verifier: string },
): Promise<Tokens> => {
  const response = await client.fetch("/oauth2/token", {
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
  client.fetch("/oauth2/token", {
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
