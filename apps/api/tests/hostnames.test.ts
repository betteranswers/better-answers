import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HOSTNAME_REFUSAL,
  HOSTNAME_ROLES,
  HOSTNAME_SURFACES,
  LOOPBACK_HOSTNAMES,
} from "../src/ingress/hostnames.ts";
import { AGENT_HOSTNAME, APEX_HOSTNAME, APP_HOSTNAME, startApp, type TestApp } from "./harness.ts";

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
    for (const loopback of LOOPBACK_HOSTNAMES) {
      const host = loopback.includes(":") ? `[${loopback}]` : loopback;
      const response = await app.server.request(new Request(`http://${host}/health`));

      expect(response.status).toBe(200);
    }
  });

  it("carries the MCP endpoint on app., the origin every token's audience names", async () => {
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

    expect((await product.fetch("/oauth2/authorize", { redirect: "manual" })).status).not.toBe(404);
    expect((await product.fetch("/oauth2/token", { method: "POST" })).status).not.toBe(404);
    expect(refusals().some((line) => String(line["path"]).startsWith("/oauth2/"))).toBe(false);
  });

  it("carries the resume, the product's screens and consent on app., one origin end to end", async () => {
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
    const response = await app
      .client(undefined, "mcp.example.test")
      .fetch("/.well-known/oauth-protected-resource/mcp");

    expect(response.status).toBe(404);
    expect(refusals().at(-1)).toMatchObject({ role: "unknown", host: "mcp.example.test" });
  });

  it("refuses a hostname carried only in X-Forwarded-Host", async () => {
    const response = await app
      .client(undefined, AGENT_HOSTNAME)
      .fetch("/mcp", { method: "POST", headers: { "x-forwarded-host": APP_HOSTNAME } });

    expect(response.status).toBe(404);
    expect(refusals().at(-1)).toMatchObject({ path: "/mcp", role: "agent" });
  });

  it("refuses a path that walks out of the share agent's surface, in either spelling", async () => {
    const agent = app.client(undefined, AGENT_HOSTNAME);

    for (const walk of ["/agent/v1/../../mcp", "/agent/v1/%2e%2e/%2e%2e/mcp"]) {
      const response = await agent.fetch(walk, { method: "POST" });

      expect(response.status).toBe(404);

      expect(response.headers.get("www-authenticate")).toBeNull();
      expect(refusals().at(-1)).toMatchObject({ path: "/mcp", role: "agent" });
    }
  });

  it("reads a hostname the way DNS does, so a resolver's trailing dot still reaches its surface", async () => {
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
    const named = new Set<string>(HOSTNAME_SURFACES.flatMap((surface) => [...surface.hosts]));
    const roles = new Set<string>(HOSTNAME_ROLES);

    for (const role of HOSTNAME_ROLES) expect(named.has(role)).toBe(true);
    for (const host of named) expect(roles.has(host)).toBe(true);
    for (const surface of HOSTNAME_SURFACES) expect(surface.reason.length).toBeGreaterThan(0);
  });

  it("tells a builder where the issuer's surface is: its paths and consent named on app. ahead of the catch-all", () => {
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
