import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CONSENT_WORDS,
  OAUTH_SCOPES,
  REFRESH_TOKEN_LIFETIME_SECONDS,
  REFUSAL_PAGES,
  SEND_EMAIL_CODE_PATH,
  SIGN_IN_PATH,
} from "../src/auth/index.ts";
import {
  authorizeUrl,
  connectAsHost,
  continueAfterPostLogin,
  driveToPage,
  pkce,
  refresh,
  setActiveWorkspace,
  signIn,
} from "./flow.ts";
import {
  APEX_HOSTNAME,
  CLAUDE_CLIENT_ID,
  CLAUDE_REDIRECT_URI,
  KEYED_CLIENT_ID,
  KEYED_CLIENT_JWKS_URI,
  keyedClientAssertion,
  LOOKALIKE_CLIENT_ID,
  MCP_URL,
  PUBLIC_URL,
  startApp,
  type TestApp,
} from "./harness.ts";

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.stop();
});

const json = async <T>(response: Response, shape: z.ZodType<T>): Promise<T> =>
  shape.parse(await response.json());

/** RFC 8414's fields the surface's discovery is held to. */
const authorizationServerMetadata = z.object({
  issuer: z.string(),
  client_id_metadata_document_supported: z.boolean().optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()),
  authorization_response_iss_parameter_supported: z.boolean().optional(),
  code_challenge_methods_supported: z.array(z.string()),
  scopes_supported: z.array(z.string()),
  registration_endpoint: z.string().optional(),
});

/** RFC 9728's fields the protected-resource document is held to. */
const protectedResourceMetadata = z.object({
  resource: z.string(),
  authorization_servers: z.array(z.string()),
  scopes_supported: z.array(z.string()),
});

/** `strictObject`, because the suite asserts the whole answer and nothing more. */
const whoAmI = z.strictObject({ workspaceId: z.string(), userId: z.string(), role: z.string() });

const refusal = z.object({ error: z.string() });

const rotatedTokens = z.object({ refresh_token: z.string() });

/** A page's words as a person reads them: its tags gone and its escapes undone. */
const readOf = (html: string): string =>
  html
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();

/** The page's one link, its address unescaped. */
const linkOn = (html: string): { readonly href: string; readonly label: string } => {
  const [, href = "", label = ""] = /<a href="([^"]*)">([^<]*)<\/a>/.exec(html) ?? [];
  return { href: href.replaceAll("&amp;", "&"), label };
};

type RefusalWords = (typeof REFUSAL_PAGES)[keyof typeof REFUSAL_PAGES];

/** The page says what went wrong, and its last words are the next step. */
const expectRefusalPage = (html: string, said: RefusalWords): void => {
  const read = readOf(html);
  expect(read).toContain(said.title);
  expect(read).toContain(said.why);
  expect(read.slice(-said.next.length)).toBe(said.next);
};

/** Signs `email` in on `client`, then follows `href` on as the sign-in screen does. */
const backThroughSignIn = async (
  client: ReturnType<TestApp["client"]>,
  email: string,
  href: string,
): Promise<URL> => {
  await signIn(app, client, email);
  return continueAfterPostLogin(client, new URL(href, PUBLIC_URL).search);
};

