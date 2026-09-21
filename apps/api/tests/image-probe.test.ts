import { describe, expect, it } from "vitest";

import { buildCommand, builderThatCanExport, sharedCacheBuilder } from "./image-probe.ts";

const API = { tier: "api", dockerfile: "apps/api/Dockerfile", context: "." };
const BACKUP = { tier: "backup", dockerfile: "deploy/backup.Dockerfile", context: "deploy" };

describe("the build an image probe runs", () => {
  it("goes through buildx on a runner and builds as it always did on a laptop", () => {
    const writtenTo = "/tmp/the-id-this-build-wrote";

    expect(buildCommand(API, { builder: "the-container-builder", iidfile: writtenTo })).toEqual([
      "docker",
      "buildx",
      "build",
      "--builder",
      "the-container-builder",
      "--cache-from",
      "type=gha,scope=api",
      "--load",
      "--iidfile",
      "/tmp/the-id-this-build-wrote",
      "--file",
      "apps/api/Dockerfile",
      ".",
    ]);

    expect(buildCommand(API, { builder: undefined, iidfile: writtenTo })).toEqual([
      "docker",
      "build",
      "--quiet",
      "--file",
      "apps/api/Dockerfile",
      ".",
    ]);
  });

  it("keeps each image's layers under a scope of its own, so neither evicts the other", () => {
    const cached = { builder: "the-container-builder", iidfile: "/tmp/the-id-this-build-wrote" };

    expect(buildCommand(BACKUP, cached)).toContain("type=gha,scope=backup");
    expect(buildCommand(API, cached)).not.toContain("type=gha,scope=backup");
  });

  it("reads the shared cache and exports nothing to it", () => {
    const cached = { builder: "the-container-builder", iidfile: "/tmp/the-id-this-build-wrote" };

    expect(buildCommand(BACKUP, cached)).toEqual([
      "docker",
      "buildx",
      "build",
      "--builder",
      "the-container-builder",
      "--cache-from",
      "type=gha,scope=backup",
      "--load",
      "--iidfile",
      "/tmp/the-id-this-build-wrote",
      "--file",
      "deploy/backup.Dockerfile",
      "deploy",
    ]);
  });

  it("refuses the daemon's own builder for a cached build and takes a container one", () => {
    expect(
      builderThatCanExport(
        "Name:          builder-1c0ffee\n" +
          "Driver:        docker-container\n" +
          "Last Activity: 2026-09-13 09:14:22 +0000 UTC\n" +
          "\n" +
          "Nodes:\n" +
          "Name:      builder-1c0ffee0\n" +
          "Endpoint:  unix:///var/run/docker.sock\n" +
          "Status:    running\n",
      ),
    ).toBe("builder-1c0ffee");
    expect(
      builderThatCanExport(
        "Name:          default\n" +
          "Driver:        docker\n" +
          "Last Activity: 2026-09-13 09:14:22 +0000 UTC\n" +
          "\n" +
          "Nodes:\n" +
          "Name:      default\n" +
          "Endpoint:  default\n" +
          "Status:    running\n",
      ),
    ).toBeUndefined();
  });

  it("asks the daemon nothing on a machine without the cache credentials", async () => {
    const refuseToAsk = (): Promise<string | undefined> => {
      throw new Error("the probe asked the daemon for a builder it could not have used");
    };

    await expect(sharedCacheBuilder({}, refuseToAsk)).resolves.toBeUndefined();

    await expect(
      sharedCacheBuilder({ ACTIONS_RUNTIME_TOKEN: "a-token" }, refuseToAsk),
    ).resolves.toBeUndefined();
    await expect(
      sharedCacheBuilder(
        { ACTIONS_RESULTS_URL: "https://results.example/_apis/artifactcache/" },
        refuseToAsk,
      ),
    ).resolves.toBeUndefined();
    expect(
      await sharedCacheBuilder(
        {
          ACTIONS_RUNTIME_TOKEN: "a-token",
          ACTIONS_RESULTS_URL: "https://results.example/_apis/artifactcache/",
        },
        () => Promise.resolve("Name: builder-1c0ffee\nDriver: docker-container\n"),
      ),
    ).toBe("builder-1c0ffee");
  });
});
