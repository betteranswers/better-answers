import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/oxlint-config";

const AMBIENT_CLOCK_READ = /\bnew\s+Date\s*\(\s*\)|\bDate\s*\.\s*now\s*\(\s*\)/g;

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

  it("stays silent on a `Date` built from an argument", () => {
    expect(ambientClockReadsIn("const at = new Date(iso);")).toEqual([]);
    expect(ambientClockReadsIn("const epoch = new Date(0);")).toEqual([]);
    expect(ambientClockReadsIn("const from = new Date(request.at);")).toEqual([]);
  });

  it("stays silent on a `now()` not called on `Date`", () => {
    expect(ambientClockReadsIn("const at = clock.now();")).toEqual([]);
    expect(ambientClockReadsIn("const at = now();")).toEqual([]);
  });
});

const tsFilesUnder = (root: string): readonly string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.relative(repositoryRoot, path.join(entry.parentPath, entry.name)));

const CLOCK_CONSTRUCTOR = "packages/core/src/kernel/clock.ts";

const ULID_MINTER = "packages/schema/src/ulid.ts";

describe("no ambient clock read outside its two named exemptions", () => {
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

  it("finds the clock read in the kernel's exempt constructor", () => {
    const source = readFileSync(path.join(repositoryRoot, CLOCK_CONSTRUCTOR), "utf8");
    expect(ambientClockReadsIn(source)).toEqual(["new Date()"]);
  });

  it("finds the clock read in the exempt ULID minter", () => {
    const source = readFileSync(path.join(repositoryRoot, ULID_MINTER), "utf8");
    expect(ambientClockReadsIn(source)).toEqual(["Date.now()"]);
  });
});