describe("discovery", () => {
  it("advertises CIMD, public token endpoint, iss, S256 and no openid", async () => {
    const metadata = await json(
      await app.client().fetch("/.well-known/oauth-authorization-server"),
      authorizationServerMetadata,
    );

    expect(metadata.issuer).toBe(PUBLIC_URL);
    expect(metadata.client_id_metadata_document_supported).toBe(true);
    expect(metadata.token_endpoint_auth_methods_supported).toContain("none");
    expect(metadata.authorization_response_iss_parameter_supported).toBe(true);
    expect(metadata.code_challenge_methods_supported).toContain("S256");
    expect(metadata.scopes_supported).toEqual([
      "knowledge:read",
      "feedback:write",
      "offline_access",
    ]);
    expect(metadata.scopes_supported).not.toContain("openid");

    expect(metadata.registration_endpoint).toBeUndefined();
  });

  it("serves both protected-resource paths with resource exactly the MCP URL", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const prm = await json(await app.client().fetch(path), protectedResourceMetadata);
      expect(prm.resource).toBe(MCP_URL);
      expect(prm.authorization_servers[0]).toBe(PUBLIC_URL);
      expect(prm.scopes_supported).toEqual(["knowledge:read", "feedback:write"]);
    }
  });

  it("answers an unauthenticated call 401, challenging for every scope", async () => {
    const response = await app.client().fetch("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "find", arguments: {} },
      }),
    });

    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain('scope="knowledge:read feedback:write"');
    expect(challenge).toContain(
      `resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
  });
});

describe("the flow, as claude.ai drives it", () => {
  it("mints a {workspace, user} token bound to the MCP URL", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const started = Date.now();

    const connected = await connectAsHost(app, client, acme.admin);

    expect(connected.callback.searchParams.get("iss")).toBe(PUBLIC_URL);
    expect(connected.callback.searchParams.get("state")).toBe("state-from-the-host");

    expect(connected.expiresIn).toBe(3600);
    expect(connected.claims["iss"]).toBe(PUBLIC_URL);
    expect(connected.claims["aud"]).toBe(MCP_URL);
    expect(connected.claims["workspace"]).toBe(acme.workspaceId);
    expect(connected.claims["user"]).toBe(acme.admin.id);
    expect(connected.claims["role"]).toBeUndefined();
    expect(connected.claims["scope"]).toBe("knowledge:read feedback:write offline_access");

    expect(connected.refreshToken).toBeDefined();

    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("puts a two-workspace person's picked workspace in the token", async () => {
    const one = await app.provision({ name: "One" });
    const two = await app.provision({ name: "Two" });
    await app.addMember(two.workspaceId, one.admin.id, "Viewer");
    const client = app.client();

    const connected = await connectAsHost(app, client, one.admin, { pick: two.workspaceId });

    expect(connected.claims["workspace"]).toBe(two.workspaceId);
    expect(connected.claims["user"]).toBe(one.admin.id);
  });

  it("refuses picking a workspace the person does not belong to", async () => {
    const mine = await app.provision({ name: "Mine" });
    const other = await app.provision({ name: "Other" });
    await app.addMember(other.workspaceId, mine.admin.id, "Editor");
    const stranger = await app.provision({ name: "Stranger" });
    const client = app.client();
    const picker = await driveToPage(app, client, mine.admin);

    expect(`${picker.origin}${picker.pathname}`).toBe(`${PUBLIC_URL}/choose-workspace`);

    const chosen = await setActiveWorkspace(client, stranger.workspaceId);

    expect(chosen.ok).toBe(false);

    const resumed = await continueAfterPostLogin(client, picker.search);
    expect(`${resumed.origin}${resumed.pathname}`).toBe(`${PUBLIC_URL}/choose-workspace`);
  });

  it("holds an unnamed member until named, then goes to consent", async () => {
    const acme = await app.provision({ name: "Unnamed" });
    const unnamed = await app.person(undefined, "");
    await app.addMember(acme.workspaceId, unnamed.id, "Editor");
    const client = app.client();

    const asked = await driveToPage(app, client, unnamed);
    expect(`${asked.origin}${asked.pathname}`).toBe(`${PUBLIC_URL}/choose-workspace`);
    const stillAsked = await continueAfterPostLogin(client, asked.search);
    expect(`${stillAsked.origin}${stillAsked.pathname}`).toBe(`${PUBLIC_URL}/choose-workspace`);

    const given = await client.json("/trpc/person.setDisplayName", { displayName: "Una Named" });
    expect(given.status).toBe(200);

    const resumed = await continueAfterPostLogin(client, asked.search);
    expect(`${resumed.origin}${resumed.pathname}`).toBe(`${PUBLIC_URL}/consent`);
  });

  it("keeps a person with no workspace at an empty picker", async () => {
    const nobody = await app.person();
    const client = app.client();

    const picker = await driveToPage(app, client, nobody);

    expect(`${picker.origin}${picker.pathname}`).toBe(`${PUBLIC_URL}/choose-workspace`);

    const listed = await client.fetch("/organization/list");
    await expect(listed.json()).resolves.toEqual([]);
    const resumed = await continueAfterPostLogin(client, picker.search);
    expect(`${resumed.origin}${resumed.pathname}`).toBe(`${PUBLIC_URL}/choose-workspace`);
  });

  it("activates the workspace on an older session, moving its updated_at", async () => {
    const person = await app.person();
    const client = app.client();

    await driveToPage(app, client, person);
    const beforeUpdatedAt =
      (
        await app.database.superuser.query<{ updated_at: Date }>(
          "SELECT updated_at FROM session WHERE user_id = $1",
          [person.id],
        )
      ).rows[0]?.updated_at.getTime() ?? 0;

    const solo = await app.provision({ name: "Solo" });
    await app.addMember(solo.workspaceId, person.id, "Viewer");

    const { challenge } = pkce();
    const resumed = await client.fetch(
      `${PUBLIC_URL}${authorizeUrl({ challenge, scope: "knowledge:read" })}`,
      { redirect: "manual" },
    );

    expect(resumed.headers.get("location")).toContain("/consent");
    const after = await app.database.superuser.query<{
      active_workspace_id: string | null;
      updated_at: Date;
    }>("SELECT active_workspace_id, updated_at FROM session WHERE user_id = $1", [person.id]);
    expect(after.rows[0]?.active_workspace_id).toBe(solo.workspaceId);
    expect(after.rows[0]?.updated_at.getTime() ?? 0).toBeGreaterThan(beforeUpdatedAt);
  });

  it("redirects an unoffered scope back to the host with iss", async () => {
    const { challenge } = pkce();

    const response = await app
      .client()
      .fetch(authorizeUrl({ challenge, scope: "knowledge:read admin:everything" }), {
        redirect: "manual",
      });

    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("location") ?? "");
    expect(target.origin + target.pathname).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(target.searchParams.get("error")).toBe("invalid_scope");
    expect(target.searchParams.get("iss")).toBe(PUBLIC_URL);
  });

  it("refuses a non-claude.ai metadata document without ever fetching it", async () => {
    const { challenge } = pkce();
    const asked = app.metadataFetches.length;

    const response = await app
      .client()
      .fetch(authorizeUrl({ challenge, scope: "knowledge:read", clientId: LOOKALIKE_CLIENT_ID }), {
        redirect: "manual",
      });

    expect(response.ok).toBe(false);
    expect(response.headers.get("location") ?? "").not.toContain("code=");
    expect(app.metadataFetches.slice(asked)).toEqual([]);
    const registered = await app.database.superuser.query(
      "SELECT 1 FROM oauth_client WHERE client_id = $1",
      [LOOKALIKE_CLIENT_ID],
    );
    expect(registered.rowCount).toBe(0);
  });

  it("refuses a resource other than the MCP URL", async () => {
    const { challenge } = pkce();

    const response = await app.client().fetch(
      authorizeUrl({
        challenge,
        scope: "knowledge:read",
        resource: "https://elsewhere.example/api",
      }),
      { redirect: "manual" },
    );

    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("location") ?? "");
    expect(target.searchParams.get("error")).toBe("invalid_target");
  });

  it("fetches a keyed client's jwks_uri through the metadata fetcher", async () => {
    const asked = app.metadataFetches.length;
    const tokenEndpoint = `${PUBLIC_URL}/oauth2/token`;

    const response = await app.client().fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "no-such-code",
        redirect_uri: CLAUDE_REDIRECT_URI,
        client_id: KEYED_CLIENT_ID,
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await keyedClientAssertion(tokenEndpoint),
        code_verifier: pkce().verifier,
        resource: MCP_URL,
      }).toString(),
    });

    expect(app.metadataFetches.slice(asked)).toEqual([KEYED_CLIENT_ID, KEYED_CLIENT_JWKS_URI]);
    expect(await json(response, refusal)).toEqual({ error: "invalid_grant" });
  });
});

describe("the pages, as a person walks them", () => {
  const consentPostedAfter = async (
    endTheirStanding: (workspace: Awaited<ReturnType<typeof app.provision>>) => Promise<void>,
  ): Promise<Response> => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const consent = await driveToPage(app, client, acme.admin);
    await endTheirStanding(acme);
    return client.form(`/consent${consent.search}`, { accept: "true" });
  };

  it("takes a one-workspace person straight to consent, with no picker", async () => {
    const acme = await app.provision({ name: "Only" });
    const client = app.client();

    const next = await driveToPage(app, client, acme.admin);

    expect(next.pathname).toBe("/consent");
    const me = await json(await client.fetch("/me"), whoAmI);
    expect(me).toMatchObject({ workspaceId: acme.workspaceId, role: "Admin" });
  });

  it("names every scope in the person's words, staying connected included", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const consent = await driveToPage(
      app,
      client,
      acme.admin,
      "knowledge:read feedback:write offline_access",
    );

    const page = readOf(await (await client.fetch(`${consent.pathname}${consent.search}`)).text());

    for (const scope of OAUTH_SCOPES) expect(page).toContain(CONSENT_WORDS.scopes[scope]);
    expect(page).toContain(CONSENT_WORDS.actsAs("Claude", "Acme"));
  });

  it("shows the client's real address and where Connect goes", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const consent = await driveToPage(app, client, acme.admin);

    const page = readOf(await (await client.fetch(`${consent.pathname}${consent.search}`)).text());

    expect(page).toContain(CONSENT_WORDS.hostedAt("Claude", new URL(CLAUDE_CLIENT_ID).hostname));
    expect(page).toContain(CONSENT_WORDS.goesNext(new URL(CLAUDE_REDIRECT_URI).hostname));
  });

  it("refuses consent after credentials are revoked, minting no code", async () => {
    const decided = await consentPostedAfter((acme) =>
      app.revokeCredentials(acme.admin.id, new Date(Date.now() + 1_000)),
    );

    expect(decided.status).toBe(401);
    expect(decided.headers.get("location")).toBeNull();
    expectRefusalPage(await decided.text(), REFUSAL_PAGES.sessionEnded);
  });

  it("returns an ended session through sign-in to the connection", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const consent = await driveToPage(app, client, acme.admin);
    await app.database.superuser.query("DELETE FROM session WHERE user_id = $1", [acme.admin.id]);

    const refused = await client.form(`/consent${consent.search}`, { accept: "true" });

    expect(refused.status).toBe(401);
    const page = await refused.text();
    const link = linkOn(page);
    expect(link).toEqual({
      href: `${SIGN_IN_PATH}${consent.search}`,
      label: REFUSAL_PAGES.sessionEnded.next,
    });
    const back = await backThroughSignIn(client, acme.admin.email, link.href);
    expect(`${back.origin}${back.pathname}`).toBe(`${PUBLIC_URL}/consent`);
    const connected = await client.form(`/consent${back.search}`, { accept: "true" });
    const callback = new URL(connected.headers.get("location") ?? "", PUBLIC_URL);
    expect(`${callback.origin}${callback.pathname}`).toBe(CLAUDE_REDIRECT_URI);
    expect(callback.searchParams.get("code")).not.toBeNull();
  });

  it("returns a signed-out person through sign-in to consent", async () => {
    const acme = await app.provision({ name: "Acme" });
    const consent = await driveToPage(app, app.client(), acme.admin);
    const signedOut = app.client();

    const refused = await signedOut.fetch(`${consent.pathname}${consent.search}`);

    expect(refused.status).toBe(401);
    const page = await refused.text();
    expectRefusalPage(page, REFUSAL_PAGES.signInFirst);
    const link = linkOn(page);
    expect(link).toEqual({
      href: `${SIGN_IN_PATH}${consent.search}`,
      label: REFUSAL_PAGES.signInFirst.next,
    });
    const back = await backThroughSignIn(signedOut, acme.admin.email, link.href);
    expect(`${back.origin}${back.pathname}`).toBe(`${PUBLIC_URL}/consent`);
  });

  it("tells a person whose connection failed to start again", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const consent = await driveToPage(app, client, acme.admin);
    const forged = new URLSearchParams(consent.search);
    forged.set("sig", "forged");

    const failed = await client.form(`/consent?${forged.toString()}`, { accept: "true" });

    expect(failed.status).toBe(400);
    expect(failed.headers.get("location")).toBeNull();
    expectRefusalPage(await failed.text(), REFUSAL_PAGES.notCompleted);
  });

  it("mints no code when membership ends before the person consents", async () => {
    const decided = await consentPostedAfter((acme) =>
      app.removeMember(acme.workspaceId, acme.admin.id),
    );

    expect(decided.status).toBe(401);
    expect(decided.headers.get("location")).toBeNull();
  });

  it("refuses to be framed by another site", async () => {
    const consentClient = app.client();
    const consent = await driveToPage(
      app,
      consentClient,
      (await app.provision({ name: "Lone" })).admin,
    );
    expect(consent.pathname).toBe("/consent");

    const page = await consentClient.fetch(`${consent.pathname}${consent.search}`);

    expect(page.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("the pages refuse a cross-site form", () => {
  it("refuses cross-origin consent despite the person's cookie, minting no code", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const consent = await driveToPage(app, client, acme.admin);
    expect(consent.pathname).toBe("/consent");

    const crossSite = await client.fetch(`${consent.pathname}${consent.search}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
      body: new URLSearchParams({ accept: "true" }).toString(),
    });

    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.get("location")).toBeNull();
    expectRefusalPage(await crossSite.text(), REFUSAL_PAGES.crossSite);
  });

  it("refuses consent posted by a same-origin fetch, minting no code", async () => {
    /* jscpd:ignore-start */
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const consent = await driveToPage(app, client, acme.admin);
    expect(consent.pathname).toBe("/consent");
    /* jscpd:ignore-end */
    const before = await app.database.superuser.query(
      "SELECT count(*)::int AS n FROM oauth_consent",
    );

    const fetched = await client.fetch(`${consent.pathname}${consent.search}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: PUBLIC_URL,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
      },
      body: new URLSearchParams({ accept: "true" }).toString(),
    });

    expect(fetched.status).toBe(403);
    expect(fetched.headers.get("location")).toBeNull();
    expectRefusalPage(await fetched.text(), REFUSAL_PAGES.notNavigated);
    const after = await app.database.superuser.query(
      "SELECT count(*)::int AS n FROM oauth_consent",
    );
    expect(after.rows[0]).toEqual(before.rows[0]);

    const navigated = await client.form(`${consent.pathname}${consent.search}`, {
      accept: "true",
    });
    expect(navigated.status).toBe(302);
    expect(
      new URL(navigated.headers.get("location") ?? "").searchParams.get("code"),
    ).not.toBeNull();
  });

  it("refuses consent posted without Fetch Metadata, unlike any browser navigation", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const consent = await driveToPage(app, client, acme.admin);

    const bare = await client.fetch(`${consent.pathname}${consent.search}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: PUBLIC_URL },
      body: new URLSearchParams({ accept: "true" }).toString(),
    });

    expect(bare.status).toBe(403);
    expect(bare.headers.get("location")).toBeNull();
  });

  it("refuses a cross-origin code request, so sites cannot start sign-ins", async () => {
    const response = await app.client().fetch("/email-otp/send-verification-otp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        cookie: "__Secure-better-auth.session_token=someone-elses",
      },
      body: JSON.stringify({ email: "victim@example.invalid", type: "sign-in" }),
    });

    expect(response.ok).toBe(false);
    expect(app.emails.some((message) => message.to === "victim@example.invalid")).toBe(false);
  });
});

