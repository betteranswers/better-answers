import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { AUDIT_ACTS_MODULE, declaredActNames, renderAuditActs } from "../scripts/audit-acts.ts";

describe("the web's list of declared audit acts", () => {
  it("is byte-identical to a regeneration, so hand edits fail", async () => {
    expect(readFileSync(AUDIT_ACTS_MODULE, "utf8")).toBe(renderAuditActs(await declaredActNames()));
  });

  it("names the command that regenerates it", () => {
    expect(readFileSync(AUDIT_ACTS_MODULE, "utf8")).toContain(
      "pnpm --filter @better-answers/core run generate:audit-acts",
    );
  });

  it("lists the acts in code-unit order beneath its header", () => {
    expect(renderAuditActs(["people.member.role_changed", "knowledge.check.imported"])).toBe(
      [
        "// Generated, never edited: pnpm --filter @better-answers/core run generate:audit-acts",
        "",
        "export const DECLARED_ACTS = [",
        '  "knowledge.check.imported",',
        '  "people.member.role_changed",',
        "] as const;",
        "",
      ].join("\n"),
    );
  });
});
