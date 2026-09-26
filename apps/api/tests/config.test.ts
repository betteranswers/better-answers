import { describe, expect, it } from "vitest";

import {
  readBootstrap,
  readHeadCheck,
  readIdentityBootstrap,
  readObjectStore,
  readRunningImage,
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
  it("gives the database, port and SPA's build, and nothing more", () => {
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

  it("refuses an empty WEB_ROOT, which would serve the image's files", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x", WEB_ROOT: "" });

    expect(read.ok).toBe(false);
  });

  it("gives the bare repositories' root for the head check's bundles", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x", GIT_STORE_DIR: "/data/git" });

    expect(read.ok && read.value.gitStoreDir).toBe("/data/git");
  });

  it("starts without a repositories' root, as `migrate` opens no bundle", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x" });

    expect(read.ok && read.value.gitStoreDir).toBe(undefined);
  });

  it("refuses an empty repositories' root, read as the working directory", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x", GIT_STORE_DIR: "" });

    expect(read.ok).toBe(false);
  });

  it("defaults to this repository's SPA build, so dev sets nothing", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x" });

    expect(read.ok && read.value.webRoot.endsWith("/apps/web/dist")).toBe(true);
  });

  it("gives ops the object store's settings, shaped for the door", () => {
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

  it("takes an operator's region for a store other than Garage", () => {
    const read = readObjectStore({
      S3_ENDPOINT: "https://s3.eu-west-2.amazonaws.com",
      S3_BUCKET: "better-answers",
      S3_REGION: "eu-west-2",
      S3_ACCESS_KEY: "key",
      S3_SECRET_KEY: "secret",
    });

    expect(read.ok && read.value.region).toBe("eu-west-2");
  });

  it("refuses a missing object store, and the process still starts", () => {
    expect(readObjectStore({ DATABASE_URL: "postgresql://x@db/x" }).ok).toBe(false);
  });

  it.each(["S3_ENDPOINT", "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY"])(
    "refuses a store missing %s rather than fail on use",
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

  it("refuses a schemeless endpoint, which no S3 client speaks to", () => {
    const read = readObjectStore({
      S3_ENDPOINT: "objectstore:3900",
      S3_BUCKET: "better-answers",
      S3_REGION: "garage",
      S3_ACCESS_KEY: "key",
      S3_SECRET_KEY: "secret",
    });

    expect(read.ok).toBe(false);
  });

  it("gives the normalised origin, the secret and the three hostnames", () => {
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

  it("gives the SMTP URL, so sign-in codes have a transport", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ SMTP_URL: "smtps://resend:key@smtp.example.test:465" }),
    );

    expect(read.ok && read.value.smtpUrl).toBe("smtps://resend:key@smtp.example.test:465");
  });

  it("starts without SMTP, since dev and harness send no email", () => {
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

  it("gives the operator's address, where flagged display names are emailed", () => {
    const read = readIdentityBootstrap(identityEnvironment({ OPERATOR_EMAIL: "ops@example.test" }));

    expect(read.ok && read.value.operatorAddress).toBe("ops@example.test");
  });

  it("starts without an operator's address, which dev leaves unset", () => {
    const read = readIdentityBootstrap(identityEnvironment());

    expect(read.ok && read.value.operatorAddress).toBe(undefined);
  });

  it.each([
    ["no at sign", "ops.example.test"],
    [
      "compose's own error message",
      'The "OPERATOR_EMAIL" variable is not set. Defaulting to a blank string.',
    ],
    ["an empty value", ""],
  ])("refuses OPERATOR_EMAIL with %s", (_case, address) => {
    expect(readIdentityBootstrap(identityEnvironment({ OPERATOR_EMAIL: address })).ok).toBe(false);
  });
});

describe("the sweeps' settings", () => {
  it("keeps the upload sweep list-only and pings nothing by default", () => {
    expect(readSweeps({})).toEqual({
      ok: true,
      value: { uploadSweep: "list", pingUrl: undefined },
    });
  });

  it("switches to removing and takes the pass's check when named", () => {
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
    ["credentials", "https://who:secret@hc-ping.com/0f5e8a2c"],
  ])("refuses a check to ping with %s", (_case, url) => {
    expect(readSweeps({ HEALTHCHECKS_PING_URL_SWEEPS: url }).ok).toBe(false);
  });
});

describe("the head check's settings", () => {
  it("pings nothing until the estate names the scheduler check", () => {
    expect(readHeadCheck({})).toEqual({ ok: true, value: { pingUrl: undefined } });
  });

  it("pings the scheduler check when the estate names it", () => {
    const read = readHeadCheck({
      HEALTHCHECKS_PING_URL_SCHEDULER: "https://hc-ping.com/7c1d9e4a-2b6f-4e83-a5d0-9f3c8b1e6a27",
    });

    expect(read).toEqual({
      ok: true,
      value: { pingUrl: "https://hc-ping.com/7c1d9e4a-2b6f-4e83-a5d0-9f3c8b1e6a27" },
    });
  });

  it("never takes the sweeps' check for its own", () => {
    const read = readHeadCheck({
      HEALTHCHECKS_PING_URL_SWEEPS: "https://hc-ping.com/0f5e8a2c-5d3a-4c55-9d0e-2b8c1f7a6e41",
    });

    expect(read).toEqual({ ok: true, value: { pingUrl: undefined } });
  });

  it.each([
    ["no scheme", "hc-ping.com/7c1d9e4a"],
    ["another scheme", "ftp://hc-ping.com/7c1d9e4a"],
    ["an empty value", ""],
    ["a user and a password", "https://who:secret@hc-ping.com/7c1d9e4a"],
    ["a user alone", "https://who@hc-ping.com/7c1d9e4a"],
    ["a password alone", "https://:secret@hc-ping.com/7c1d9e4a"],
  ])("refuses a check to ping with %s", (_case, url) => {
    expect(readHeadCheck({ HEALTHCHECKS_PING_URL_SCHEDULER: url }).ok).toBe(false);
  });

  it("names the refused setting, never the value it was given", () => {
    const read = readHeadCheck({ HEALTHCHECKS_PING_URL_SCHEDULER: "hc-ping.com/7c1d9e4a" });

    expect(read.ok).toBe(false);
    const reason = read.ok ? "" : read.error.message;
    expect(reason).toContain("HEALTHCHECKS_PING_URL_SCHEDULER");
    expect(reason).not.toContain("7c1d9e4a");
  });
});

describe("the image the api runs", () => {
  const DIGEST = "sha256:9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d";

  it("gives the digest the deploy unit pinned its image to", () => {
    expect(readRunningImage({ API_IMAGE_DIGEST: DIGEST })).toEqual({
      ok: true,
      value: { digest: DIGEST },
    });
  });

  it("names no image when none is set, as in dev", () => {
    expect(readRunningImage({})).toEqual({ ok: true, value: { digest: undefined } });
  });

  it("never takes the worker's digest for the api's", () => {
    expect(readRunningImage({ WORKER_IMAGE_DIGEST: DIGEST })).toEqual({
      ok: true,
      value: { digest: undefined },
    });
  });

  it.each([
    ["an empty value", ""],
    ["a tag", "latest"],
    ["a digest cut short", "sha256:9e8d7c6b5a4f"],
    ["a digest in capitals", DIGEST.toUpperCase()],
    ["the whole image reference", `ghcr.io/betteranswers/api@${DIGEST}`],
  ])("refuses %s, which no pull by digest could have started", (_case, value) => {
    const read = readRunningImage({ API_IMAGE_DIGEST: value });

    expect(read.ok).toBe(false);
    expect(read.ok ? "" : read.error.message).toContain("API_IMAGE_DIGEST");
  });
});

describe("the three hostnames of the estate", () => {
  it.each(["PUBLIC_URL", "AGENT_HOSTNAME", "APEX_HOSTNAME"])("refuses a missing %s", (name) => {
    expect(readIdentityBootstrap(identityEnvironment({ [name]: undefined })).ok).toBe(false);
  });

  it("ignores APP_HOSTNAME, since the app hostname is PUBLIC_URL's host", () => {
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

  it("derives app. from PUBLIC_URL's host, without being told twice", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ PUBLIC_URL: "https://product.example.test" }),
    );

    expect(read.ok && read.value.hostnames.app).toBe("product.example.test");
  });

  it("refuses equal hostnames, which hand one surface to the other", () => {
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

  it("strips PUBLIC_URL's trailing dot, to match the host browsers send", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ PUBLIC_URL: "https://app.example.test./" }),
    );

    expect(read.ok && read.value.publicUrl).toBe("https://app.example.test");
    expect(read.ok && read.value.hostnames.app).toBe("app.example.test");
  });

  it("keeps a port beside the trailing dot it strips", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ PUBLIC_URL: "https://app.example.test.:8443" }),
    );

    expect(read.ok && read.value.publicUrl).toBe("https://app.example.test:8443");
    expect(read.ok && read.value.hostnames.app).toBe("app.example.test");
  });
});
