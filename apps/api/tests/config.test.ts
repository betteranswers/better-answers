import { describe, expect, it } from "vitest";

import { readBootstrap, readIdentityBootstrap } from "../src/config.ts";

/**
 * The three hostnames of an estate the deploy unit sets (ADR 0022). The fourth, `mcp.`,
 * is `PUBLIC_URL`'s host and is set by setting that (T-039).
 */
const HOSTNAMES = {
  APP_HOSTNAME: "app.example.test",
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
  it("gives the database, the port and where the SPA's build is, and nothing more", () => {
    const read = readBootstrap({
      DATABASE_URL: "postgresql://x@db/x",
      PORT: "4000",
      WEB_ROOT: "/srv/web",
    });

    expect(read).toEqual({
      ok: true,
      value: { databaseUrl: "postgresql://x@db/x", port: 4000, webRoot: "/srv/web" },
    });
  });

  it("refuses an empty build directory, which would serve the image's own files", () => {
    // An empty value is not "unset": it reaches the static handler as a root of "", which
    // resolves against the working directory.
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x", WEB_ROOT: "" });

    expect(read.ok).toBe(false);
  });

  it("defaults the SPA's build to this repository's own, so the dev loop needs no setting", () => {
    // The app serves the build on `app.` (ADR 0006, amended 2026-09-02); an image that
    // lays it down elsewhere sets WEB_ROOT, and everything else is already right.
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x" });

    expect(read.ok && read.value.webRoot.endsWith("/apps/web/dist")).toBe(true);
  });

  it("gives the app the authorization server's origin, normalised, its secret and the four hostnames — three read, mcp. derived", () => {
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
 * The four hostnames of ADR 0022. Three are read beside `PUBLIC_URL` because the
 * router that consumes them (`apps/api/src/ingress/hostnames.ts`) is a fence: a
 * hostname the deploy unit did not give the process is a hostname that reaches
 * nothing, so a missing or malformed one has to stop the process rather than open it.
 * The fourth is `PUBLIC_URL`'s host, derived rather than declared (T-039), so the
 * cases below that would have been `MCP_HOSTNAME`'s are `PUBLIC_URL`'s.
 */
describe("the four hostnames of the estate", () => {
  // `PUBLIC_URL` is in this matrix as a hostname, not only as an origin: it is where
  // `mcp.` comes from, so a deploy unit that omits it leaves a hostname unset as surely
  // as omitting one of the three would (Cubic round 1).
  it.each(["PUBLIC_URL", "APP_HOSTNAME", "AGENT_HOSTNAME", "APEX_HOSTNAME"])(
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
    // The URL parser rewrites both of these to `127.0.0.1`, so the value would name a
    // hostname no arriving request can ever match.
    ["a padded IPv4 spelling", "127.000.000.001"],
    ["a hexadecimal IPv4 spelling", "0x7f.1"],
  ])("refuses APP_HOSTNAME with %s", (_case, hostname) => {
    expect(readIdentityBootstrap(identityEnvironment({ APP_HOSTNAME: hostname })).ok).toBe(false);
  });

  it("gives mcp. the host the authorization server issues from, without being told it twice", () => {
    // ADR 0022: `mcp.` carries `/mcp`, discovery and `/oauth2/*`, and `PUBLIC_URL` is
    // that origin exactly — the protected-resource document's `resource` is derived
    // from it. Declaring the hostname beside the origin was one truth in two places;
    // it is read off the origin instead (T-039), so the two cannot disagree.
    const read = readIdentityBootstrap(
      identityEnvironment({ PUBLIC_URL: "https://issuer.example.test" }),
    );

    expect(read.ok && read.value.hostnames.mcp).toBe("issuer.example.test");
  });

  it("refuses two hostnames that are the same, which would hand one surface to the other", () => {
    const read = readIdentityBootstrap(identityEnvironment({ AGENT_HOSTNAME: "app.example.test" }));

    expect(read.ok).toBe(false);
  });

  it.each(Object.entries(HOSTNAMES))("refuses a derived mcp. that equals %s", (_name, hostname) => {
    // The derived hostname is in the distinctness check with the three declared
    // ones. `PUBLIC_URL` naming a host the deploy unit also gave another role would
    // hand the authorization server to that role — or take `app.`'s surface away.
    const read = readIdentityBootstrap(identityEnvironment({ PUBLIC_URL: `https://${hostname}` }));

    expect(read.ok).toBe(false);
  });

  it.each([
    // Each of these derives an `mcp.` hostname the operator never wrote and cannot
    // find in their DNS — the class `bareHostname` already refuses for the three
    // declared hostnames (T-030), now applied to the one that is derived
    // (`[SEC3]`, T-039).
    ["a padded IPv4 spelling", "https://127.000.000.001"],
    ["a hexadecimal IPv4 spelling", "https://0x7f.1"],
    ["a percent-encoded label", "https://%6dcp.example.test"],
    // Not a DNS name at all: an IPv6 literal reaches the fence as `::1`, which is no
    // bare hostname.
    ["an IPv6 literal", "https://[::1]"],
    // The root dot is the one rewriting that names the same host, so one is stripped
    // and accepted; two leave an empty label, which is not a hostname.
    ["an empty final label", "https://mcp.example.test.."],
  ])("refuses a PUBLIC_URL whose host the parser rewrites — %s", (_case, url) => {
    expect(readIdentityBootstrap(identityEnvironment({ PUBLIC_URL: url })).ok).toBe(false);
  });

  it("reads a hostname in any case, because DNS does", () => {
    const read = readIdentityBootstrap(identityEnvironment({ APP_HOSTNAME: "App.Example.Test" }));

    expect(read.ok && read.value.hostnames.app).toBe("app.example.test");
  });

  it("strips DNS's trailing dot from PUBLIC_URL, so every string derived from it is on the host a browser sends", () => {
    // `mcp.example.test.` is the same host to DNS and to nothing else: the issuer, the
    // token audience, the protected-resource document and the three pages'
    // same-origin check are all exact strings, and a browser's `Origin` never carries
    // the dot. Accepting the value without normalising it would start the process and
    // refuse every OAuth form at 403. It is the one host rewriting that is allowed,
    // and the derived `mcp.` hostname carries the same normalisation.
    const read = readIdentityBootstrap(
      identityEnvironment({ PUBLIC_URL: "https://mcp.example.test./" }),
    );

    expect(read.ok && read.value.publicUrl).toBe("https://mcp.example.test");
    expect(read.ok && read.value.hostnames.mcp).toBe("mcp.example.test");
  });

  it("accepts a port beside DNS's trailing dot, which names the same host on a port of its own", () => {
    // Cubic round 1: the first version of the as-written check compared the whole
    // origin as a prefix of the value, so normalising the root dot moved it *past* the
    // port — `https://mcp.example.test.:8443` became `https://mcp.example.test:8443`,
    // which the raw value does not start with, and a legitimate origin stopped the
    // process. The check reads the host alone now (`hostIsAsWritten`), so the port is
    // no part of the comparison and the dot is read the same way on both sides.
    const read = readIdentityBootstrap(
      identityEnvironment({ PUBLIC_URL: "https://mcp.example.test.:8443" }),
    );

    expect(read.ok && read.value.publicUrl).toBe("https://mcp.example.test:8443");
    expect(read.ok && read.value.hostnames.mcp).toBe("mcp.example.test");
  });
});
