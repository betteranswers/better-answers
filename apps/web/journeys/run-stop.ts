import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { test } from "@playwright/test";

import { couldNotRun } from "./outcome.ts";

const POSSIBLE_COMPROMISE = "possible compromise";

/**
 * A file, as a failed journey restarts the worker. A command-line run empties this folder first;
 * a stale stop, as UI mode keeps, fails closed.
 */
const stopFile = (): string => path.join(test.info().project.outputDir, "journeys-stopped");

/** The reason reaches the run's summary, so it never names an address. */
export const stopTheRun = (reason: string): never => {
  const file = stopFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${POSSIBLE_COMPROMISE}\n`);
  return couldNotRun(`${reason}: ${POSSIBLE_COMPROMISE}`);
};

/** Before a sign-in, so nobody signs in to a test workspace the Admin found changed. */
export const goOnUnlessStopped = (): void => {
  if (!existsSync(stopFile())) return;
  couldNotRun(
    `the Admin's journey found the test workspace changed, so nobody else signs in: ${POSSIBLE_COMPROMISE}`,
  );
};