describe("one origin, one session", () => {
  it("sets a host-only, Secure-prefixed session cookie, never an apex one", async () => {
    const acme = await app.provision({ name: "Host-only" });
    const client = app.client();

    const signedIn = await signIn(app, client, acme.admin.email);

    const cookies = signedIn.headers.getSetCookie();
    const session = cookies.find((cookie) => cookie.startsWith("__Secure-"));
    expect(session).toBeDefined();
    expect(session).toContain("session_token=");
    expect(session).toContain("HttpOnly");
    expect(session).toContain("Secure");
    for (const cookie of cookies) {
      expect(cookie).not.toMatch(/;\s*Domain=/i);
      expect(cookie).not.toContain(APEX_HOSTNAME);
    }

    const me = await client.fetch(`${PUBLIC_URL}/me`);
    expect(me.status).toBe(200);
  });

  it("keeps a new session signed in over an ended one", async () => {
    const acme = await app.provision({ name: "Ended" });
    const client = app.client();
    await signIn(app, client, acme.admin.email);
    await app.database.superuser.query("DELETE FROM session WHERE user_id = $1", [acme.admin.id]);

    await signIn(app, client, acme.admin.email);

    const me = await client.fetch(`${PUBLIC_URL}/me`);
    expect(me.status).toBe(200);
  });

  it("sends a sessionless person to sign-in, carrying the signed query", async () => {
    const { challenge } = pkce();

    const start = await app
      .client()
      .fetch(authorizeUrl({ challenge, scope: "knowledge:read" }), { redirect: "manual" });

    const sent = new URL(start.headers.get("location") ?? "", PUBLIC_URL);
    expect(`${sent.origin}${sent.pathname}`).toBe(`${PUBLIC_URL}/sign-in`);

    expect(sent.searchParams.get("sig")).not.toBeNull();
    expect(sent.searchParams.get("client_id")).toBe(CLAUDE_CLIENT_ID);
  });

  it("answers the resume with an absolute address on the origin", async () => {
    const two = await app.provision({ name: "Second" });
    const one = await app.provision({ name: "First" });
    await app.addMember(two.workspaceId, one.admin.id, "Viewer");
    const client = app.client();
    const picker = await driveToPage(app, client, one.admin);
    await setActiveWorkspace(client, two.workspaceId);

    const next = await continueAfterPostLogin(client, picker.search);

    expect(`${next.origin}${next.pathname}`).toBe(`${PUBLIC_URL}/consent`);
  });

  it("refuses a cross-origin post that carries the person's cookie", async () => {
    const acme = await app.provision({ name: "Cross" });
    const client = app.client();
    await signIn(app, client, acme.admin.email);

    for (const [path, body] of [
      ["/organization/set-active", { organizationId: acme.workspaceId }],
      ["/oauth2/continue", { postLogin: true, oauth_query: "sig=whatever" }],
    ] as const) {
      const refused = await client.fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify(body),
      });

      expect(refused.status, `${path} answered ${refused.status}`).toBe(403);
    }
  });
});

