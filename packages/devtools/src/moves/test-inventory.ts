import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line !== "")
    : [];

const casesIn = (directory: string): number =>
  readdirSync(directory).reduce(
    (total, file) => total + linesOf(path.join(directory, file)).length,
    0,
  );

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

const changesBetween = (before: string, after: string): readonly string[] =>
  [...new Set([...readdirSync(before), ...readdirSync(after)])].sort(byCodeUnit).flatMap((file) => {
    const was = linesOf(path.join(before, file));
    const now = linesOf(path.join(after, file));
    return [
      ...without(was, now).map((line) => `${file}: removed ${line}`),
      ...without(now, was).map((line) => `${file}: added ${line}`),
    ];
  });

export const inventoryAround = (root: string, move: () => void): Inventory => {
  const scratch = mkdtempSync(path.join(tmpdir(), "move-files-inventory-"));
  const before = path.join(scratch, "before");
  const after = path.join(scratch, "after");
  try {
    const refused = takeInventory(root, before);
    if (refused !== undefined) {
      throw new Error(
        `scripts/test-inventory.sh failed before the move, so nothing moved\n${refused}`,
      );
    }
    move();
    const reason = takeInventory(root, after);
    if (reason !== undefined) return { kind: "unlisted", reason };
    const changes = changesBetween(before, after);
    return changes.length === 0
      ? { kind: "unchanged", cases: casesIn(after) }
      : { kind: "changed", changes };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
