import { describe, expect, it } from "vitest";

import {
  readBootstrap,
  readIdentityBootstrap,
  readObjectStore,
  readSweeps,
} from "../src/config.ts";

const HOSTNAMES = {
  AGENT_HOSTNAME: "agent.example.test",
  APEX_HOSTNAME: "example.test",
};

const identityEnvironment = (
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> => ({
  PUBLIC_URL: "https://app.example.test",
  AUTH_SECRET: "a-secret-that-is-at-least-thirty-two-characters",
  ...HOSTNAMES,
  ...overrides,
});

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
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x", WEB_ROOT: "" });

    expect(read.ok).toBe(false);
  });

  it("gives the api the bare repositories' root, so the head check has bundles to open", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x", GIT_STORE_DIR: "/data/git" });

    expect(read.ok && read.value.gitStoreDir).toBe("/data/git");
  });

  it("starts without a repositories' root, because `migrate` shares this shape and opens no bundle", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x" });

    expect(read.ok && read.value.gitStoreDir).toBe(undefined);
  });

  it("refuses an empty repositories' root, which would open every bundle relative to the working directory", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x", GIT_STORE_DIR: "" });

    expect(read.ok).toBe(false);
  });

  it("defaults the SPA's build to this repository's own, so the dev loop needs no setting", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x" });

    expect(read.ok && read.value.webRoot.endsWith("/apps/web/dist")).toBe(true);
  });

  it("gives the two ops commands the object store's five settings, shaped for the door", () => {
    const read = readObjectStore({
      S3_ENDPOINT: "http://objectstore:3900",
      S3_BUCKET: "better-answers",

      S3_REGION: "garage",
      S3_ACCESS_KEY: "GK31c2f218a2e44f485b94239e",
      S3_SECRET_KEY: "b892c0665f0ada8a4755dae98baa3b133590e11dae3bcc1f9d769d67f16c3835",
    });

    expect(read.ok && read.value).toEqual({
      endpoint: "http://objectstore:3900",
      region: "garage",
      bucket: "better-answers",
      accessKeyId: "GK31c2f218a2e44f485b94239e",
      secretAccessKey: "b892c0665f0ada8a4755dae98baa3b133590e11dae3bcc1f9d769d67f16c3835",
    });
  });

  it("takes a region an operator names, for a store that is not Garage", () => {
    const read = readObjectStore({
      S3_ENDPOINT: "https://s3.eu-west-2.amazonaws.com",
      S3_BUCKET: "better-answers",
      S3_REGION: "eu-west-2",
      S3_ACCESS_KEY: "key",
      S3_SECRET_KEY: "secret",
    });

    expect(read.ok && read.value.region).toBe("eu-west-2");
  });

  it("is refused, and the process still starts, when the estate names no object store", () => {
    expect(readObjectStore({ DATABASE_URL: "postgresql://x@db/x" }).ok).toBe(false);
  });

  it.each(["S3_ENDPOINT", "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY"])(
    "is refused without %s, because a door opened on a half-set store fails at the first key",
    (name) => {
      const environment: Record<string, string | undefined> = {
        S3_ENDPOINT: "http://objectstore:3900",
        S3_BUCKET: "better-answers",
        S3_REGION: "garage",
        S3_ACCESS_KEY: "key",
        S3_SECRET_KEY: "secret",
      };
      environment[name] = undefined;

      expect(readObjectStore(environment).ok).toBe(false);
    },
  );

  it("refuses a host and port written without a scheme, which no S3 client can speak to", () => {
    const read = readObjectStore({
      S3_ENDPOINT: "objectstore:3900",
      S3_BUCKET: "better-answers",
      S3_REGION: "garage",
      S3_ACCESS_KEY: "key",
      S3_SECRET_KEY: "secret",
    });

    expect(read.ok).toBe(false);
  });

  it("gives the api the one origin, normalised, its secret and the three hostnames", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ PUBLIC_URL: "https://app.example.test/" }),
    );

    expect(read).toEqual({
      ok: true,
      value: {
        publicUrl: "https://app.example.test",
        authSecret: "a-secret-that-is-at-least-thirty-two-characters",
        hostnames: {
          app: "app.example.test",
          agent: "agent.example.test",
          apex: "example.test",
        },
      },
    });
  });

  it.each([
    ["http", "http://app.example.test"],
    ["a path", "https://app.example.test/mcp"],
    ["a query", "https://app.example.test/?x=1"],
    ["a fragment", "https://app.example.test/#x"],
    ["a username", "https://who@app.example.test"],
    ["a password", "https://:secret@app.example.test"],
  ])("refuses PUBLIC_URL with %s", (_case, url) => {
    const read = readIdentityBootstrap(identityEnvironment({ PUBLIC_URL: url }));

    expect(read.ok).toBe(false);
  });

  it("refuses a short secret", () => {
    expect(readIdentityBootstrap(identityEnvironment({ AUTH_SECRET: "short" })).ok).toBe(false);
  });

  it("gives the api its SMTP connection URL, so the sign-in code has a transport", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ SMTP_URL: "smtps://resend:key@smtp.example.test:465" }),
    );

    expect(read.ok && read.value.smtpUrl).toBe("smtps://resend:key@smtp.example.test:465");
  });

  it("starts without SMTP, because the dev loop and the harness send no email", () => {
    const read = readIdentityBootstrap(identityEnvironment());

    expect(read.ok && read.value.smtpUrl).toBe(undefined);
  });

  it.each([
    ["another scheme", "https://smtp.example.test"],

    [
      "compose's own error message",
      'The "SMTP_URL" variable is not set. Defaulting to a blank string.',
    ],
    ["an empty value", ""],
  ])("refuses SMTP_URL with %s", (_case, url) => {
    expect(readIdentityBootstrap(identityEnvironment({ SMTP_URL: url })).ok).toBe(false);
  });
});