describe("the cookie session, through the same resolver", () => {
  it("answers /me with the member row's workspace, person and role", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    await connectAsHost(app, client, acme.admin);

    const me = await json(await client.fetch("/me"), whoAmI);

    expect(me).toEqual({ workspaceId: acme.workspaceId, userId: acme.admin.id, role: "Admin" });
  });

  it("refuses /me without a session and after credentials are revoked", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    expect((await client.fetch("/me")).status).toBe(401);

    await connectAsHost(app, client, acme.admin);
    expect((await client.fetch("/me")).status).toBe(200);
    await app.revokeCredentials(acme.admin.id, new Date(Date.now() + 1_000));

    const refused = await client.fetch("/me");

    expect(refused.status).toBe(401);

    expect((await json(refused, refusal)).error).toMatch(/^(not_signed_in|credentials-revoked)$/);
  });
});

describe("refresh and revocation", () => {
  it("gives a rotated refresh token ninety days, refusing the old", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const connected = await connectAsHost(app, client, acme.admin);
    const first = connected.refreshToken ?? "";

    const refreshed = await refresh(client, first);
    expect(refreshed.status).toBe(200);
    const rotated = await json(refreshed, rotatedTokens);
    expect(rotated.refresh_token).not.toBe(first);

    const rows = await app.database.superuser.query<{ expires_at: Date; revoked: Date | null }>(
      "SELECT expires_at, revoked FROM oauth_refresh_token WHERE user_id = $1 AND revoked IS NULL ORDER BY created_at DESC LIMIT 1",
      [acme.admin.id],
    );
    const lifetimeSeconds = (rows.rows[0]?.expires_at.getTime() ?? 0) / 1000 - Date.now() / 1000;
    expect(Math.abs(lifetimeSeconds - REFRESH_TOKEN_LIFETIME_SECONDS)).toBeLessThan(120);

    const replayed = await refresh(client, first);
    expect(replayed.status).toBe(400);
    expect((await json(replayed, refusal)).error).toBe("invalid_grant");
    const family = await refresh(client, rotated.refresh_token);
    expect(family.status).toBe(400);
  });

  it("revokes a refresh token, which then cannot be exchanged", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const connected = await connectAsHost(app, client, acme.admin);
    const token = connected.refreshToken ?? "";

    const revoked = await client.fetch("/oauth2/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token,
        token_type_hint: "refresh_token",
        client_id: CLAUDE_CLIENT_ID,
      }).toString(),
    });
    expect(revoked.status).toBe(200);

    const after = await refresh(client, token);
    expect(after.status).toBe(400);
  });
});

