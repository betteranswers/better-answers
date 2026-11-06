import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import { repositoryRoot } from "../paths.ts";

const SCRIPT = path.join(repositoryRoot, "scripts/test-inventory.sh");

const TIMEOUT_MS = 5 * 60 * 1000;

const LOG_LINES_KEPT = 30;

export type Inventory =
  | { readonly kind: "unchanged"; readonly cases: number }
  | { readonly kind: "changed"; readonly changes: readonly string[] }
  | { readonly kind: "unlisted"; readonly reason: string };

type Lists = ReadonlyMap<string, readonly string[]>;

type Listing = { readonly lists: Lists } | { readonly failure: string };

const linesOf = (file: string): readonly string[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "");

const listsIn = (folder: string): Lists =>
  new Map(readdirSync(folder).map((file) => [file, linesOf(path.join(folder, file))]));

const listingOf = (tree: string, into: string, signal: AbortSignal): Promise<Listing> => {
  mkdirSync(into, { recursive: true });
  const listing = spawn(SCRIPT, [into], {
    cwd: tree,
    stdio: ["ignore", "ignore", "pipe"],
    timeout: TIMEOUT_MS,
    signal,
  });
  let log = "";
  listing.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    log += chunk;
  });
  return new Promise((resolve, reject) => {
    listing.once("error", reject);
    listing.once("close", (status, killedBy) => {
      if (status === 0) {
        resolve({ lists: listsIn(into) });
        return;
      }
      const tail = log.trim().split("\n").slice(-LOG_LINES_KEPT).join("\n");
      resolve({ failure: `exit ${String(status ?? killedBy)}\n${tail}`.trim() });
    });
  });
};

type Entry = { readonly list: string; readonly line: string };

const entriesOf = (lists: Lists): readonly Entry[] =>
  [...lists]
    .sort(([one], [other]) => byCodeUnit(one, other))
    .flatMap(([list, lines]) => lines.map((line) => ({ list, line })));

const unmatched = (entries: readonly Entry[], others: readonly Entry[]): readonly Entry[] => {
  const remaining = new Map<string, number>();
  for (const { line } of others) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  return entries.filter(({ line }) => {
    const count = remaining.get(line) ?? 0;
    if (count === 0) return true;
    remaining.set(line, count - 1);
    return false;
  });
};

const changesBetween = (before: Lists, after: Lists): readonly string[] => {
  const was = entriesOf(before);
  const now = entriesOf(after);
  return [
    ...unmatched(was, now).map(({ list, line }) => `${list}: removed ${line}`),
    ...unmatched(now, was).map(({ list, line }) => `${list}: added ${line}`),
  ];
};

/**
 * Compares the tests of both trees as one repository-wide multiset of `file :: title` lines. Two
 * listings at once ran slower than two in turn.
 */
export const inventoryAcross = async (
  before: string,
  after: string,
  work: string,
  signal: AbortSignal,
): Promise<Inventory> => {
  const was = await listingOf(before, path.join(work, "before"), signal);
  if ("failure" in was) {
    throw new Error(
      `scripts/test-inventory.sh failed before the move, so nothing moved\n${was.failure}`,
    );
  }
  const now = await listingOf(after, path.join(work, "after"), signal);
  if ("failure" in now) return { kind: "unlisted", reason: now.failure };
  const changes = changesBetween(was.lists, now.lists);
  return changes.length === 0
    ? { kind: "unchanged", cases: entriesOf(now.lists).length }
    : { kind: "changed", changes };
};
