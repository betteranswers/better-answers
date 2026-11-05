import { assert, describe, expect, it } from "vitest";

import {
  readBootstrap,
  readEnvelopeKey,
  readHeadCheck,
  readIdentityBootstrap,
  readObjectStore,
  readRunningImage,
  readStop,
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
  it("reads the database URL, port and web root, nothing else", () => {
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

  it("reads GIT_STORE_DIR as the root of the bare repositories", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x", GIT_STORE_DIR: "/data/git" });

    assert(read.ok, "the read was refused");
    expect(read.value.gitStoreDir).toBe("/data/git");
  });

  it("accepts no GIT_STORE_DIR, because `migrate` opens no bundle", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x" });

    assert(read.ok, "the read was refused");
    expect(read.value.gitStoreDir).toBe(undefined);
  });

  it("refuses an empty GIT_STORE_DIR, which means the working directory", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x", GIT_STORE_DIR: "" });

    expect(read.ok).toBe(false);
  });

  it("defaults WEB_ROOT to apps/web/dist, so dev sets nothing", () => {
    const read = readBootstrap({ DATABASE_URL: "postgresql://x@db/x" });

    assert(read.ok, "the read was refused");
    expect(read.value.webRoot.endsWith("/apps/web/dist")).toBe(true);
  });

  it("reads the five S3 settings into the object store's config", () => {
    const read = readObjectStore({
      S3_ENDPOINT: "http://objectstore:3900",
      S3_BUCKET: "better-answers",

      S3_REGION: "garage",
      S3_ACCESS_KEY: "GK31c2f218a2e44f485b94239e",
      S3_SECRET_KEY: "b892c0665f0ada8a4755dae98baa3b133590e11dae3bcc1f9d769d67f16c3835",
    });

    assert(read.ok, "the read was refused");
    expect(read.value).toEqual({
      endpoint: "http://objectstore:3900",
      region: "garage",
      bucket: "better-answers",
      accessKeyId: "GK31c2f218a2e44f485b94239e",
      secretAccessKey: "b892c0665f0ada8a4755dae98baa3b133590e11dae3bcc1f9d769d67f16c3835",
    });
  });

  it("accepts any S3_REGION, for stores other than Garage", () => {
    const read = readObjectStore({
      S3_ENDPOINT: "https://s3.eu-west-2.amazonaws.com",
      S3_BUCKET: "better-answers",
      S3_REGION: "eu-west-2",
      S3_ACCESS_KEY: "key",
      S3_SECRET_KEY: "secret",
    });

    assert(read.ok, "the read was refused");
    expect(read.value.region).toBe("eu-west-2");
  });

  it("refuses a missing object store without throwing", () => {
    expect(readObjectStore({ DATABASE_URL: "postgresql://x@db/x" }).ok).toBe(false);
  });

  it.each(["S3_ENDPOINT", "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY"])(
    "refuses an object store missing %s",
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

  it("refuses an S3_ENDPOINT without a scheme", () => {
    const read = readObjectStore({
      S3_ENDPOINT: "objectstore:3900",
      S3_BUCKET: "better-answers",
      S3_REGION: "garage",
      S3_ACCESS_KEY: "key",
      S3_SECRET_KEY: "secret",
    });

    expect(read.ok).toBe(false);
  });

  it("reads the normalised PUBLIC_URL, AUTH_SECRET and three hostnames", () => {
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

  it("refuses a short AUTH_SECRET", () => {
    expect(readIdentityBootstrap(identityEnvironment({ AUTH_SECRET: "short" })).ok).toBe(false);
  });

  it("reads SMTP_URL, the transport for sign-in emails", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ SMTP_URL: "smtps://resend:key@smtp.example.test:465" }),
    );

    assert(read.ok, "the read was refused");
    expect(read.value.smtpUrl).toBe("smtps://resend:key@smtp.example.test:465");
  });

  it("accepts no SMTP_URL, since dev and tests send no email", () => {
    const read = readIdentityBootstrap(identityEnvironment());

    assert(read.ok, "the read was refused");
    expect(read.value.smtpUrl).toBe(undefined);
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

describe("the upload sweep's settings", () => {
  it("defaults to listing uploads and pinging no health check", () => {
    expect(readSweeps({})).toEqual({
      ok: true,
      value: { uploadSweep: "list", pingUrl: undefined },
    });
  });

  it("reads UPLOAD_SWEEP=remove and the sweep's health-check ping URL", () => {
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
  ])("refuses UPLOAD_SWEEP with %s", (_case, word) => {
    expect(readSweeps({ UPLOAD_SWEEP: word }).ok, "the read accepted the unknown value").toBe(
      false,
    );
  });

  it.each([
    ["no scheme", "hc-ping.com/0f5e8a2c"],
    ["another scheme", "ftp://hc-ping.com/0f5e8a2c"],
    ["an empty value", ""],
    ["credentials", "https://who:secret@hc-ping.com/0f5e8a2c"],
  ])("refuses a health-check ping URL with %s", (_case, url) => {
    expect(readSweeps({ HEALTHCHECKS_PING_URL_SWEEPS: url }).ok).toBe(false);
  });
});

describe("the head check's settings", () => {
  it("pings no health check unless HEALTHCHECKS_PING_URL_SCHEDULER is set", () => {
    expect(readHeadCheck({})).toEqual({ ok: true, value: { pingUrl: undefined } });
  });

  it("pings the URL in HEALTHCHECKS_PING_URL_SCHEDULER when it is set", () => {
    const read = readHeadCheck({
      HEALTHCHECKS_PING_URL_SCHEDULER: "https://hc-ping.com/7c1d9e4a-2b6f-4e83-a5d0-9f3c8b1e6a27",
    });

    expect(read).toEqual({
      ok: true,
      value: { pingUrl: "https://hc-ping.com/7c1d9e4a-2b6f-4e83-a5d0-9f3c8b1e6a27" },
    });
  });

  it("ignores HEALTHCHECKS_PING_URL_SWEEPS", () => {
    const read = readHeadCheck({
      HEALTHCHECKS_PING_URL_SWEEPS: "https://hc-ping.com/0f5e8a2c-5d3a-4c55-9d0e-2b8c1f7a6e41",
    });

    expect(read).toEqual({ ok: true, value: { pingUrl: undefined } });
  });

  it.each([
    ["no scheme", "hc-ping.com/7c1d9e4a"],
    ["another scheme", "ftp://hc-ping.com/7c1d9e4a"],
    ["an empty value", ""],
    ["a user and password", "https://who:secret@hc-ping.com/7c1d9e4a"],
    ["a user alone", "https://who@hc-ping.com/7c1d9e4a"],
    ["a password alone", "https://:secret@hc-ping.com/7c1d9e4a"],
  ])("refuses a health-check ping URL with %s", (_case, url) => {
    expect(readHeadCheck({ HEALTHCHECKS_PING_URL_SCHEDULER: url }).ok).toBe(false);
  });

  it("names the refused setting but not its value", () => {
    const read = readHeadCheck({ HEALTHCHECKS_PING_URL_SCHEDULER: "hc-ping.com/7c1d9e4a" });

    assert(!read.ok, "the read was accepted");
    const reason = read.error.message;
    expect(reason).toContain("HEALTHCHECKS_PING_URL_SCHEDULER");
    expect(reason).not.toContain("7c1d9e4a");
  });
});

describe("the stop deadline setting", () => {
  it("defaults the stop deadline to 10 seconds", () => {
    expect(readStop({})).toEqual({ ok: true, value: { deadlineMs: 10_000 } });
  });

  it("reads the stop deadline from STOP_DEADLINE_MS", () => {
    expect(readStop({ STOP_DEADLINE_MS: "500" })).toEqual({
      ok: true,
      value: { deadlineMs: 500 },
    });
  });

  it.each(["0", "-1", "1.5", "soon", ""])(
    "refuses '%s' as STOP_DEADLINE_MS, which needs a positive whole number",
    (value) => {
      expect(readStop({ STOP_DEADLINE_MS: value }).ok).toBe(false);
    },
  );
});

describe("the envelope key", () => {
  const KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const KEY_AS_BYTES = Uint8Array.from({ length: 32 }, (_byte, index) => index);

  it("decodes KEK from 64 hexadecimal characters to 32 bytes", () => {
    expect(readEnvelopeKey({ KEK: KEY_HEX })).toEqual({ ok: true, value: KEY_AS_BYTES });
  });

  it("decodes uppercase hexadecimal to the same bytes", () => {
    expect(readEnvelopeKey({ KEK: KEY_HEX.toUpperCase() })).toEqual({
      ok: true,
      value: KEY_AS_BYTES,
    });
  });

  it.each([
    ["no value", undefined],
    ["an empty value", ""],
    ["a key one byte short", KEY_HEX.slice(2)],
    ["a key one byte too long", `${KEY_HEX}20`],
    ["the same bytes in base64", Buffer.from(KEY_HEX, "hex").toString("base64")],
    ["a key with a trailing space", `${KEY_HEX} `],
  ])("refuses %s for KEK", (_case, value) => {
    const read = readEnvelopeKey({ KEK: value });

    assert(!read.ok, "the read was accepted");
    expect(read.error.message).toContain("KEK");
  });

  it("names the refused setting but not its value", () => {
    const almost = `${KEY_HEX.slice(0, -1)}g`;
    const read = readEnvelopeKey({ KEK: almost });

    assert(!read.ok, "the read was accepted");
    const reason = read.error.message;
    expect(reason).toContain("KEK");
    expect(reason).not.toContain(almost);
    expect(reason).not.toContain(almost.slice(0, 8));
  });
});

describe("the api's image digest", () => {
  const DIGEST = "sha256:9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d";

  it("reads the image digest from API_IMAGE_DIGEST", () => {
    expect(readRunningImage({ API_IMAGE_DIGEST: DIGEST })).toEqual({
      ok: true,
      value: { digest: DIGEST },
    });
  });

  it("leaves the digest undefined when unset, as in dev", () => {
    expect(readRunningImage({})).toEqual({ ok: true, value: { digest: undefined } });
  });

  it("ignores WORKER_IMAGE_DIGEST", () => {
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
  ])("refuses %s for API_IMAGE_DIGEST", (_case, value) => {
    const read = readRunningImage({ API_IMAGE_DIGEST: value });

    assert(!read.ok, "the read accepted a value that is not an image digest");
    expect(read.error.message).toContain("API_IMAGE_DIGEST");
  });
});

describe("the app, agent and apex hostnames", () => {
  it.each(["PUBLIC_URL", "AGENT_HOSTNAME", "APEX_HOSTNAME"])("refuses a missing %s", (name) => {
    expect(readIdentityBootstrap(identityEnvironment({ [name]: undefined })).ok).toBe(false);
  });

  it("ignores APP_HOSTNAME, since the app hostname is PUBLIC_URL's host", () => {
    const read = readIdentityBootstrap(identityEnvironment({ APP_HOSTNAME: "elsewhere.test" }));

    assert(read.ok, "the read was refused");
    expect(read.value.hostnames.app).toBe("app.example.test");
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
    ["a label starting with a hyphen", "-agent.example.test"],

    ["a padded IPv4 spelling", "127.000.000.001"],
    ["a hexadecimal IPv4 spelling", "0x7f.1"],
  ])("refuses AGENT_HOSTNAME with %s", (_case, hostname) => {
    expect(readIdentityBootstrap(identityEnvironment({ AGENT_HOSTNAME: hostname })).ok).toBe(false);
  });

  it("takes the app hostname from PUBLIC_URL's host", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ PUBLIC_URL: "https://product.example.test" }),
    );

    assert(read.ok, "the read was refused");
    expect(read.value.hostnames.app).toBe("product.example.test");
  });

  it("refuses an agent hostname equal to the apex hostname", () => {
    const read = readIdentityBootstrap(identityEnvironment({ AGENT_HOSTNAME: "example.test" }));

    expect(read.ok).toBe(false);
  });

  it.each(Object.entries(HOSTNAMES))("refuses an app hostname equal to %s", (_name, hostname) => {
    const read = readIdentityBootstrap(identityEnvironment({ PUBLIC_URL: `https://${hostname}` }));

    expect(read.ok).toBe(false);
  });

  it.each([
    ["a padded IPv4 spelling", "https://127.000.000.001"],
    ["a hexadecimal IPv4 spelling", "https://0x7f.1"],
    ["a percent-encoded label", "https://%61pp.example.test"],

    ["an IPv6 literal", "https://[::1]"],

    ["an empty final label", "https://app.example.test.."],
  ])("refuses %s in PUBLIC_URL's host", (_case, url) => {
    expect(readIdentityBootstrap(identityEnvironment({ PUBLIC_URL: url })).ok).toBe(false);
  });

  it("lower-cases a hostname, since DNS ignores case", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ AGENT_HOSTNAME: "Agent.Example.Test" }),
    );

    assert(read.ok, "the read was refused");
    expect(read.value.hostnames.agent).toBe("agent.example.test");
  });

  it("strips PUBLIC_URL's trailing dot, to match the host browsers send", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ PUBLIC_URL: "https://app.example.test./" }),
    );

    assert(read.ok, "the read was refused");
    expect(read.value.publicUrl).toBe("https://app.example.test");
    expect(read.value.hostnames.app).toBe("app.example.test");
  });

  it("keeps PUBLIC_URL's port when stripping the trailing dot", () => {
    const read = readIdentityBootstrap(
      identityEnvironment({ PUBLIC_URL: "https://app.example.test.:8443" }),
    );

    assert(read.ok, "the read was refused");
    expect(read.value.publicUrl).toBe("https://app.example.test:8443");
    expect(read.value.hostnames.app).toBe("app.example.test");
  });
});