describe("the audit logs", () => {
  it("logs picks and token events, not sign-ins or secrets", async () => {
    const one = await app.provision({ name: "Logged" });
    const two = await app.provision({ name: "Logged too" });
    await app.addMember(two.workspaceId, one.admin.id, "Viewer");
    const client = app.client();
    const before = app.logs.length;
    const connected = await connectAsHost(app, client, one.admin, { pick: two.workspaceId });
    const rotated = await json(await refresh(client, connected.refreshToken ?? ""), rotatedTokens);
    const current = rotated.refresh_token;
    await client.fetch("/oauth2/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: current, client_id: CLAUDE_CLIENT_ID }).toString(),
    });

    const events = app.logs.slice(before).filter((line) => line["module"] === "auth");
    const byEvent = (name: string) => events.filter((line) => line["event"] === name);

    expect(byEvent("auth.sign_in")).toEqual([]);
    expect(byEvent("auth.workspace_pick")).toMatchObject([
      { principal: one.admin.id, workspace: two.workspaceId, outcome: "ok" },
    ]);
    expect(byEvent("auth.consent")).toEqual([]);
    expect(byEvent("auth.token_issue")).toMatchObject([
      {
        principal: one.admin.id,
        workspace: two.workspaceId,
        client_id: CLAUDE_CLIENT_ID,
        outcome: "ok",
      },
    ]);
    expect(byEvent("auth.token_refresh")).toMatchObject([
      { principal: one.admin.id, workspace: two.workspaceId, outcome: "ok" },
    ]);
    expect(byEvent("auth.revocation")).toMatchObject([
      { client_id: CLAUDE_CLIENT_ID, outcome: "ok" },
    ]);

    const everything = JSON.stringify(app.logs.slice(before));
    expect(everything).not.toContain(connected.accessToken);
    expect(everything).not.toContain(connected.refreshToken ?? "never");
    expect(everything).not.toContain(current);
    expect(everything).not.toContain(app.codeSentTo(one.admin.email));
  });
});

