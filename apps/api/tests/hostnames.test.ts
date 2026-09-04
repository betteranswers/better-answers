import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HOSTNAME_REFUSAL,
  HOSTNAME_ROLES,
  HOSTNAME_SURFACES,
  LOOPBACK_HOSTNAMES,
} from "../src/ingress/hostnames.ts";
import { AGENT_HOSTNAME, APEX_HOSTNAME, APP_HOSTNAME, startApp, type TestApp } from "./harness.ts";

/**
 * The in-process hostname fence (T-030, PR #7's deferral D1), re-cut to one origin by
 * T-045 (ADR 0034). The tunnel's ingress rules are the first fence (ADR 0022,
 * `apps/docs-site/operations/coolify.md` § Ingress); this is the second, in the app,
 * because Better Auth's
 * handler answers the wildcard on every hostname and a tunnel rule is one console edit
 * from being wrong.
 *
 * Since T-045 everything a browser or a host reaches is on `app.`, so most of what the
 * fence does is keep `agent.`, the apex and an unnamed hostname away from it. Every test
 * here drives the real server through the HTTP harness on a real hostname — the
 * client's base URL is the hostname, which is what `@hono/node-server` builds the
 * request URL from — and asserts what the caller sees, never an internal.
 */
describe("each hostname reaches only its documented surface (ADR 0022, ADR 0034)", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startApp();
  });

  afterAll(async () => {
    await app.stop();
  });

  const refusals = (): readonly Readonly<Record<string, unknown>>[] =>
    app.logs.filter((line) => line["event"] === "ingress.hostname_refused");

  it("answers the health check on app., where the uptime check reaches it", async () => {
    const response = await app.client().fetch("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "healthy" });
  });

  it("answers the health check on the loopback, where the container's own probe reaches it", async () => {
    // `deploy/platform.compose.yaml`'s healthcheck is `wget http://127.0.0.1:3000/health`
    // from inside the container: it never crosses the tunnel and carries no public
    // hostname. Refusing it would hold `worker` back for ever.
    for (const loopback of LOOPBACK_HOSTNAMES) {
      const host = loopback.includes(":") ? `[${loopback}]` : loopback;
      const response = await app.server.request(new Request(`http://${host}/health`));

      expect(response.status).toBe(200);
    }
  });

  it("carries the MCP endpoint on app., the origin every token's audience names", async () => {
    // Unauthenticated, so what answers is the bearer challenge — which is the endpoint
    // itself, reached, and not the fence.
    const response = await app.client().fetch("/mcp", { method: "POST" });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("invalid_token");
    expect(refusals().some((line) => line["path"] === "/mcp")).toBe(false);
  });

  it("carries the authorization server and its discovery documents on app.", async () => {
    const product = app.client();

    for (const path of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource/mcp",
      "/jwks",
    ]) {
      expect((await product.fetch(path)).status).toBe(200);
    }
    // What `authorize` and `token` answer a bare request is Better Auth's to say — a
    // redirect with an error, a 400 — but never the fence's 404.
    expect((await product.fetch("/oauth2/authorize", { redirect: "manual" })).status).not.toBe(404);
    expect((await product.fetch("/oauth2/token", { method: "POST" })).status).not.toBe(404);
    expect(refusals().some((line) => String(line["path"]).startsWith("/oauth2/"))).toBe(false);
  });

  it("carries the resume, the product's screens and consent on app., one origin end to end", async () => {
    // `/oauth2/continue` is the one endpoint of the authorization server an
    // application-owned screen calls (T-037); `/sign-in` and `/choose-workspace` are the
    // SPA's screens; `/consent` is the one page this tier still renders. Before T-045
    // these were split across two hosts and the fence held the split; now the fence lets
    // each through to whatever answers it and what that is — a shell, a refusal for a
    // missing session — is not the fence's to say.
    const product = app.client();

    for (const path of ["/sign-in", "/choose-workspace", "/consent"]) {
      await product.fetch(path);
      expect(refusals().some((line) => line["path"] === path)).toBe(false);
    }
    const resumed = await product.fetch("/oauth2/continue", { method: "POST" });
    expect(resumed.status).not.toBe(404);
    expect(refusals().some((line) => line["path"] === "/oauth2/continue")).toBe(false);
  });

  it("refuses the identity provider's admin endpoints on the one hostname that answers", async () => {
    // `@better-auth/oauth-provider` ships a surface that mints OAuth clients and
    // manages resource registrations. It is in the endpoint table, so the snapshot
    // (`better-auth-endpoints.txt`) puts it in front of a reader — and the answer to
    // the question that raises is here rather than in a PR comment (T-039, `[SEC3]`).
    // Better Auth marks each `metadata.SERVER_ONLY`, so better-call leaves it off its
    // router; the fence's catch-all admits the path on `app.` and there is nothing
    // behind it. That is the library's flag, not ours, so it is asserted.
    const client = app.client();
    for (const path of [
      "/admin/oauth2/create-client",
      "/admin/oauth2/update-client",
      "/admin/oauth2/resources",
    ]) {
      expect((await client.fetch(path, { method: "POST" })).status).toBe(404);
      expect((await client.fetch(path)).status).toBe(404);
    }
  });

  it("refuses the share agent's surface on app.", async () => {
    const response = await app.client().fetch("/agent/v1/files");

    expect(response.status).toBe(404);
    expect(refusals().at(-1)).toMatchObject({ path: "/agent/v1/files", role: "app" });
  });

  it("routes the share agent's surface on agent., and refuses every other path there", async () => {
    const agent = app.client(undefined, AGENT_HOSTNAME);

    const routed = await agent.fetch("/agent/v1/upload");
    // Nothing is mounted under `/agent/v1/` yet (ADR 0008's share agent is a later
    // task), so the surface answers Hono's own not-found — but the hostname fence let
    // it through, which is what this asserts.
    expect(refusals().some((line) => line["path"] === "/agent/v1/upload")).toBe(false);
    expect(routed.status).toBe(404);

    for (const path of ["/mcp", "/oauth2/token", "/consent", "/sign-in", "/health"]) {
      const refused = await agent.fetch(path, { method: path === "/mcp" ? "POST" : "GET" });
      expect(refused.status).toBe(404);
      expect(refusals().at(-1)).toMatchObject({ path, role: "agent" });
    }
  });

  it("refuses every path on the apex, which the edge answers with 404 anyway", async () => {
    const apex = app.client(undefined, APEX_HOSTNAME);

    for (const path of ["/health", "/mcp", "/me", "/sign-in", "/agent/v1/files", "/c/anything"]) {
      expect((await apex.fetch(path)).status).toBe(404);
    }
  });

  it("refuses a hostname the deploy unit never named", async () => {
    const response = await app.client(undefined, "someone-elses.example.test").fetch("/health");

    expect(response.status).toBe(404);
    expect(refusals().at(-1)).toMatchObject({
      role: "unknown",
      host: "someone-elses.example.test",
    });
  });

  it("refuses the hostname the estate had before T-045, which the deploy unit no longer names", async () => {
    // `mcp.` is not a role any more. A request for it is a request for a hostname nobody
    // wrote — refused as one, not quietly answered as `app.`.
    const response = await app
      .client(undefined, "mcp.example.test")
      .fetch("/.well-known/oauth-protected-resource/mcp");

    expect(response.status).toBe(404);
    expect(refusals().at(-1)).toMatchObject({ role: "unknown", host: "mcp.example.test" });
  });

  it("refuses a hostname carried only in X-Forwarded-Host", async () => {
    // The tunnel forwards the `Host`; `X-Forwarded-Host` is the caller's to write, in
    // the shape of the per-IP counter's `CF-Connecting-IP`-only rule (T-004 Q8).
    const response = await app
      .client(undefined, AGENT_HOSTNAME)
      .fetch("/mcp", { method: "POST", headers: { "x-forwarded-host": APP_HOSTNAME } });

    expect(response.status).toBe(404);
    expect(refusals().at(-1)).toMatchObject({ path: "/mcp", role: "agent" });
  });

  it("refuses a path that walks out of the share agent's surface, in either spelling", async () => {
    const agent = app.client(undefined, AGENT_HOSTNAME);

    // The URL parser resolves every dot segment before anything routes on the path,
    // and the URL standard reads `%2e` as `.`, so both spellings arrive as `/mcp` —
    // the fence and the mounts behind it read one string, and no spelling means
    // `/agent/v1/…` here and `/mcp` there.
    for (const walk of ["/agent/v1/../../mcp", "/agent/v1/%2e%2e/%2e%2e/mcp"]) {
      const response = await agent.fetch(walk, { method: "POST" });

      expect(response.status).toBe(404);
      // The MCP endpoint answers an unauthenticated call with a bearer challenge; its
      // absence is what says the endpoint was never reached.
      expect(response.headers.get("www-authenticate")).toBeNull();
      expect(refusals().at(-1)).toMatchObject({ path: "/mcp", role: "agent" });
    }
  });

  it("reads a hostname the way DNS does, so a resolver's trailing dot still reaches its surface", async () => {
    // `app.example.test.` is the same host. A fence that compared the raw string would
    // refuse a legitimate caller; one that compared a suffix would be bypassed by it.
    const response = await app
      .client(undefined, `${APP_HOSTNAME}.`)
      .fetch("/.well-known/oauth-protected-resource/mcp");

    expect(response.status).toBe(200);
  });

  it("refuses a request before its body is read", async () => {
    const before = app.emails.length;
    const client = app.client("203.0.113.240", AGENT_HOSTNAME);

    const response = await client.json("/email-otp/send-verification-otp", {
      email: "nobody@example.invalid",
      type: "sign-in",
    });

    expect(response.status).toBe(404);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(app.emails.length).toBe(before);
    // The per-email throttle reads the body before Better Auth sees it; a refusal that
    // reached it would have written its row.
    const counted = await app.database.superuser.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM ingress_counter WHERE key = $1",
      [client.ip],
    );
    expect(counted.rows[0]?.n).toBe(0);
  });

  it("answers one generic sentence and keeps the reason in the log", async () => {
    const response = await app.client(undefined, AGENT_HOSTNAME).fetch("/oauth2/token", {
      method: "POST",
    });
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain(HOSTNAME_REFUSAL);
    // The wire says nothing about which hostname carries the path, nor which one asked.
    expect(body).not.toContain(AGENT_HOSTNAME);
    expect(body).not.toContain(APP_HOSTNAME);
    expect(body).not.toContain("agent");
    expect(refusals().at(-1)).toMatchObject({
      event: "ingress.hostname_refused",
      role: "agent",
      host: AGENT_HOSTNAME,
      path: "/oauth2/token",
    });
  });

  it("names a surface for every hostname role, and a known role in every surface", () => {
    // [TEST7]: one direction finds the hostname nobody wrote a surface for, the other
    // the surface written for a hostname that does not exist. The apex is in the list
    // with an empty path set — it carries nothing, and says so. One role fewer than
    // before T-045: `mcp` is gone, and a surface that still named it would fail here.
    const named = new Set<string>(HOSTNAME_SURFACES.flatMap((surface) => [...surface.hosts]));
    const roles = new Set<string>(HOSTNAME_ROLES);

    for (const role of HOSTNAME_ROLES) expect(named.has(role)).toBe(true);
    for (const host of named) expect(roles.has(host)).toBe(true);
    for (const surface of HOSTNAME_SURFACES) expect(surface.reason.length).toBeGreaterThan(0);
  });

  it("tells a builder where the issuer's surface is: its paths and consent named on app. ahead of the catch-all", () => {
    // ADR 0034: the paths are the catch-all's already; they are listed so a builder reads
    // where the issuer's surface is, and consent keeps an entry because it carries a
    // fence of its own. A list that folded them away would pass every request test above
    // and lose the reading.
    const entryFor = (path: string) =>
      HOSTNAME_SURFACES.find((surface) => surface.paths.includes(path));

    for (const path of ["/mcp", "/.well-known/*", "/jwks", "/oauth2/*"]) {
      expect(entryFor(path)?.hosts).toEqual(["app"]);
    }
    expect(entryFor("/consent")?.hosts).toEqual(["app"]);
    expect(entryFor("/consent")?.paths).toEqual(["/consent"]);
    expect(HOSTNAME_SURFACES.at(-1)?.paths).toEqual(["/*"]);
    expect(HOSTNAME_SURFACES.at(-1)?.hosts).toEqual(["app"]);
  });
});
