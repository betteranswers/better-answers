import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HOSTNAME_REFUSAL,
  HOSTNAME_ROLES,
  HOSTNAME_SURFACES,
  LOOPBACK_HOSTNAMES,
} from "../src/ingress/hostnames.ts";
import {
  AGENT_HOSTNAME,
  APEX_HOSTNAME,
  APP_HOSTNAME,
  MCP_HOSTNAME,
  startApp,
  type TestApp,
} from "./harness.ts";

/**
 * The in-process hostname fence (T-030, PR #7's deferral D1). The tunnel's ingress
 * rules are the first fence (ADR 0022, `deploy/coolify.md` § Ingress); this is the
 * second, in the app, because Better Auth's handler answers the wildcard on every
 * hostname and a tunnel rule is one console edit from being wrong.
 *
 * Every test here drives the real server through the HTTP harness on a real hostname
 * — the client's base URL is the hostname, which is what `@hono/node-server` builds
 * the request URL from — and asserts what the caller sees, never an internal.
 */
describe("each hostname reaches only its documented surface (ADR 0022)", () => {
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
    const response = await app.client(undefined, APP_HOSTNAME).fetch("/health");

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

  it("refuses the MCP endpoint on app.", async () => {
    const response = await app.client(undefined, APP_HOSTNAME).fetch("/mcp", { method: "POST" });

    expect(response.status).toBe(404);
  });

  it("refuses the authorization server on app.", async () => {
    const response = await app
      .client(undefined, APP_HOSTNAME)
      .fetch("/.well-known/oauth-authorization-server");

    expect(response.status).toBe(404);
  });

  it("answers the protected-resource document on mcp.", async () => {
    const response = await app.client().fetch("/.well-known/oauth-protected-resource/mcp");

    expect(response.status).toBe(200);
  });

  it("refuses the share agent's surface on mcp.", async () => {
    const response = await app.client().fetch("/agent/v1/files");

    expect(response.status).toBe(404);
    expect(refusals().at(-1)).toMatchObject({ path: "/agent/v1/files", role: "mcp" });
  });

  it("routes the share agent's surface on agent., and refuses every other path there", async () => {
    const agent = app.client(undefined, AGENT_HOSTNAME);

    const routed = await agent.fetch("/agent/v1/upload");
    // Nothing is mounted under `/agent/v1/` yet (ADR 0008's share agent is a later
    // task), so the surface answers Hono's own not-found — but the hostname fence let
    // it through, which is what this asserts.
    expect(refusals().some((line) => line["path"] === "/agent/v1/upload")).toBe(false);
    expect(routed.status).toBe(404);

    const refused = await agent.fetch("/mcp", { method: "POST" });
    expect(refused.status).toBe(404);
    expect(refusals().at(-1)).toMatchObject({ path: "/mcp", role: "agent" });
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

  it("refuses a hostname carried only in X-Forwarded-Host", async () => {
    // The tunnel forwards the `Host`; `X-Forwarded-Host` is the caller's to write, in
    // the shape of the per-IP counter's `CF-Connecting-IP`-only rule (T-004 Q8).
    const response = await app
      .client(undefined, AGENT_HOSTNAME)
      .fetch("/mcp", { method: "POST", headers: { "x-forwarded-host": MCP_HOSTNAME } });

    expect(response.status).toBe(404);
    expect(refusals().at(-1)).toMatchObject({ path: "/mcp", role: "agent" });
  });

  it("refuses a path that walks out of the share agent's surface", async () => {
    const agent = app.client(undefined, AGENT_HOSTNAME);

    // The URL parser resolves `..` before anything routes on the path, so the fence
    // and the mounts behind it read the same string.
    const walked = await agent.fetch("/agent/v1/../../mcp", { method: "POST" });
    expect(walked.status).toBe(404);
    expect(refusals().at(-1)).toMatchObject({ path: "/mcp", role: "agent" });

    // Percent-encoded, the segment is not a `..` to the parser — and it is not one to
    // Hono or to Better Auth either, so the path the fence allowed is the path they
    // both fail to match. The MCP endpoint's own answer (a 401 with a bearer
    // challenge) is what would show it had been reached.
    const encoded = await agent.fetch("/agent/v1/%2e%2e/mcp", { method: "POST" });
    expect(encoded.status).toBe(404);
    expect(encoded.headers.get("www-authenticate")).toBeNull();
  });

  it("reads a hostname the way DNS does, so a resolver's trailing dot still reaches its surface", async () => {
    // `mcp.example.test.` is the same host. A fence that compared the raw string would
    // refuse a legitimate caller; one that compared a suffix would be bypassed by it.
    const response = await app
      .client(undefined, `${MCP_HOSTNAME}.`)
      .fetch("/.well-known/oauth-protected-resource/mcp");

    expect(response.status).toBe(200);
  });

  it("refuses a request before its body is read", async () => {
    const before = app.emails.length;
    const client = app.client("203.0.113.240", AGENT_HOSTNAME);

    const response = await client.form("/sign-in", {
      step: "email",
      email: "nobody@example.invalid",
    });

    expect(response.status).toBe(404);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(app.emails.length).toBe(before);
    // The per-IP counter is the first work the sign-in page does; a refusal that
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
    expect(body).not.toContain(MCP_HOSTNAME);
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
    // with an empty path set — it carries nothing, and says so.
    const named = new Set<string>(HOSTNAME_SURFACES.flatMap((surface) => [...surface.hosts]));
    const roles = new Set<string>(HOSTNAME_ROLES);

    for (const role of HOSTNAME_ROLES) expect(named.has(role)).toBe(true);
    for (const host of named) expect(roles.has(host)).toBe(true);
    for (const surface of HOSTNAME_SURFACES) expect(surface.reason.length).toBeGreaterThan(0);
  });
});