describe("the limits", () => {
  /**
   * The windows are wall-clock aligned, so a loop may straddle a boundary; 2·max + 1 puts
   * max + 1 into one window.
   */
  const untilRefused = async (send: () => Promise<Response>, max: number): Promise<number[]> => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 2 * max + 1; attempt += 1) statuses.push((await send()).status);
    return statuses;
  };

  it("keys the page limit on CF-Connecting-IP alone, ignoring spoofed X-Forwarded-For", async () => {
    const client = app.client("203.0.113.10");
    let spoof = 0;

    const statuses = await untilRefused(
      () =>
        client.fetch("/consent", { headers: { "x-forwarded-for": `203.0.113.${(spoof += 1)}` } }),
      30,
    );

    expect(statuses).toContain(429);

    const other = await app
      .client("203.0.113.11")
      .fetch("/consent", { headers: { "x-forwarded-for": "203.0.113.1" } });
    expect(other.status).not.toBe(429);
  });

  it("throttles codes per email across addresses", async () => {
    const email = `throttled-${Date.now()}@example.invalid`;
    let address = 20;

    const statuses = await untilRefused(
      () =>
        app
          .client(`203.0.113.${(address += 1)}`)
          .json(SEND_EMAIL_CODE_PATH, { email, type: "sign-in" }),
      5,
    );

    expect(statuses).toContain(429);
    expect(app.emails.filter((message) => message.to === email).length).toBeLessThanOrEqual(10);
  });

  it("lets Better Auth's database limiter refuse an email-code flood", async () => {
    const client = app.client("203.0.113.40");
    let attempt = 0;

    const statuses = await untilRefused(
      () =>
        client.fetch("/email-otp/send-verification-otp", {
          method: "POST",
          headers: { "content-type": "application/json", origin: PUBLIC_URL },
          body: JSON.stringify({
            email: `flood-${(attempt += 1)}@example.invalid`,
            type: "sign-in",
          }),
        }),
      5,
    );

    expect(statuses).toContain(429);
    const stored = await app.database.superuser.query("SELECT count(*)::int AS n FROM rate_limit");
    expect(Number(stored.rows[0]?.n)).toBeGreaterThan(0);
  });
});
