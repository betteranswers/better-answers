import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
