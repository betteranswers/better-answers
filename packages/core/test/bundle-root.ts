import { readdir, rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import type { PlatformPrincipal } from "../src/kernel/index.ts";
import { openGit, withRepositoryLockAs } from "../src/store/git/index.ts";

/**
 * How a suite's bundle root comes down: the acts still in flight on the repositories under it
 * first, then the removal — the git half of what `untilSessionsGone` does for the warm
 * Postgres (`packages/schema/test/warm-postgres.ts`, T-101), and written once here because two
 * harnesses make a root of their own and both raced the same way (T-172).
 *
 * **The race.** `rm(root, { recursive: true })` reads a directory's entries, removes each, then
 * `rmdir`s the directory. A git process that creates one more entry in between — a loose object
 * under `objects/<xx>/`, a `.lock` beside a ref, a pack being written — makes that `rmdir` fail
 * with `ENOTEMPTY`, and a file whose every assertion passed is reported red at file level. Four
 * runs saw it on 11/09/2026, all of them under load and none of them alone: `erasure-routine`,
 * `visibility` and the api's `ops`.
 *
 * **Where the residue comes from.** Every git call the door makes is awaited and no child is
 * detached, so nothing of the door's own outlives the act that started it. What outlives a
 * *test* is an act its body started and never awaited, or one parked behind the door's
 * per-repository lock: that lock is a promise chain per repository and nothing at teardown
 * waits on it, so a queued act can run while the root is being removed. `visibility.test.ts`
 * leaves acts on that chain on purpose, which is why it is one of the three files that failed.
 *
 * **Why taking the lock is the wait.** The chain is keyed by the repository's own path —
 * `<root>/<workspace>.git`, the same string for a person's act and for the platform's — so an
 * empty act at the back of it resolves only once everything ahead has left. Waiting removes the
 * race rather than papering over it, which is the argument T-101's comment makes at length and
 * this one does not repeat.
 *
 * **It answers the hook order too.** Vitest runs a file's `afterAll` hooks in reverse
 * registration order (4.1.11, measured 12/09/2026 rather than read off a default), and
 * `workspace-with-bundle.ts` registers the Postgres one first — so the bundle root goes while
 * the database is still up. A governed write holds this same lock from its hash precondition
 * through its Postgres COMMIT, so an act this drain has waited out has finished on both stores,
 * and the order stops mattering rather than having to be reversed.
 */

/**
 * How long the teardown waits for the acts on a root to leave before removing it anyway. A
 * runaway guard and not a budget: what it must not do is let one wedged act hold a suite open
 * to the `hookTimeout` of 120 s above it, and what it must not be is a second ceiling a real
 * act can cross.
 *
 * Six times `untilSessionsGone`'s five seconds, and the six is measured rather than chosen. A
 * governed write is six `git` children, and a child spawn that reads 4 ms on a quiet machine
 * read **~500 ms** under `packages/core`'s own `check` — six forks, a Postgres and up to four
 * Garages inside a 6-CPU VM (12/09/2026, and a five-second allowance gave up on a live act in
 * that run, which is what this number is). One act is therefore seconds under load and a short
 * queue of them is tens of seconds; thirty leaves four times the margin to the hook above it.
 */
const ACTS_GONE_TIMEOUT_MS = 30_000;

/**
 * The bounded fallback, and the reason it stays even with the wait in front of it: `fs.rm`
 * retries `EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY` and `EPERM` only when it is given these, and
 * `force` alone suppresses "does not exist" and nothing else. They answer for the writer the
 * wait cannot see — a `git` child a test body spawned against the root itself rather than
 * through the door — and they leave the behaviour of a root the wait gave up on no worse than
 * it was before this function existed.
 */
const REMOVE_RETRIES = 10;
const REMOVE_RETRY_DELAY_MS = 50;

/**
 * The Principal `withRepositoryLockAs` takes and never reads: it keys on the repository's path
 * and passes the Principal nowhere. Nothing here is audited and no row carries this.
 */
const teardown: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-teardown",
};

/** The door's own layout (ADR 0024): one bare repository per workspace, `<workspace>.git`. */
const BARE_SUFFIX = ".git";

export const removeBundleRoot = async (root: string): Promise<void> => {
  await untilActsGone(root);
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: REMOVE_RETRIES,
    retryDelay: REMOVE_RETRY_DELAY_MS,
  });
};

/**
 * Wait for every act the door knows about on every repository under `root`, for at most the
 * allowance above, taken once for the root rather than once per repository.
 *
 * The workspace ids are read back off the directory because `repositoryPath` is the door's own
 * and stays there. A layout that moved would leave this draining nothing, silently — which is
 * what `bundle-root.test.ts`'s first case is holding: it counts the writes an act made and
 * fails if the removal did not wait for all of them.
 */
const untilActsGone = async (root: string): Promise<void> => {
  const door = openGit(root);
  // Refused means there is no directory here to drain: a root a run already removed, or one a
  // suite never made. The removal answers for it, forcefully, as it always has.
  if (!door.ok) return;
  const entries = await readdir(root, { withFileTypes: true });
  // `ref: false` so an allowance nobody needed never holds the runner open after the last file.
  const allowance = sleep(ACTS_GONE_TIMEOUT_MS, undefined, { ref: false });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(BARE_SUFFIX))
      .map(async (entry) =>
        Promise.race([
          withRepositoryLockAs(
            teardown,
            door.value,
            entry.name.slice(0, -BARE_SUFFIX.length),
            async () => undefined,
          ),
          allowance,
        ]),
      ),
  );
};
