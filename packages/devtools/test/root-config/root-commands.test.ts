import { assert, describe, expect, it } from "vitest";

import { gatesNamed, rootScripts } from "@better-answers/devtools/root-commands";

describe("the gates a root command names", () => {
  it("expands a step that itself calls the runner", () => {
    const check = rootScripts()["check"];
    assert(check !== undefined, "the root manifest has no check script");
    const steps = gatesNamed(check);

    expect(
      steps,
      "gatesNamed returned check:gates itself. check:gates calls the runner, so expand it into the tree-walking gates it lists.",
    ).not.toContain("check:gates");
    expect(steps).toEqual(expect.arrayContaining(["lint", "knip", "check:workspaces"]));
  });
});