describe("the sweeps' settings", () => {
  it("keeps the upload sweep list-only, and pings nothing, until the estate says otherwise", () => {
    expect(readSweeps({})).toEqual({
      ok: true,
      value: { uploadSweep: "list", pingUrl: undefined },
    });
  });

  it("switches the upload sweep to removing, and gives the pass its check, when the estate names them", () => {
    const read = readSweeps({
      UPLOAD_SWEEP: "remove",
      HEALTHCHECKS_PING_URL_SWEEPS: "https://hc-ping.com/0f5e8a2c-5d3a-4c55-9d0e-2b8c1f7a6e41",
    });

    expect(read).toEqual({
      ok: true,
      value: {
        uploadSweep: "remove",
        pingUrl: "https://hc-ping.com/0f5e8a2c-5d3a-4c55-9d0e-2b8c1f7a6e41",
      },
    });
  });

  it.each([
    ["a word it does not know", "delete"],
    ["the right word in another case", "Remove"],
    ["an empty value", ""],
  ])("refuses UPLOAD_SWEEP with %s rather than guess whether to remove", (_case, word) => {
    expect(readSweeps({ UPLOAD_SWEEP: word }).ok).toBe(false);
  });

  it.each([
    ["no scheme", "hc-ping.com/0f5e8a2c"],
    ["another scheme", "ftp://hc-ping.com/0f5e8a2c"],
    ["an empty value", ""],
  ])("refuses a check to ping with %s", (_case, url) => {
    expect(readSweeps({ HEALTHCHECKS_PING_URL_SWEEPS: url }).ok).toBe(false);
  });
});

describe("the three hostnames of the estate", () => {
  it.each(["PUBLIC_URL", "AGENT_HOSTNAME", "APEX_HOSTNAME"])("refuses a missing %s", (name) => {
    expect(readIdentityBootstrap(identityEnvironment({ [name]: undefined })).ok).toBe(false);
  });

  it("ignores an APP_HOSTNAME the deploy unit still sets, because the app hostname is PUBLIC_URL's host", () => {
    const read = readIdentityBootstrap(identityEnvironment({ APP_HOSTNAME: "elsewhere.test" }));

    expect(read.ok && read.value.hostnames.app).toBe("app.example.test");
  });

  it.each([
    ["a scheme", "https://agent.example.test"],
    ["a port", "agent.example.test:443"],
    ["a path", "agent.example.test/"],
    ["credentials", "who@agent.example.test"],
    ["a wildcard", "*.example.test"],
    ["an empty value", ""],
    ["a space", "agent.example.test "],
    ["an empty label", "agent..example.test"],
    ["a label opening with a hyphen", "-agent.example.test"],

    ["a padded IPv4 spelling", "127.000.000.001"],
    ["a hexadecimal IPv4 spelling", "0x7f.1"],
  ])("refuses AGENT_HOSTNAME with %s", (_case, hostname) => {
    expect(readIdentityBootstrap(identityEnvironment({ AGENT_HOSTNAME: hostname })).ok).toBe(false);
  });

  it("gives app. the host the product is served from and the authorization server issues from, without being told it twice", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ PUBLIC_URL: "https://product.example.test" }),
    );

    expect(read.ok && read.value.hostnames.app).toBe("product.example.test");
  });

  it("refuses two hostnames that are the same, which would hand one surface to the other", () => {
    const read = readIdentityBootstrap(identityEnvironment({ AGENT_HOSTNAME: "example.test" }));

    expect(read.ok).toBe(false);
  });

  it.each(Object.entries(HOSTNAMES))("refuses a derived app. that equals %s", (_name, hostname) => {
    const read = readIdentityBootstrap(identityEnvironment({ PUBLIC_URL: `https://${hostname}` }));

    expect(read.ok).toBe(false);
  });

  it.each([
    ["a padded IPv4 spelling", "https://127.000.000.001"],
    ["a hexadecimal IPv4 spelling", "https://0x7f.1"],
    ["a percent-encoded label", "https://%61pp.example.test"],

    ["an IPv6 literal", "https://[::1]"],

    ["an empty final label", "https://app.example.test.."],
  ])("refuses a PUBLIC_URL whose host the parser rewrites — %s", (_case, url) => {
    expect(readIdentityBootstrap(identityEnvironment({ PUBLIC_URL: url })).ok).toBe(false);
  });

  it("reads a hostname in any case, because DNS does", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ AGENT_HOSTNAME: "Agent.Example.Test" }),
    );

    expect(read.ok && read.value.hostnames.agent).toBe("agent.example.test");
  });

  it("strips DNS's trailing dot from PUBLIC_URL, so every string derived from it is on the host a browser sends", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ PUBLIC_URL: "https://app.example.test./" }),
    );

    expect(read.ok && read.value.publicUrl).toBe("https://app.example.test");
    expect(read.ok && read.value.hostnames.app).toBe("app.example.test");
  });

  it("accepts a port beside DNS's trailing dot, which names the same host on a port of its own", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ PUBLIC_URL: "https://app.example.test.:8443" }),
    );

    expect(read.ok && read.value.publicUrl).toBe("https://app.example.test:8443");
    expect(read.ok && read.value.hostnames.app).toBe("app.example.test");
  });
});
