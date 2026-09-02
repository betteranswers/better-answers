import { describe, expect, it } from "vitest";

import { readBootstrap, readIdentityBootstrap } from "../src/config.ts";

/**
 * The bootstrap class at its boundary: `migrate` needs the database alone, `app` also
 * the authorization server's origin — an https origin and nothing else — and secret.
 */
describe("the bootstrap configuration", () => {
  it("gives migrate the database and port, and nothing more", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x", PORT: "4000" });

    expect(read).toEqual({ ok: true, value: { databaseUrl: "postgresql://x@db/x", port: 4000 } });
  });

  it("gives the app the authorization server's origin, normalised, and its secret", () => {
    const read = readIdentityBootstrap({
      PUBLIC_URL: "https://mcp.example.test/",
      AUTH_SECRET: "a-secret-that-is-at-least-thirty-two-characters",
    });

    expect(read).toEqual({
      ok: true,
      value: {
        publicUrl: "https://mcp.example.test",
        authSecret: "a-secret-that-is-at-least-thirty-two-characters",
      },
    });
  });

  it.each([
    ["http", "http://mcp.example.test"],
    ["a path", "https://mcp.example.test/mcp"],
    ["a query", "https://mcp.example.test/?x=1"],
    ["a fragment", "https://mcp.example.test/#x"],
    ["a username", "https://who@mcp.example.test"],
    ["a password", "https://:secret@mcp.example.test"],
  ])("refuses PUBLIC_URL with %s", (_case, url) => {
    const read = readIdentityBootstrap({
      PUBLIC_URL: url,
      AUTH_SECRET: "a-secret-that-is-at-least-thirty-two-characters",
    });

    expect(read.ok).toBe(false);
  });

  it("refuses a short secret", () => {
    expect(
      readIdentityBootstrap({ PUBLIC_URL: "https://mcp.example.test", AUTH_SECRET: "short" }).ok,
    ).toBe(false);
  });
});
