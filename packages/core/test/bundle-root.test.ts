import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { PlatformPrincipal } from "../src/kernel/index.ts";
import {
  initRepository,
  openGit,
  withRepositoryLockAs,
  type GitDoor,
} from "../src/store/git/index.ts";
import { removeBundleRoot } from "./bundle-root.ts";
import { until } from "./suite-postgres.ts";

const run = promisify(execFile);

const PLATFORM: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-teardown",
};

const WORKSPACE = "01K4TEARDOWN000000000000";

// What lets the case go red: a teardown that never waits finishes in tens of milliseconds, so
// a shorter pause passes against it.
const ACT_PAUSE_MS = 250;

const OBJECTS_NOBODY_WAITS_FOR = 400;

const rootWithBundle = async (): Promise<{
  readonly root: string;
  readonly door: GitDoor;
  readonly gitDir: string;
}> => {
  const root = await mkdtemp(path.join(tmpdir(), "better-answers-bundles-"));
  const opened = openGit(root);
  if (!opened.ok) throw new Error(`the bundle root was refused: ${opened.error}`);
  return { root, door: opened.value, gitDir: await initRepository(opened.value, WORKSPACE) };
};

const objectWrittenInto = async (gitDir: string, scratch: string, n: number): Promise<void> => {
  const source = path.join(scratch, `object-${n}`);
  await writeFile(source, `object ${n}\n`);
  await run("git", ["--git-dir", gitDir, "hash-object", "-w", "--", source]);
};

const scratchDir = (): Promise<string> => mkdtemp(path.join(tmpdir(), "better-answers-objects-"));

const isGone = async (root: string): Promise<boolean> => {
  try {
    await stat(root);
    return false;
  } catch {
    return true;
  }
};

describe("a bundle root's teardown", () => {
  it("waits for an act still writing into a bundle before it removes the root", async () => {
    const { root, door, gitDir } = await rootWithBundle();
    const scratch = await scratchDir();
    let written = 0;

    const act = withRepositoryLockAs(PLATFORM, door, WORKSPACE, async () => {
      await objectWrittenInto(gitDir, scratch, 1);
      written = 1;
      await sleep(ACT_PAUSE_MS);
      await objectWrittenInto(gitDir, scratch, 2);
      written = 2;
    }).then(
      () => "finished",

      (cause: unknown) => `failed: ${String(cause)}`,
    );
    await until(async () => written > 0);

    await removeBundleRoot(root);

    expect({ written, act: await act, gone: await isGone(root) }).toEqual({
      written: 2,
      act: "finished",
      gone: true,
    });
    await rm(scratch, { recursive: true, force: true });
  });

  it("does not wait for a git process the lock does not know about", async () => {
    const { root, gitDir } = await rootWithBundle();
    const scratch = await scratchDir();
    let written = 0;

    const writing = (async () => {
      for (let n = 0; n < OBJECTS_NOBODY_WAITS_FOR; n += 1) {
        await objectWrittenInto(gitDir, scratch, n);
        written = n + 1;
      }
    })().catch(() => undefined);
    await until(async () => written > 0);

    await removeBundleRoot(root);

    expect({ finished: written === OBJECTS_NOBODY_WAITS_FOR, gone: await isGone(root) }).toEqual({
      finished: false,
      gone: true,
    });
    await writing;
    await rm(scratch, { recursive: true, force: true });
  });

  it("removes a root that holds no repository at all", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "better-answers-bundles-"));
    await writeFile(path.join(root, "not-a-bundle"), "a file no workspace put here\n");

    await removeBundleRoot(root);

    expect(await isGone(root)).toBe(true);
  });

  it("answers for a root that is already gone", async () => {
    const { root } = await rootWithBundle();
    await rm(root, { recursive: true, force: true });

    await removeBundleRoot(root);

    expect(await isGone(root)).toBe(true);
  });
});
