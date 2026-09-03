import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TRPC_ENDPOINT } from "../src/trpc/index.ts";
import { APP_HOSTNAME, MCP_HOSTNAME, startApp, type TestApp } from "./harness.ts";

/**
 * The api serves the SPA's static build on `app.` (ADR 0006, amended 2026-09-02; ADR 0022
 * gives `app.` the product). Every test drives the real server through the HTTP harness on
 * a real hostname and asserts what a caller sees.
 *
 * A browser is the caller this is for, so the requests here carry what a browser carries:
 * a navigation asks for `text/html`, a script tag does not.
 */

const WEB_ROOT = fileURLToPath(new URL("fixtures/web-build", import.meta.url));
const asABrowserNavigates = { headers: { accept: "text/html,application/xhtml+xml" } };

describe("the api serves the shell on app. (ADR 0006)", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startApp({ webRoot: WEB_ROOT });
  });

  afterAll(async () => {
    await app.stop();
  });

  it("answers a screen's address with the shell, so a bookmark opens the product", async () => {
    const response = await app
      .client(undefined, APP_HOSTNAME)
      .fetch("/system", asABrowserNavigates);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain(`<div id="root">`);
  });

  it("answers the root with the shell", async () => {
    const response = await app.client(undefined, APP_HOSTNAME).fetch("/", asABrowserNavigates);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(`<div id="root">`);
  });

  it("refuses to be framed by another site — sign-in and the picker as much as any screen", async () => {
    // Sign-in and the workspace picker were server-rendered pages until T-037 and carried
    // these two headers there (T-004). They are the shell's addresses now, so the shell
    // carries them: a framed sign-in is a person typing a code into someone else's page,
    // and a framed picker is a pick made for them. Consent keeps its own pair in
    // `auth/routes.ts`, on the origin it is still rendered from.
    for (const screen of ["/sign-in", "/choose-workspace", "/system", "/"]) {
      const response = await app.client(undefined, APP_HOSTNAME).fetch(screen, asABrowserNavigates);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("serves a built asset as itself", async () => {
    const response = await app.client(undefined, APP_HOSTNAME).fetch("/assets/screen.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    await expect(response.text()).resolves.toContain("the screen");
  });

  it("does not answer a missing asset with the shell, which would be an unreadable script error", async () => {
    const response = await app
      .client(undefined, APP_HOSTNAME)
      .fetch("/assets/gone.js", asABrowserNavigates);

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.not.toContain(`<div id="root">`);
  });

  it("leaves the health check answering the health check, not the shell", async () => {
    // The uptime check T-005 sets up reaches `app.`'s health; a shell with status 200 would
    // read as healthy for ever.
    const response = await app
      .client(undefined, APP_HOSTNAME)
      .fetch("/health", asABrowserNavigates);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "healthy" });
  });

  it("does not shadow an endpoint a client reaches with fetch", async () => {
    // Better Auth's own endpoints answer the same wildcard. A `fetch` sends no `text/html`,
    // which is what keeps the shell off them.
    const response = await app.client(undefined, APP_HOSTNAME).fetch("/get-session");

    expect(response.headers.get("content-type")).not.toContain("text/html");
  });

  it("leaves the product's own transport answering on app., not the shell", async () => {
    // The tRPC mount and the shell share `app.` and the same wildcard behind them
    // (ADR 0008, ADR 0022). A navigation-shaped request to a procedure's path has to
    // reach tRPC: the shell answering it would be a screen where a refusal should be.
    const response = await app
      .client(undefined, APP_HOSTNAME)
      .fetch(`${TRPC_ENDPOINT}/routes.list`, asABrowserNavigates);

    expect(response.headers.get("content-type")).not.toContain("text/html");
    await expect(response.text()).resolves.not.toContain(`<div id="root">`);
  });

  it("answers a screen's address on a hostname the fence spells with a trailing dot", async () => {
    // The fence admits `app.example.test.` — a trailing dot is the DNS root and names the
    // same host — so the shell has to normalise the same way or that address reaches the
    // authorization server's 404 instead of the product.
    const response = await app.server.request(
      new Request(`https://${APP_HOSTNAME}./system`, asABrowserNavigates),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(`<div id="root">`);
  });

  it("serves the shell on app. and nowhere else, so mcp. is unchanged", async () => {
    const response = await app
      .client(undefined, MCP_HOSTNAME)
      .fetch("/system", asABrowserNavigates);

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.not.toContain(`<div id="root">`);
  });

  it("leaves the protected-resource document on mcp. as it was", async () => {
    const response = await app
      .client(undefined, MCP_HOSTNAME)
      .fetch("/.well-known/oauth-protected-resource", asABrowserNavigates);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ resource: expect.any(String) });
  });
});
