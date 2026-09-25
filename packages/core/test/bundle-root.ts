import { readdir, rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import type { PlatformPrincipal } from "../src/kernel/index.ts";
import { openGit, withRepositoryLockAs } from "../src/store/git/index.ts";

const ACTS_GONE_TIMEOUT_MS = 30_000;

const REMOVE_RETRIES = 10;
const REMOVE_RETRY_DELAY_MS = 50;

const teardown: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-teardown",
};

const BARE_SUFFIX = ".git";

/** Waits up to 30 seconds for an act still holding any bundle's lock, then removes the root. */
export const removeBundleRoot = async (root: string): Promise<void> => {
  await untilActsGone(root);
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: REMOVE_RETRIES,
    retryDelay: REMOVE_RETRY_DELAY_MS,
  });
};

const untilActsGone = async (root: string): Promise<void> => {
  const door = openGit(root);

  if (!door.ok) return;
  const entries = await readdir(root, { withFileTypes: true });

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
