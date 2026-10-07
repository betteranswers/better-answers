import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AUDIT_ACTIONS_MODULE,
  declaredActionNames,
  renderAuditActions,
} from "../scripts/audit-actions.ts";

describe("the web's list of declared audit actions", () => {
  it("is byte-identical to a regeneration, so hand edits fail", async () => {
    expect(readFileSync(AUDIT_ACTIONS_MODULE, "utf8")).toBe(
      renderAuditActions(await declaredActionNames()),
    );
  });

  it("names the command that regenerates it", () => {
    expect(readFileSync(AUDIT_ACTIONS_MODULE, "utf8")).toContain(
      "pnpm --filter @better-answers/core run generate:audit-actions",
    );
  });

  it("lists the actions in code-unit order, then their headlines", () => {
    expect(renderAuditActions(["people.member.role_changed", "knowledge.check.imported"])).toBe(
      [
        "// Generated, never edited: pnpm --filter @better-answers/core run generate:audit-actions",
        "",
        "export const DECLARED_ACTIONS = [",
        '  "knowledge.check.imported",',
        '  "people.member.role_changed",',
        "] as const;",
        "",
        "export const HEADLINES = {",
        '  "knowledge.check.imported": "Verification imported",',
        '  "people.member.role_changed": "Role changed",',
        "} as const satisfies Readonly<Record<(typeof DECLARED_ACTIONS)[number], string>>;",
        "",
      ].join("\n"),
    );
  });
});
