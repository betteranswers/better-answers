import { describe, expect, it } from "vitest";

import { buildCommand, builderThatCanExport, sharedCacheBuilder } from "./image-probe.ts";

/**
 * The choice every image probe in this workspace makes before it builds: the layer cache a
 * runner can reach, or the build this repository has always run everywhere else.
 *
 * A pull request rebuilds the api image and the backup image from cold on every run, and
 * the only place to keep those layers is a cache the runner does not own — `type=gha`,
 * which a job reaches through credentials a runner hands to nothing else. So the choice is
 * made once, in one function of two readings, and the argv is the whole of it. Nothing here
 * needs a daemon: what these cases hold is that the fallback is *exactly* the command that
 * ran before the cache existed, that the cached arm carries every flag it cannot work
 * without, and that the two images keep their layers apart.
 *
 * They run wherever `check` runs, including the job that sets `IMAGE_PROBE_DEFERRED` and
 * leaves the contents probes to its own pushing job: a command chosen wrongly is a cold
 * build or a failed one on every runner, which is not a thing to learn from the workflow
 * that pushes.
 */

/** Both legs of `build.yml`'s image job that this workspace's suite builds. */
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
      "--cache-to",
      "type=gha,mode=max,scope=api",
      "--load",
      "--iidfile",
      "/tmp/the-id-this-build-wrote",
      "--file",
      "apps/api/Dockerfile",
      ".",
    ]);
    // `--quiet` is the id's source on this arm and on no other: buildx writes the id to the
    // `--iidfile` above, which is a file this run owns rather than a line to be picked out
    // of a build log.
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

    // A `type=gha` cache with no `scope=` is written under `buildkit`, and a scope holds one
    // manifest: two images exporting `mode=max` to one scope overwrite each other, and the
    // run after them reads a cache made for the other image and builds cold. Nothing in a
    // single run says so — the second of two runs is where it shows.
    expect(buildCommand(BACKUP, cached)).toContain("type=gha,scope=backup");
    expect(buildCommand(BACKUP, cached)).toContain("type=gha,mode=max,scope=backup");
    expect(buildCommand(API, cached)).not.toContain("type=gha,scope=backup");
  });

  it("refuses the daemon's own builder for a cached build and takes a container one", () => {
    // A driver is not a detail here. The `docker` driver builds into the daemon's own store
    // and has nowhere to put an export, so a build handed `--cache-to` on it stops with an
    // error; the container driver a runner's setup step creates is the one that can. Every
    // machine with Docker answers this question, and a reading that said yes to the daemon's
    // own builder would turn every laptop's build into a failure.
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
    // A builder that can export is no use without somewhere to export to, and the
    // credentials are the half that is missing on every machine but a runner mid-job. So
    // they are read first and the daemon is never asked — asserted by making the ask itself
    // a failure, because nothing is also what a machine with no Docker at all would answer
    // and the two would be indistinguishable.
    const refuseToAsk = (): Promise<string | undefined> => {
      throw new Error("the probe asked the daemon for a builder it could not have used");
    };

    await expect(sharedCacheBuilder({}, refuseToAsk)).resolves.toBeUndefined();
    // Each half alone, because either alone would leave the other's check able to be
    // deleted while this case stayed green: a runner exports both, and a machine holding
    // one of them is a machine the cache would refuse mid-build rather than before it.
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
