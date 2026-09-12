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

/**
 * The bundle root's teardown through its own interface (`[TEST1]`): what a harness that calls
 * `removeBundleRoot` is promised, and nothing about how it is kept.
 *
 * **What is asserted, and why it is not the `ENOTEMPTY`.** The symptom T-172 was cut for is a
 * race: `rm` reads a directory's entries, removes each, then `rmdir`s it, and a git process
 * that creates one more entry in between turns a file whose every assertion passed red. It
 * needs load to show — on a quiet machine the removal wins every time, which was measured
 * before these cases were written rather than assumed (five attempts, four concurrent
 * writers, a repository of three hundred objects: the removal resolved on all five). A case
 * that waited for the crash would therefore pass for the wrong reason on the machine that
 * runs it. What is asserted instead is the property that makes the crash impossible — when
 * the removal starts, the acts the door knows about have finished — and its boundary, which
 * is that a writer the door does not know about is not waited for at all.
 */

const run = promisify(execFile);

/** The lock takes a Principal and reads nothing off it; this is the witness that argument wants. */
const PLATFORM: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-teardown",
};

/** One workspace per root, so the repository under it is `<root>/<this>.git`. */
const WORKSPACE = "01K4TEARDOWN000000000000";

/**
 * How long the act below stands between its two writes. It is what gives a teardown that did
 * **not** wait the time to be caught: a bare `rm` of this tree read 77 ms on this machine, so
 * one has finished several times over before the second write lands.
 *
 * No green here rests on it. What holds the removal off is the lock, for as long as the act
 * runs and however long that is; the pause is only what makes the case able to go red.
 */
const ACT_PAUSE_MS = 250;

/**
 * Enough objects that the writer is still inside the repository when a teardown starts, and
 * more than any teardown could wait through: what the second case is for is a removal that
 * went ahead without it. It costs no more than a handful, because a child whose repository has
 * gone exits at once.
 */
const OBJECTS_NOBODY_WAITS_FOR = 400;

/** A bundle root with one repository in it, the way both harnesses make theirs. */
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

/**
 * One loose object, written into the repository by a `git` child of its own — a git process
 * inside the bundle, and the entry an `rmdir` trips over: a loose object lands as a new file
 * under `objects/<xx>/`, in a directory the walk may already have read. A child whose
 * repository has gone exits non-zero, which is how a case reads whether the removal waited.
 */
const objectWrittenInto = async (gitDir: string, scratch: string, n: number): Promise<void> => {
  const source = path.join(scratch, `object-${n}`);
  await writeFile(source, `object ${n}\n`);
  await run("git", ["--git-dir", gitDir, "hash-object", "-w", "--", source]);
};

/** Somewhere outside the bundle root to write from, since the root is what goes. */
const scratchDir = (): Promise<string> => mkdtemp(path.join(tmpdir(), "better-answers-objects-"));

/** Whether the root is off the filesystem — the other half of every claim below. */
const isGone = async (root: string): Promise<boolean> => {
  try {
    await stat(root);
    return false;
  } catch {
    // Anything that cannot stat it: on this path the only one is the directory not being
    // there, which is what the teardown was asked for.
    return true;
  }
};

describe("a bundle root's teardown", () => {
  it("waits for an act still writing into a bundle before it removes the root", async () => {
    const { root, door, gitDir } = await rootWithBundle();
    const scratch = await scratchDir();
    let written = 0;
    // The act the door's own lock knows about: a governed write holds this lock from its hash
    // precondition through its COMMIT, and a test body that starts one and never awaits it —
    // `visibility.test.ts` does, on purpose — leaves exactly this behind for a teardown. Two
    // writes with a pause between them, so that what the second one proves is the wait: a
    // repository removed while this act ran is one its last child cannot write into.
    const act = withRepositoryLockAs(PLATFORM, door, WORKSPACE, async () => {
      await objectWrittenInto(gitDir, scratch, 1);
      written = 1;
      await sleep(ACT_PAUSE_MS);
      await objectWrittenInto(gitDir, scratch, 2);
      written = 2;
    }).then(
      () => "finished",
      // Read rather than thrown, and settled here rather than after the teardown, so an act
      // whose repository went out from under it is a line in the diff below instead of a
      // rejection Vitest reports against whichever file was running when it landed.
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
    // Its children fail the moment the repository goes, which is what this case is about; the
    // handler is attached at the call rather than after the teardown, so the rejection is
    // never briefly unhandled.
    const writing = (async () => {
      for (let n = 0; n < OBJECTS_NOBODY_WAITS_FOR; n += 1) {
        await objectWrittenInto(gitDir, scratch, n);
        written = n + 1;
      }
    })().catch(() => undefined);
    await until(async () => written > 0);

    await removeBundleRoot(root);

    // The wait is the door's lock and nothing else. A child a test body spawned against the
    // root itself is not on it, so the removal goes ahead as it always did — which is the
    // bound: a teardown is never held open by a writer whose end nobody can see.
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
