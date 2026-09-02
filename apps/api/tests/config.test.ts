import { describe, expect, it } from "vitest";

import { readBootstrap, readIdentityBootstrap } from "../src/config.ts";

/** The four hostnames of an estate, as the deploy unit sets them (ADR 0022). */
const HOSTNAMES = {
  APP_HOSTNAME: "app.example.test",
  MCP_HOSTNAME: "mcp.example.test",
  AGENT_HOSTNAME: "agent.example.test",
  APEX_HOSTNAME: "example.test",
};

const identityEnvironment = (
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> => ({
  PUBLIC_URL: "https://mcp.example.test",
  AUTH_SECRET: "a-secret-that-is-at-least-thirty-two-characters",
  ...HOSTNAMES,
  ...overrides,
});

/**
 * The bootstrap class at its boundary: `migrate` needs the database alone, `app` also
 * the authorization server's origin — an https origin and nothing else — and secret.
 */
describe("the bootstrap configuration", () => {
  it("gives migrate the database and port, and nothing more", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x", PORT: "4000" });

    expect(read).toEqual({ ok: true, value: { databaseUrl: "postgresql://x@db/x", port: 4000 } });
  });

  it("gives the app the authorization server's origin, normalised, its secret and the four hostnames", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ PUBLIC_URL: "https://mcp.example.test/" }),
    );

    expect(read).toEqual({
      ok: true,
      value: {
        publicUrl: "https://mcp.example.test",
        authSecret: "a-secret-that-is-at-least-thirty-two-characters",
        hostnames: {
          app: "app.example.test",
          mcp: "mcp.example.test",
          agent: "agent.example.test",
          apex: "example.test",
        },
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
    const read = readIdentityBootstrap(identityEnvironment({ PUBLIC_URL: url }));

    expect(read.ok).toBe(false);
  });

  it("refuses a short secret", () => {
    expect(readIdentityBootstrap(identityEnvironment({ AUTH_SECRET: "short" })).ok).toBe(false);
  });
});

/**
 * The four hostnames of ADR 0022, read beside `PUBLIC_URL` because the router that
 * consumes them (`apps/api/src/ingress/hostnames.ts`) is a fence: a hostname the
 * deploy unit did not give the process is a hostname that reaches nothing, so a
 * missing or malformed one has to stop the process rather than open it.
 */
describe("the four hostnames of the estate", () => {
  it.each(["APP_HOSTNAME", "MCP_HOSTNAME", "AGENT_HOSTNAME", "APEX_HOSTNAME"])(
    "refuses a missing %s",
    (name) => {
      expect(readIdentityBootstrap(identityEnvironment({ [name]: undefined })).ok).toBe(false);
    },
  );

  it.each([
    ["a scheme", "https://app.example.test"],
    ["a port", "app.example.test:443"],
    ["a path", "app.example.test/"],
    ["credentials", "who@app.example.test"],
    ["a wildcard", "*.example.test"],
    ["an empty value", ""],
    ["a space", "app.example.test "],
    ["an empty label", "app..example.test"],
    ["a label opening with a hyphen", "-app.example.test"],
  ])("refuses APP_HOSTNAME with %s", (_case, hostname) => {
    expect(readIdentityBootstrap(identityEnvironment({ APP_HOSTNAME: hostname })).ok).toBe(false);
  });

  it("refuses an MCP_HOSTNAME that is not the origin the authorization server issues from", () => {
    // ADR 0022: `mcp.` carries `/mcp`, discovery and `/oauth2/*`, and `PUBLIC_URL` is
    // that origin exactly — the protected-resource document's `resource` is derived
    // from it. Two different values would serve discovery on a hostname no document names.
    const read = readIdentityBootstrap(
      identityEnvironment({ MCP_HOSTNAME: "not-the-issuer.example.test" }),
    );

    expect(read.ok).toBe(false);
  });

  it("refuses two hostnames that are the same, which would hand one surface to the other", () => {
    const read = readIdentityBootstrap(identityEnvironment({ AGENT_HOSTNAME: "mcp.example.test" }));

    expect(read.ok).toBe(false);
  });

  it("reads a hostname in any case, because DNS does", () => {
    const read = readIdentityBootstrap(identityEnvironment({ APP_HOSTNAME: "App.Example.Test" }));

    expect(read.ok && read.value.hostnames.app).toBe("app.example.test");
  });
});
