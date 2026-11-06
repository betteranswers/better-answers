import { afterEach, describe, expect, it, vi } from "vitest";

import { ulid } from "@better-answers/schema";

import {
  childEnvironment,
  git,
  initRepository,
  repositoryPath,
} from "../../../src/store/git/door.ts";
import { bundlesForSuite } from "../../fixtures/bundle.ts";

const bundles = bundlesForSuite();

const SECRETS = {
  KEK: "0".repeat(64),
  AUTH_SECRET: "a".repeat(32),
  S3_SECRET_KEY: "object-store-secret",
} as const;

const stubSecrets = (): void => {
  for (const [name, value] of Object.entries(SECRETS)) vi.stubEnv(name, value);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the environment a git child receives", () => {
  it("leaves the platform's secrets out", () => {
    stubSecrets();

    const environment = childEnvironment();

    for (const name of Object.keys(SECRETS)) expect(environment).not.toHaveProperty(name);
  });

  it("keeps PATH and HOME from the platform", () => {
    vi.stubEnv("HOME", "/home/probe");

    const environment = childEnvironment();

    expect(environment["PATH"]).toBe(process.env["PATH"]);
    expect(environment["HOME"]).toBe("/home/probe");
  });

  it("passes TMPDIR only when the platform sets one", () => {
    vi.stubEnv("TMPDIR", "/var/scratch");
    expect(childEnvironment()["TMPDIR"]).toBe("/var/scratch");

    vi.stubEnv("TMPDIR", undefined);
    expect(childEnvironment()).not.toHaveProperty("TMPDIR");
  });

  it("adds the caller's names and pins LC_ALL to C", () => {
    vi.stubEnv("LC_ALL", "fr_FR.UTF-8");

    const environment = childEnvironment({ GIT_INDEX_FILE: "/staging/index", LC_ALL: "de_DE" });

    expect(environment["GIT_INDEX_FILE"]).toBe("/staging/index");
    expect(environment["LC_ALL"]).toBe("C");
  });
});

describe("a process that git starts", () => {
  it("sees PATH and none of the platform's secrets", async () => {
    stubSecrets();
    const workspaceId = ulid();
    const door = bundles();
    await initRepository(door, workspaceId);

    const seen = await git(repositoryPath(door, workspaceId), ["-c", "alias.dump=!env", "dump"]);

    const names = seen.split("\n").map((line) => line.slice(0, line.indexOf("=")));
    expect(names).toContain("PATH");
    for (const name of Object.keys(SECRETS)) expect(names).not.toContain(name);
  });
});
