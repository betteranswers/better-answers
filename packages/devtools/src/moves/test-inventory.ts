import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import { repositoryRoot } from "../paths.ts";

const SCRIPT = path.join(repositoryRoot, "scripts/test-inventory.sh");

const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;

const TIMEOUT_MS = 5 * 60 * 1000;

const LOG_LINES_KEPT = 30;

export type Inventory =
  | { readonly kind: "unchanged"; readonly cases: number }
  | { readonly kind: "changed"; readonly changes: readonly string[] }
  | { readonly kind: "unlisted"; readonly reason: string };

type Lists = ReadonlyMap<string, readonly string[]>;

type Listing = { readonly lists: Lists } | { readonly failure: string };

const failureOf = (taken: SpawnSyncReturns<string>): string | undefined => {
  if (taken.error !== undefined) return taken.error.message;
  if (taken.status === 0) return undefined;
  const log = taken.stderr.trim().split("\n").slice(-LOG_LINES_KEPT).join("\n");
  return `exit ${String(taken.status)}\n${log}`.trim();
};

const takeInventory = (root: string, into: string): string | undefined =>
  failureOf(
    spawnSync(SCRIPT, [into], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: OUTPUT_LIMIT_BYTES,
      timeout: TIMEOUT_MS,
    }),
  );

const linesOf = (file: string): readonly string[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "");

const listingOf = (root: string): Listing => {
  const scratch = mkdtempSync(path.join(tmpdir(), "move-files-inventory-"));
  try {
    const failure = takeInventory(root, scratch);
    if (failure !== undefined) return { failure };
    const lists = new Map<string, readonly string[]>();
    for (const file of readdirSync(scratch)) lists.set(file, linesOf(path.join(scratch, file)));
    return { lists };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

const casesIn = (lists: Lists): number =>
  [...lists.values()].reduce((total, lines) => total + lines.length, 0);

const without = (lines: readonly string[], others: readonly string[]): readonly string[] => {
  const remaining = new Map<string, number>();
  for (const line of others) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  return lines.filter((line) => {
    const count = remaining.get(line) ?? 0;
    if (count === 0) return true;
    remaining.set(line, count - 1);
    return false;
  });
};

const changesBetween = (before: Lists, after: Lists): readonly string[] =>
  [...new Set([...before.keys(), ...after.keys()])].sort(byCodeUnit).flatMap((file) => {
    const was = before.get(file) ?? [];
    const now = after.get(file) ?? [];
    return [
      ...without(was, now).map((line) => `${file}: removed ${line}`),
      ...without(now, was).map((line) => `${file}: added ${line}`),
    ];
  });

export const holdInventory = (root: string): (() => Inventory) => {
  const before = listingOf(root);
  if ("failure" in before) {
    throw new Error(
      `scripts/test-inventory.sh failed before the move, so nothing moved\n${before.failure}`,
    );
  }
  return () => {
    const after = listingOf(root);
    if ("failure" in after) return { kind: "unlisted", reason: after.failure };
    const changes = changesBetween(before.lists, after.lists);
    return changes.length === 0
      ? { kind: "unchanged", cases: casesIn(after.lists) }
      : { kind: "changed", changes };
  };
};
