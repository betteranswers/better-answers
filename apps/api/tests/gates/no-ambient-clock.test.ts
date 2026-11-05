import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { repositoryRoot } from "../support/roots/roots.ts";

const AMBIENT_CLOCK_READ = /\bnew\s+Date\s*\(\s*\)|\bDate\s*\.\s*now\s*\(\s*\)/g;

const ambientClockReadsIn = (source: string): readonly string[] =>
  [...source.matchAll(AMBIENT_CLOCK_READ)].map((match) => match[0]);

describe("the scan for ambient clock reads", () => {
  it("matches `new Date()` with or without spaces inside the parentheses", () => {
    expect(ambientClockReadsIn("const now = new Date();")).toEqual(["new Date()"]);
    expect(ambientClockReadsIn("const now = new Date(  );")).toEqual(["new Date(  )"]);
  });

  it("matches `Date.now()`", () => {
    expect(ambientClockReadsIn("const ms = Date.now();")).toEqual(["Date.now()"]);
  });

  it("ignores a `Date` built from an argument", () => {
    expect(ambientClockReadsIn("const at = new Date(iso);")).toEqual([]);
    expect(ambientClockReadsIn("const epoch = new Date(0);")).toEqual([]);
    expect(ambientClockReadsIn("const from = new Date(request.at);")).toEqual([]);
  });

  it("ignores a `now()` that is not called on `Date`", () => {
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

describe("ambient clock reads in source, outside two exempt files", () => {
  it("finds none in packages/core/src, apps/api/src or packages/schema/src", () => {
    const files = [
      ...tsFilesUnder(path.join(repositoryRoot, "packages/core/src")),
      ...tsFilesUnder(path.join(repositoryRoot, "apps/api/src")),
      ...tsFilesUnder(path.join(repositoryRoot, "packages/schema/src")),
    ].filter((file) => ![CLOCK_CONSTRUCTOR, ULID_MINTER].includes(file));

    const findings = files.flatMap((file) => {
      const source = readFileSync(path.join(repositoryRoot, file), "utf8");
      return ambientClockReadsIn(source).map((match) => `${file}: ${match}`);
    });

    expect(findings).toEqual([]);
  });

  it("finds `new Date()` in the exempt kernel clock", () => {
    const source = readFileSync(path.join(repositoryRoot, CLOCK_CONSTRUCTOR), "utf8");
    expect(ambientClockReadsIn(source)).toEqual(["new Date()"]);
  });

  it("finds `Date.now()` in the exempt ULID generator", () => {
    const source = readFileSync(path.join(repositoryRoot, ULID_MINTER), "utf8");
    expect(ambientClockReadsIn(source)).toEqual(["Date.now()"]);
  });
});
