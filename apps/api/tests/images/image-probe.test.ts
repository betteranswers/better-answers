import { describe, expect, it } from "vitest";

import { buildCommand, builderThatCanExport, sharedCache } from "./image-probe.ts";

const API = { tier: "api", dockerfile: "apps/api/Dockerfile", context: "." };
const BACKUP = { tier: "backup", dockerfile: "deploy/backup.Dockerfile", context: "deploy" };

const CACHED = {
  cache: { builder: "the-container-builder", registry: "ghcr.io/an-owner" },
  iidfile: "/tmp/the-id-this-build-wrote",
};

describe("the docker build command an image probe runs", () => {
  it("uses buildx with a shared cache, else a plain build", () => {
    expect(buildCommand(API, CACHED)).toEqual([
      "docker",
      "buildx",
      "build",
      "--builder",
      "the-container-builder",
      "--cache-from",
      "type=registry,ref=ghcr.io/an-owner/api:buildcache",
      "--load",
      "--iidfile",
      "/tmp/the-id-this-build-wrote",
      "--file",
      "apps/api/Dockerfile",
      ".",
    ]);

    expect(buildCommand(API, { cache: undefined, iidfile: CACHED.iidfile })).toEqual([
      "docker",
      "build",
      "--quiet",
      "--file",
      "apps/api/Dockerfile",
      ".",
    ]);
  });

  it("reads each image's cache from that image's own tag", () => {
    expect(buildCommand(BACKUP, CACHED)).toContain(
      "type=registry,ref=ghcr.io/an-owner/backup:buildcache",
    );
    expect(buildCommand(API, CACHED)).not.toContain(
      "type=registry,ref=ghcr.io/an-owner/backup:buildcache",
    );
  });

  it("reads the shared cache without exporting to it", () => {
    expect(buildCommand(BACKUP, CACHED)).toEqual([
      "docker",
      "buildx",
      "build",
      "--builder",
      "the-container-builder",
      "--cache-from",
      "type=registry,ref=ghcr.io/an-owner/backup:buildcache",
      "--load",
      "--iidfile",
      "/tmp/the-id-this-build-wrote",
      "--file",
      "deploy/backup.Dockerfile",
      "deploy",
    ]);
  });

  it("picks a docker-container builder and rejects the default one", () => {
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

  it("queries the builder only when IMAGE_CACHE_REGISTRY is set", async () => {
    const refuseToAsk = (): Promise<string | undefined> => {
      throw new Error("the probe asked the daemon for a builder it could not have used");
    };

    await expect(sharedCache({}, refuseToAsk)).resolves.toBeUndefined();
    await expect(sharedCache({ IMAGE_CACHE_REGISTRY: "  " }, refuseToAsk)).resolves.toBeUndefined();
    expect(
      await sharedCache({ IMAGE_CACHE_REGISTRY: "ghcr.io/an-owner" }, () =>
        Promise.resolve("Name: builder-1c0ffee\nDriver: docker-container\n"),
      ),
    ).toEqual({ builder: "builder-1c0ffee", registry: "ghcr.io/an-owner" });
    expect(
      await sharedCache({ IMAGE_CACHE_REGISTRY: "ghcr.io/an-owner" }, () =>
        Promise.resolve("Name: default\nDriver: docker\n"),
      ),
    ).toBeUndefined();
  });
});
