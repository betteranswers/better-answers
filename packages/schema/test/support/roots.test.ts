import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { rootsOf } from "./roots.ts";

const own = rootsOf(import.meta.url);

const fileUrlIn = (relative: string): string =>
  pathToFileURL(path.join(own.repositoryRoot, relative)).href;

describe("the roots of a file", () => {
  it("are those of the workspace that holds the file", () => {
    expect(own.workspaceRoot).toBe(path.join(own.repositoryRoot, "packages/schema"));
    expect(existsSync(path.join(own.repositoryRoot, "pnpm-workspace.yaml"))).toBe(true);
  });

  it("follow a file URL into another workspace", () => {
    expect(rootsOf(fileUrlIn("apps/api/tests/serve.ts"))).toEqual({
      workspaceRoot: path.join(own.repositoryRoot, "apps/api"),
      repositoryRoot: own.repositoryRoot,
    });
  });

  it("refuse a file under a package.json that is no workspace", () => {
    expect(() => rootsOf(fileUrlIn("packages/devtools/lint-rules/index.ts"))).toThrow(
      "is no workspace of apps/ or packages/",
    );
  });
});
