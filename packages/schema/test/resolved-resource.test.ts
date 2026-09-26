import { describe, expect, it } from "vitest";

import { resolvedResource } from "../src/index.ts";

describe("a resource resolved against the file that cites it", () => {
  it("resolves against the root when `from` holds no slash", () => {
    expect(resolvedResource("x.md", "a.md")).toBe("/x.md");
  });

  it("resolves against the directory of a nested `from`", () => {
    expect(resolvedResource("x.md", "knowledge/a.md")).toBe("/knowledge/x.md");
  });

  it("resolves against the root for a rooted `from`", () => {
    expect(resolvedResource("x.md", "/a.md")).toBe("/x.md");
  });
});
