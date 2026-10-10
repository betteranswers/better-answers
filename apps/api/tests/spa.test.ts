import { describe, expect, it } from "vitest";

import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { AGENT_HOSTNAME, APEX_HOSTNAME, APP_HOSTNAME } from "./harness.ts";
import { servedApp } from "./suite-app.ts";

const asABrowserNavigates = { headers: { accept: "text/html,application/xhtml+xml" } };

describe("the api serves the shell on app.", () => {
  const app = servedApp();

  it("answers a page's address with the shell, so bookmarks work", async () => {
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

  it("refuses framing by another site on every page, sign-in included", async () => {
    for (const page of ["/sign-in", "/choose-workspace", "/system", "/"]) {
      const response = await app().client(undefined, APP_HOSTNAME).fetch(page, asABrowserNavigates);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("serves a built asset as itself", async () => {
    const response = await app().client(undefined, APP_HOSTNAME).fetch("/assets/page.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    await expect(response.text()).resolves.toContain("the page");
  });

  it("keeps the build's own caching beside the transport's no-store", async () => {
    const shell = await app().client(undefined, APP_HOSTNAME).fetch("/", asABrowserNavigates);
    const asset = await app().client(undefined, APP_HOSTNAME).fetch("/assets/page.js");

    expect(shell.headers.get("cache-control")).toBe("no-cache");
    expect(asset.headers.get("cache-control")).toBeNull();
  });

  it("answers a missing asset with 404, not the shell", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch("/assets/gone.js", asABrowserNavigates);

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.not.toContain(`<div id="root">`);
  });

  it("leaves the health check answering itself, not the shell", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch("/health", asABrowserNavigates);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "healthy" });
  });

  it("does not shadow an endpoint the web app fetches", async () => {
    const response = await app().client(undefined, APP_HOSTNAME).fetch("/get-session");

    expect(response.headers.get("content-type")).not.toContain("text/html");
  });

  it("gives a browser the auth endpoint's own answer", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch("/get-session", asABrowserNavigates);

    expect(response.headers.get("content-type")).not.toContain("text/html");
    await expect(response.text()).resolves.not.toContain(`<div id="root">`);
  });

  it("leaves the product's transport answering on app., not the shell", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch(`${TRPC_ENDPOINT}/modelChoices.list`, asABrowserNavigates);

    expect(response.headers.get("content-type")).not.toContain("text/html");
    await expect(response.text()).resolves.not.toContain(`<div id="root">`);
  });

  it("answers a page's address on a trailing-dot hostname", async () => {
    const response = await app().server.request(
      new Request(`https://${APP_HOSTNAME}./system`, asABrowserNavigates),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(`<div id="root">`);
  });

  it("serves the shell on app. only, never agent. or apex", async () => {
    for (const hostname of [AGENT_HOSTNAME, APEX_HOSTNAME]) {
      const response = await app()
        .client(undefined, hostname)
        .fetch("/system", asABrowserNavigates);

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.not.toContain(`<div id="root">`);
    }
  });

  it("leaves the protected-resource document answering as itself on app.", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch("/.well-known/oauth-protected-resource", asABrowserNavigates);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ resource: expect.any(String) });
  });

  it("keeps the shell under /.well-known/ from being kept as discovery", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch("/.well-known/openid-configuration", asABrowserNavigates);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    await expect(response.text()).resolves.toContain(`<div id="root">`);
  });
});
