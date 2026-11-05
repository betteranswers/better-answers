import { describe, expect, it } from "vitest";

import { matching } from "@better-answers/schema/testing/matching";

import { TRPC_ENDPOINT } from "../../src/trpc/mount.ts";
import { AGENT_HOSTNAME, APEX_HOSTNAME, APP_HOSTNAME } from "../support/harness/harness.ts";
import { servedApp } from "../support/suite-app.ts";

const asABrowserNavigates = { headers: { accept: "text/html,application/xhtml+xml" } };

describe("the api serves the shell on the app hostname", () => {
  const app = servedApp();

  it("answers a page path with the shell so bookmarks load", async () => {
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

  it("forbids framing on every page, including sign-in", async () => {
    for (const page of ["/sign-in", "/choose-workspace", "/system", "/"]) {
      const response = await app().client(undefined, APP_HOSTNAME).fetch(page, asABrowserNavigates);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("serves a built asset file, not the shell", async () => {
    const response = await app().client(undefined, APP_HOSTNAME).fetch("/assets/page.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    await expect(response.text()).resolves.toContain("the page");
  });

  it("marks the shell no-cache and leaves asset caching unset", async () => {
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

  it("answers /health with its JSON, not the shell", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch("/health", asABrowserNavigates);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "healthy" });
  });

  it("routes /get-session to the auth handler, not the shell", async () => {
    const response = await app().client(undefined, APP_HOSTNAME).fetch("/get-session");

    expect(response.headers.get("content-type")).not.toContain("text/html");
  });

  it("routes a browser's /get-session to auth, not the shell", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch("/get-session", asABrowserNavigates);

    expect(response.headers.get("content-type")).not.toContain("text/html");
    await expect(response.text()).resolves.not.toContain(`<div id="root">`);
  });

  it("routes a browser's tRPC request to tRPC, not the shell", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch(`${TRPC_ENDPOINT}/modelChoices.list`, asABrowserNavigates);

    expect(response.headers.get("content-type")).not.toContain("text/html");
    await expect(response.text()).resolves.not.toContain(`<div id="root">`);
  });

  it("serves the shell for a page on a trailing-dot hostname", async () => {
    const response = await app().server.request(
      new Request(`https://${APP_HOSTNAME}./system`, asABrowserNavigates),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(`<div id="root">`);
  });

  it("refuses page paths on the agent and apex hostnames", async () => {
    for (const hostname of [AGENT_HOSTNAME, APEX_HOSTNAME]) {
      const response = await app()
        .client(undefined, hostname)
        .fetch("/system", asABrowserNavigates);

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.not.toContain(`<div id="root">`);
    }
  });

  it("serves a browser the protected-resource document, not the shell", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch("/.well-known/oauth-protected-resource", asABrowserNavigates);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ resource: matching.any(String) });
  });

  it("serves the shell no-cache for an unknown /.well-known/ path", async () => {
    const response = await app()
      .client(undefined, APP_HOSTNAME)
      .fetch("/.well-known/openid-configuration", asABrowserNavigates);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    await expect(response.text()).resolves.toContain(`<div id="root">`);
  });
});
