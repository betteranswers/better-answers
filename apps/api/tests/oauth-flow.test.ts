import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { REFRESH_TOKEN_LIFETIME_SECONDS, SEND_EMAIL_CODE_PATH } from "../src/auth/index.ts";
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
  LOOKALIKE_CLIENT_ID,
  MCP_URL,
  PUBLIC_URL,
  startApp,
  type TestApp,
} from "./harness.ts";

/**
 * The OAuth half of research 80 §9's host-agnostic conformance test (assertions
 * 19–24), prototype 61's three silent configuration traps as regressions, the flow
 * driven as a host drives it — sign-in and the pick through the endpoints the SPA posts
 * to, consent through the page this tier still renders (grilling Q5; T-037), all on the
 * one origin (T-045, ADR 0034) — the cookie-session path through the one resolver,
 * refresh rotation and lifetime (Q10), revocation, the audit logs (Q12), the per-IP and
 * per-email limits (Q8), and the closed workspace-creation endpoint (Q11). Every request
 * crosses `server.request` (`[APP3]`).
 */

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
}, 180_000);

afterAll(async () => {
  await app.stop();
});

const json = async (response: Response) =>
  (await response.json()) as Readonly<Record<string, unknown>>;

describe("discovery", () => {
  it("advertises CIMD, a public token endpoint, iss on responses, S256, and no openid (§9 19)", async () => {
    const metadata = await json(
      await app.client().fetch("/.well-known/oauth-authorization-server"),
    );

    expect(metadata["issuer"]).toBe(PUBLIC_URL);
    expect(metadata["client_id_metadata_document_supported"]).toBe(true);
    expect(metadata["token_endpoint_auth_methods_supported"]).toContain("none");
    expect(metadata["authorization_response_iss_parameter_supported"]).toBe(true);
    expect(metadata["code_challenge_methods_supported"]).toContain("S256");
    expect(metadata["scopes_supported"]).toEqual([
      "knowledge:read",
      "feedback:write",
      "offline_access",
    ]);
    expect(metadata["scopes_supported"]).not.toContain("openid");
    // CIMD only (research 80 F2): no registration endpoint is advertised.
    expect(metadata["registration_endpoint"]).toBeUndefined();
  });

  it("serves the protected-resource document at both paths with resource exactly the MCP URL (§9 20)", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const prm = await json(await app.client().fetch(path));
      expect(prm["resource"]).toBe(MCP_URL);
      expect((prm["authorization_servers"] as string[])[0]).toBe(PUBLIC_URL);
      expect(prm["scopes_supported"]).toEqual(["knowledge:read", "feedback:write"]);
    }
  });

  it("answers an unauthenticated call with 401 and a challenge naming the whole surface's scopes (§9 21; trap 3)", async () => {
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
  it("reaches consent with Claude's real authorize shape and mints a {workspace, user} token bound to the MCP URL (§9 22–23; traps 1 and 2)", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const started = Date.now();

    const connected = await connectAsHost(app, client, acme.admin);

    // The success redirect carries iss (RFC 9207) and the host's state.
    expect(connected.callback.searchParams.get("iss")).toBe(PUBLIC_URL);
    expect(connected.callback.searchParams.get("state")).toBe("state-from-the-host");
    // The token: one hour, audience-bound, the workspace claim, no role.
    expect(connected.expiresIn).toBe(3600);
    expect(connected.claims["iss"]).toBe(PUBLIC_URL);
    expect(connected.claims["aud"]).toBe(MCP_URL);
    expect(connected.claims["workspace"]).toBe(acme.workspaceId);
    expect(connected.claims["user"]).toBe(acme.admin.id);
    expect(connected.claims["role"]).toBeUndefined();
    expect(connected.claims["scope"]).toBe("knowledge:read feedback:write offline_access");
    // Trap 1: offline_access was honoured, so a refresh token came back.
    expect(connected.refreshToken).toBeDefined();
    // §9 24: the whole flow, every endpoint, inside the host's ten-second budget.
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("shows the picker to a person in two workspaces and puts the chosen one in the token", async () => {
    const one = await app.provision({ name: "One" });
    const two = await app.provision({ name: "Two" });
    await app.addMember(two.workspaceId, one.admin.id, "Viewer");
    const client = app.client();

    const connected = await connectAsHost(app, client, one.admin, { pick: two.workspaceId });

    expect(connected.claims["workspace"]).toBe(two.workspaceId);
    expect(connected.claims["user"]).toBe(one.admin.id);
  });

  it("refuses a pick of a workspace the person does not belong to", async () => {
    const mine = await app.provision({ name: "Mine" });
    const other = await app.provision({ name: "Other" });
    await app.addMember(other.workspaceId, mine.admin.id, "Editor");
    const stranger = await app.provision({ name: "Stranger" });
    const client = app.client();
    const picker = await driveToPage(app, client, mine.admin);
    // A person with a choice to make is sent to the product's picker, on the one
    // origin, carrying the signed query.
    expect(`${picker.origin}${picker.pathname}`).toBe(`${PUBLIC_URL}/choose-workspace`);

    const chosen = await setActiveWorkspace(client, stranger.workspaceId);

    expect(chosen.ok).toBe(false);
    // And the flow does not move on the back of it: nothing was made active, so the
    // resume sends the person back to the picker rather than on to consent.
    const resumed = await continueAfterPostLogin(client, picker.search);
    expect(`${resumed.origin}${resumed.pathname}`).toBe(`${PUBLIC_URL}/choose-workspace`);
  });

  it("sends a person with no workspace nowhere: nothing to pick, and no token is minted", async () => {
    const nobody = await app.person();
    const client = app.client();

    const picker = await driveToPage(app, client, nobody);

    expect(`${picker.origin}${picker.pathname}`).toBe(`${PUBLIC_URL}/choose-workspace`);
    // What the refused screen reads to decide it has nothing to offer, and where the
    // resume sends a person who asks anyway: back to the picker, never to consent.
    const listed = await client.fetch("/organization/list");
    await expect(listed.json()).resolves.toEqual([]);
    const resumed = await continueAfterPostLogin(client, picker.search);
    expect(`${resumed.origin}${resumed.pathname}`).toBe(`${PUBLIC_URL}/choose-workspace`);
  });

  it("redirects an authorize request for a scope the surface does not offer back to the host with iss (§9 23)", async () => {
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

  it("refuses a client whose metadata document lives anywhere but claude.ai, without ever fetching it", async () => {
    // The closed client list (ADR 0009, 2026-09-02; ADR 0034). The harness serves a
    // look-alike document word for word, so the refusal below is the list's and not a
    // missing document's — and the transport is never asked, so the list is read before
    // the fetch and a refused client leaves no row.
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

  it("refuses an authorize request for a resource that is not the MCP URL (trap 2, RFC 8707)", async () => {
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
});

describe("the pages, as a person walks them", () => {
  it("never shows the picker to a person in exactly one workspace — consent is the next page", async () => {
    const acme = await app.provision({ name: "Only" });
    const client = app.client();

    const next = await driveToPage(app, client, acme.admin);

    expect(next.pathname).toBe("/consent");
    const me = await json(await client.fetch("/me"));
    expect(me).toMatchObject({ workspaceId: acme.workspaceId, role: "Admin" });
  });

  it("names every scope in the person's words on the consent page, staying connected included", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const consent = await driveToPage(
      app,
      client,
      acme.admin,
      "knowledge:read feedback:write offline_access",
    );

    const page = await (await client.fetch(`${consent.pathname}${consent.search}`)).text();

    expect(page).toContain("Read what you can see of the company's knowledge");
    expect(page).toContain("Send your feedback on answers");
    expect(page).toContain("Stay connected until you disconnect it");
    expect(page).toContain("Claude will act as you");
  });

  it("shows the client's real address beside its self-declared name, so a look-alike cannot borrow Claude's", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const consent = await driveToPage(app, client, acme.admin);

    const page = await (await client.fetch(`${consent.pathname}${consent.search}`)).text();

    // The two hostnames a metadata document's author does not choose: where the client id
    // lives and where the code goes (MCP 2026-07-28 authorization; CIMD draft §6).
    expect(page).toContain(`hosted at <strong>${new URL(CLAUDE_CLIENT_ID).hostname}</strong>`);
    expect(page).toContain(`sent to <strong>${new URL(CLAUDE_REDIRECT_URI).hostname}</strong>`);
  });

  it("refuses consent once the person's credentials are revoked, and mints no code", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const consent = await driveToPage(app, client, acme.admin);
    await app.revokeCredentials(acme.admin.id, new Date(Date.now() + 1_000));

    const decided = await client.form(`/consent${consent.search}`, { accept: "true" });

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
  it("refuses consent posted from another origin, even with the person's cookie, and mints no code", async () => {
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
  });

  it("refuses consent posted as a fetch from this origin, even with the person's cookie, and mints no code", async () => {
    // Since T-045 consent shares the product's origin, so a script in the shell can
    // reach it with a `fetch` that carries this origin and the person's cookie — which
    // the same-origin fence above admits. What refuses it is the shape: a fetch is
    // `Sec-Fetch-Dest: empty`, and only a document navigation can follow the redirect
    // the form answers with (ADR 0034; `auth/routes.ts`).
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const consent = await driveToPage(app, client, acme.admin);
    expect(consent.pathname).toBe("/consent");
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
    const after = await app.database.superuser.query(
      "SELECT count(*)::int AS n FROM oauth_consent",
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    // And the same form, as a document navigation from this origin, is the one that
    // works: what the fence reads is the shape of the request and nothing else.
    const navigated = await client.form(`${consent.pathname}${consent.search}`, {
      accept: "true",
    });
    expect(navigated.status).toBe(302);
    expect(
      new URL(navigated.headers.get("location") ?? "").searchParams.get("code"),
    ).not.toBeNull();
  });

  it("refuses consent posted with no Fetch Metadata at all, which no browser navigation is", async () => {
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

  it("refuses a code request from another origin, so no site can start a sign-in for someone", async () => {
    // The screen moved to the SPA, so this fence moved with it: Better Auth's own origin
    // check against the one trusted origin is what refuses it now (`auth.ts`). The check
    // runs on a request that carries a cookie, which is the request that could do harm.
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

describe("one origin, one session (ADR 0034)", () => {
  it("sets a host-only, Secure-prefixed session cookie, and never one scoped to the apex", async () => {
    // Before T-045 the cookie was scoped to the apex so a session made on `app.`
    // answered the flow on `mcp.` — and so was sent to every subdomain of the estate,
    // present and future. On one origin the library's own `__Secure-` host-only cookie
    // is the session, and nothing the response sets names a domain at all.
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
    // The cookie made on the product is the one the authorization server reads.
    const me = await client.fetch(`${PUBLIC_URL}/me`);
    expect(me.status).toBe(200);
  });

  it("sends a person with no session to the product's sign-in, carrying the signed query", async () => {
    const { challenge } = pkce();

    const start = await app
      .client()
      .fetch(authorizeUrl({ challenge, scope: "knowledge:read" }), { redirect: "manual" });

    const sent = new URL(start.headers.get("location") ?? "", PUBLIC_URL);
    expect(`${sent.origin}${sent.pathname}`).toBe(`${PUBLIC_URL}/sign-in`);
    // The signed query is carried whole: the resume is verified against it, and a page
    // that dropped a parameter would break the signature (prototype 61, bug 2).
    expect(sent.searchParams.get("sig")).not.toBeNull();
    expect(sent.searchParams.get("client_id")).toBe(CLAUDE_CLIENT_ID);
  });

  it("answers the resume with an absolute address on the one origin", async () => {
    // The picker reads the answer as a URL and sends the person there; absolute rather
    // than relative because that is what Better Auth was configured with, and the day
    // the two differ again this is the line that says so.
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
    // The two posts the product makes with a session behind them: the pick, and the
    // resume of a host's authorization. The origin check is the whole of what stands
    // between a page an attacker controls and a grant made in the person's name.
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
  it("answers /me with the workspace, the person and the role the member row holds", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    await connectAsHost(app, client, acme.admin);

    const me = await json(await client.fetch("/me"));

    expect(me).toEqual({ workspaceId: acme.workspaceId, userId: acme.admin.id, role: "Admin" });
  });

  it("refuses /me with no session, and after the person's credentials are revoked", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    expect((await client.fetch("/me")).status).toBe(401);

    await connectAsHost(app, client, acme.admin);
    expect((await client.fetch("/me")).status).toBe(200);
    await app.revokeCredentials(acme.admin.id, new Date(Date.now() + 1_000));

    const refused = await client.fetch("/me");

    expect(refused.status).toBe(401);
    // Revocation ends the session itself (the platform's one act), so the person is
    // simply no longer signed in; a session that somehow survived would be refused by
    // the resolver as credentials-revoked. Either way: 401.
    expect((await json(refused))["error"]).toMatch(/^(not_signed_in|credentials-revoked)$/);
  });
});

describe("refresh and revocation", () => {
  it("rotates the refresh token, refuses the old one, and gives the new one ninety days (Q10)", async () => {
    const acme = await app.provision({ name: "Acme" });
    const client = app.client();
    const connected = await connectAsHost(app, client, acme.admin);
    const first = connected.refreshToken ?? "";

    const refreshed = await refresh(client, first);
    expect(refreshed.status).toBe(200);
    const rotated = await json(refreshed);
    expect(rotated["refresh_token"]).toBeDefined();
    expect(rotated["refresh_token"]).not.toBe(first);

    const rows = await app.database.superuser.query<{ expires_at: Date; revoked: Date | null }>(
      "SELECT expires_at, revoked FROM oauth_refresh_token WHERE user_id = $1 AND revoked IS NULL ORDER BY created_at DESC LIMIT 1",
      [acme.admin.id],
    );
    const lifetimeSeconds = (rows.rows[0]?.expires_at.getTime() ?? 0) / 1000 - Date.now() / 1000;
    expect(Math.abs(lifetimeSeconds - REFRESH_TOKEN_LIFETIME_SECONDS)).toBeLessThan(120);

    // A rotated token presented again is a replay: refused, and the whole family with it.
    const replayed = await refresh(client, first);
    expect(replayed.status).toBe(400);
    expect((await json(replayed))["error"]).toBe("invalid_grant");
    const family = await refresh(client, String(rotated["refresh_token"]));
    expect(family.status).toBe(400);
  });

  it("revokes a refresh token so it can no longer be exchanged", async () => {
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

describe("the audit logs (Q12)", () => {
  it("emits sign-in, workspace pick, consent, token issue, refresh and revocation with the audit fields, and never a secret", async () => {
    const one = await app.provision({ name: "Logged" });
    const two = await app.provision({ name: "Logged too" });
    await app.addMember(two.workspaceId, one.admin.id, "Viewer");
    const client = app.client();
    const before = app.logs.length;
    const connected = await connectAsHost(app, client, one.admin, { pick: two.workspaceId });
    const rotated = await json(await refresh(client, connected.refreshToken ?? ""));
    const current = String(rotated["refresh_token"]);
    await client.fetch("/oauth2/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: current, client_id: CLAUDE_CLIENT_ID }).toString(),
    });

    const events = app.logs.slice(before).filter((line) => line["module"] === "auth");
    const byEvent = (name: string) => events.filter((line) => line["event"] === name);

    expect(byEvent("auth.sign_in")).toMatchObject([{ principal: one.admin.id, outcome: "ok" }]);
    expect(byEvent("auth.workspace_pick")).toMatchObject([
      { principal: one.admin.id, workspace: two.workspaceId, outcome: "ok" },
    ]);
    expect(byEvent("auth.consent")).toMatchObject([
      { principal: one.admin.id, client_id: CLAUDE_CLIENT_ID, outcome: "ok" },
    ]);
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
  // The counters are fixed windows aligned to the clock, so a loop may straddle a
  // boundary; 2·max + 1 requests put max + 1 into one window whatever the clock does.
  const untilRefused = async (send: () => Promise<Response>, max: number): Promise<number[]> => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 2 * max + 1; attempt += 1) statuses.push((await send()).status);
    return statuses;
  };

  it("keys the page limit on CF-Connecting-IP alone and ignores a spoofed X-Forwarded-For (Q8)", async () => {
    const client = app.client("198.51.100.10");
    let spoof = 0;

    const statuses = await untilRefused(
      () =>
        client.fetch("/consent", { headers: { "x-forwarded-for": `198.51.100.${(spoof += 1)}` } }),
      30,
    );

    expect(statuses).toContain(429);
    // The same spoofed header from another tunnel address is not limited. The page itself
    // refuses a caller with no session; what matters here is that it is not 429.
    const other = await app
      .client("198.51.100.11")
      .fetch("/consent", { headers: { "x-forwarded-for": "198.51.100.1" } });
    expect(other.status).not.toBe(429);
  });

  it("throttles codes per email across addresses", async () => {
    const email = `throttled-${Date.now()}@example.invalid`;
    let address = 20;

    // Better Auth's own limiter is per address per path, so a sender moving addresses
    // would otherwise post codes at one inbox all day; this counter is the platform's.
    const statuses = await untilRefused(
      () =>
        app
          .client(`198.51.100.${(address += 1)}`)
          .json(SEND_EMAIL_CODE_PATH, { email, type: "sign-in" }),
      5,
    );

    expect(statuses).toContain(429);
    expect(app.emails.filter((message) => message.to === email).length).toBeLessThanOrEqual(10);
  });

  it("lets Better Auth's own database-backed limiter refuse a flood at the email-code endpoint", async () => {
    const client = app.client("198.51.100.40");
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

describe("the three roles through Better Auth's own endpoints", () => {
  const setRole = (client: ReturnType<TestApp["client"]>, memberId: string, role: string) =>
    client.fetch("/organization/update-member-role", {
      method: "POST",
      headers: { "content-type": "application/json", origin: PUBLIC_URL },
      body: JSON.stringify({ memberId, role }),
    });
  const memberIdOf = async (workspaceId: string, userId: string): Promise<string> => {
    const row = await app.database.superuser.query<{ id: string }>(
      "SELECT id FROM member WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, userId],
    );
    return row.rows[0]?.id ?? "";
  };
  const roleOf = async (workspaceId: string, userId: string): Promise<string | undefined> => {
    const row = await app.database.superuser.query<{ role: string }>(
      "SELECT role FROM member WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, userId],
    );
    return row.rows[0]?.role;
  };

  it("lets an Admin change a Viewer to an Editor, and refuses the plugin's own owner role", async () => {
    const acme = await app.provision({ name: "Acme" });
    const viewer = await app.person();
    await app.addMember(acme.workspaceId, viewer.id, "Viewer");
    const client = app.client();
    await connectAsHost(app, client, acme.admin);
    const memberId = await memberIdOf(acme.workspaceId, viewer.id);

    expect((await setRole(client, memberId, "Editor")).status).toBe(200);
    expect(await roleOf(acme.workspaceId, viewer.id)).toBe("Editor");

    const owner = await setRole(client, memberId, "owner");
    expect(owner.status).toBe(400);
    expect((await json(owner))["error"]).toBe("invalid_role");
    expect(await roleOf(acme.workspaceId, viewer.id)).toBe("Editor");
  });

  it("refuses a Viewer who tries to change a role, and refuses every invitation until the People screen ships", async () => {
    const acme = await app.provision({ name: "Acme" });
    const viewer = await app.person();
    await app.addMember(acme.workspaceId, viewer.id, "Viewer");
    const client = app.client();
    await connectAsHost(app, client, viewer);
    const adminMemberId = await memberIdOf(acme.workspaceId, acme.admin.id);

    expect((await setRole(client, adminMemberId, "Viewer")).status).toBe(403);
    expect(await roleOf(acme.workspaceId, acme.admin.id)).toBe("Admin");

    const adminClient = app.client();
    await connectAsHost(app, adminClient, acme.admin);
    const invited = await adminClient.fetch("/organization/invite-member", {
      method: "POST",
      headers: { "content-type": "application/json", origin: PUBLIC_URL },
      body: JSON.stringify({
        email: "invitee@example.invalid",
        role: "Viewer",
        organizationId: acme.workspaceId,
      }),
    });
    expect(invited.status).toBe(501);
    expect(app.emails.some((message) => message.to === "invitee@example.invalid")).toBe(false);
  });
});

describe("workspace creation is the platform's (Q11)", () => {
  it.each(["Viewer", "Admin"] as const)(
    "refuses a signed-in %s who asks Better Auth to create a workspace",
    async (role) => {
      const home = await app.provision({ name: "Home" });
      const person = role === "Admin" ? home.admin : await app.person();
      if (role === "Viewer") await app.addMember(home.workspaceId, person.id, "Viewer");
      const client = app.client();
      await connectAsHost(app, client, person);

      const response = await client.fetch("/organization/create", {
        method: "POST",
        headers: { "content-type": "application/json", origin: PUBLIC_URL },
        body: JSON.stringify({ name: "Self-serve", slug: `self-serve-${Date.now()}` }),
      });

      expect(response.status).toBe(403);
      const created = await app.database.superuser.query(
        "SELECT 1 FROM workspace WHERE name = 'Self-serve'",
      );
      expect(created.rowCount).toBe(0);
    },
  );
});
