import { describe, expect, it } from "vitest";

import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { AGENT_HOSTNAME, APEX_HOSTNAME, APP_HOSTNAME } from "./harness.ts";
import { servedApp } from "./suite-app.ts";

const asABrowserNavigates = { headers: { accept: "text/html,application/xhtml+xml" } };

describe("the api serves the shell on app. (ADR 0006)", () => {
  const app = servedApp();

  it("answers a screen's address with the shell, so a bookmark opens the product", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch("/system", asABrowserNavigates);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain(`<div id="root">`);
  });

  it("answers the root with the shell", async () => {
    const response = await app().client(undefined, APP_HOSTNAME).fetch("/", asABrowserNavigates);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(`<div id="root">`);
  });

  it("refuses to be framed by another site — sign-in and the picker as much as any screen", async () => {
    for (const screen of ["/sign-in", "/choose-workspace", "/system", "/"]) {
      const response = await app()
        .client(undefined, APP_HOSTNAME)
        .fetch(screen, asABrowserNavigates);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("serves a built asset as itself", async () => {
    const response = await app().client(undefined, APP_HOSTNAME).fetch("/assets/screen.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    await expect(response.text()).resolves.toContain("the screen");
  });

  it("does not answer a missing asset with the shell, which would be an unreadable script error", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch("/assets/gone.js", asABrowserNavigates);

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.not.toContain(`<div id="root">`);
  });

  it("leaves the health check answering the health check, not the shell", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch("/health", asABrowserNavigates);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "healthy" });
  });

  it("does not shadow an endpoint a client reaches with fetch", async () => {
    const response = await app().client(undefined, APP_HOSTNAME).fetch("/get-session");

    expect(response.headers.get("content-type")).not.toContain("text/html");
  });

  it("leaves the product's own transport answering on app., not the shell", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch(`${TRPC_ENDPOINT}/routes.list`, asABrowserNavigates);

    expect(response.headers.get("content-type")).not.toContain("text/html");
    await expect(response.text()).resolves.not.toContain(`<div id="root">`);
  });

  it("answers a screen's address on a hostname the fence spells with a trailing dot", async () => {
    const response = await app().server.request(
      new Request(`https://${APP_HOSTNAME}./system`, asABrowserNavigates),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(`<div id="root">`);
  });

  it("serves the shell on app. and nowhere else, so agent. and the apex are unchanged", async () => {
    for (const hostname of [AGENT_HOSTNAME, APEX_HOSTNAME]) {
      const response = await app()
        .client(undefined, hostname)
        .fetch("/system", asABrowserNavigates);

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.not.toContain(`<div id="root">`);
    }
  });

  it("leaves the protected-resource document answering as itself on app., not as the shell", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch("/.well-known/oauth-protected-resource", asABrowserNavigates);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ resource: expect.any(String) });
  });
});
