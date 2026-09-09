import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { repositoryRoot } from "@better-answers/devtools/oxlint-config";
import { describe, expect, it } from "vitest";

/**
 * The gate ADR 0040 names: no ambient wall-clock read in the application code under three
 * roots — `packages/core/src`, `apps/api/src` and `packages/schema/src` — outside two named
 * exemptions. A `Clock` is constructed once by the api at boot and handed on explicitly to
 * every act that reads time, never reached for again inside one.
 *
 * **Three roots.** `packages/schema/src` joined the scan in T-109 (2026-09-09, ADR 0040's
 * dated amendment): it writes the identity set's tables, which is where four dead
 * `$onUpdate(() => new Date())` hooks were found and removed.
 *
 * **Two exemptions, each the one place a reading is handed out from rather than decided
 * on.** The kernel's own constructor (`packages/core/src/kernel/clock.ts`), which every
 * other site's `Clock` comes from, is one; the ULID minter (`packages/schema/src/ulid.ts`)
 * is the other, because its one `Date.now()` orders an id and decides nothing — the reason
 * ADR 0040 already gives for the worker's one clock-shaped read, which is this same
 * function, re-exported.
 *
 * **Why this is a scan and not an oxlint rule.** `[CHECK1]` asks for a lint rule with a
 * throwaway-tree test wherever one is possible; the natural rule is `no-restricted-syntax`
 * over `NewExpression[callee.name="Date"][arguments.length=0]` and
 * `CallExpression[callee.object.name="Date"][callee.property.name="now"]`. oxlint 1.80.0,
 * the version this repository pins, ships no `no-restricted-syntax` rule at all — absent
 * from `node_modules/oxlint/configuration_schema.json`, checked on 2026-09-08 — so the
 * selector cannot be expressed as a config-only override the way every other rule in
 * `.oxlintrc.json` is. This is ADR 0040's named fallback: a scan, with its own positive and
 * negative cases, over the same two patterns.
 *
 * **What it cannot see.** A textual scan reads a comment exactly as it reads code — the
 * same limitation a shell `grep` has — so a docblock that quoted `new Date()` or
 * `Date.now()` literally would fire here as if it were a call. None does today; a future
 * one should say the pattern in words instead (`[COMMENT1]`).
 */

/** Fires on a bare `new Date()` or `Date.now()` — never on a call carrying an argument. */
const AMBIENT_CLOCK_READ = /\bnew\s+Date\s*\(\s*\)|\bDate\s*\.\s*now\s*\(\s*\)/g;

/** Every ambient-clock snippet a source string carries, in the order it carries them. */
const ambientClockReadsIn = (source: string): readonly string[] =>
  [...source.matchAll(AMBIENT_CLOCK_READ)].map((match) => match[0]);

describe("the ambient-clock scan itself", () => {
  it("fires on a bare `new Date()`, in either spacing", () => {
    expect(ambientClockReadsIn("const now = new Date();")).toEqual(["new Date()"]);
    expect(ambientClockReadsIn("const now = new Date(  );")).toEqual(["new Date(  )"]);
  });

  it("fires on `Date.now()`", () => {
    expect(ambientClockReadsIn("const ms = Date.now();")).toEqual(["Date.now()"]);
  });

  it("stays silent on a `Date` built from an argument, however it is spaced", () => {
    expect(ambientClockReadsIn("const at = new Date(iso);")).toEqual([]);
    expect(ambientClockReadsIn("const epoch = new Date(0);")).toEqual([]);
    expect(ambientClockReadsIn("const from = new Date(request.at);")).toEqual([]);
  });

  it("stays silent on a `now()` this file did not name `Date`", () => {
    expect(ambientClockReadsIn("const at = clock.now();")).toEqual([]);
    expect(ambientClockReadsIn("const at = now();")).toEqual([]);
  });
});

/** Every `.ts` file under `root`, walked recursively, as a path relative to the repo root. */
const tsFilesUnder = (root: string): readonly string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.relative(repositoryRoot, path.join(entry.parentPath, entry.name)));

/**
 * The kernel's own constructor: the one file ADR 0040 permits to read the ambient clock in
 * `packages/core/src` or `apps/api/src`, because it is the thing that hands every other
 * reading out.
 */
const CLOCK_CONSTRUCTOR = "packages/core/src/kernel/clock.ts";

/**
 * The ULID minter: the one file ADR 0040 permits to read the ambient clock in
 * `packages/schema/src`, because its one `Date.now()` orders an id and decides nothing
 * (T-109, 2026-09-09).
 */
const ULID_MINTER = "packages/schema/src/ulid.ts";

describe("no ambient clock read outside its two named exemptions (ADR 0040)", () => {
  it("finds none in packages/core/src, apps/api/src or packages/schema/src", () => {
    const files = [
      ...tsFilesUnder(path.join(repositoryRoot, "packages/core/src")),
      ...tsFilesUnder(path.join(repositoryRoot, "apps/api/src")),
      ...tsFilesUnder(path.join(repositoryRoot, "packages/schema/src")),
    ].filter((file) => file !== CLOCK_CONSTRUCTOR && file !== ULID_MINTER);

    const findings = files.flatMap((file) => {
      const source = readFileSync(path.join(repositoryRoot, file), "utf8");
      return ambientClockReadsIn(source).map((match) => `${file}: ${match}`);
    });

    expect(findings).toEqual([]);
  });

  it("the kernel's constructor is one of the two files this scan does not cover, and it is the one that reads the clock", () => {
    const source = readFileSync(path.join(repositoryRoot, CLOCK_CONSTRUCTOR), "utf8");
    expect(ambientClockReadsIn(source)).toEqual(["new Date()"]);
  });

  it("the ULID minter is the other file this scan does not cover, and it is the one that reads the clock", () => {
    const source = readFileSync(path.join(repositoryRoot, ULID_MINTER), "utf8");
    expect(ambientClockReadsIn(source)).toEqual(["Date.now()"]);
  });
});
