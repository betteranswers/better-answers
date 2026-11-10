import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { rootsOf } from "@better-answers/schema/testing/roots";

const { workspaceRoot } = rootsOf(import.meta.url);

const stylesheets = ["typography.css", "semantic.css"]
  .map((file) => readFileSync(path.join(workspaceRoot, "src/styles", file), "utf8"))
  .join("\n");

const declared = (token: string): readonly string[] =>
  [...stylesheets.matchAll(new RegExp(`${token}:\\s*([^;]+);`, "gu"))].map(([, value]) =>
    (value ?? "").trim(),
  );

const pixelsOf = (token: string): number => {
  const [value, ...others] = declared(token);
  if (value === undefined || others.length > 0) {
    throw new Error(`${token} must be set once, in px, and is set ${String(others.length + 1)}`);
  }
  const found = /^(\d+)px$/u.exec(value)?.[1];
  if (found === undefined) throw new Error(`${token} is ${value}, not a size in px`);
  return Number(found);
};

describe("the type scale", () => {
  it.each([
    ["--text-title", "--text-section"],
    ["--text-section", "--text-lg"],
    ["--text-base", "--text-2xs"],
  ])("steps from %s down to %s by at least 1.25", (larger, smaller) => {
    expect(pixelsOf(larger) / pixelsOf(smaller)).toBeGreaterThanOrEqual(1.25);
  });

  it("sets a title of 30px and prose at 16px", () => {
    expect(pixelsOf("--text-title")).toBe(30);
    expect(pixelsOf("--text-lg")).toBe(16);
  });
});
