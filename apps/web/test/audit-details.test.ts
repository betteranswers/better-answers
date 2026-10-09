import { describe, expect, it } from "vitest";

import { DETAIL_KEYS } from "@/features/people/audit-actions.ts";
import { KEPT_OFF_DETAIL_KEYS, LABELLED_DETAIL_KEYS } from "@/features/people/audit-details.ts";

const said = (action: string, key: string): string => `${action} ${key}`;

const keptOff = (action: (typeof DETAIL_KEYS)[number][0], key: string): boolean =>
  KEPT_OFF_DETAIL_KEYS[action]?.includes(key) ?? false;

describe("the audit log's detail labels", () => {
  it("cover every declared key, or keep it off the page", () => {
    const unlabelled = DETAIL_KEYS.filter(
      ([action, key]) => !LABELLED_DETAIL_KEYS.includes(key) && !keptOff(action, key),
    ).map(([action, key]) => said(action, key));

    expect(
      unlabelled,
      "a detail key core writes with no label in audit-details.ts. Label it, or keep it off the page for its action.",
    ).toEqual([]);
  });

  it("name no key that no action declares", () => {
    const declared = new Set<string>(DETAIL_KEYS.map(([, key]) => key));

    expect(
      LABELLED_DETAIL_KEYS.filter((key) => !declared.has(key)),
      "a label for a detail key no audit action declares",
    ).toEqual([]);
  });

  it("keep off only keys their action declares", () => {
    const declared = new Set(DETAIL_KEYS.map(([action, key]) => said(action, key)));
    const keptOffPairs = Object.entries(KEPT_OFF_DETAIL_KEYS).flatMap(([action, keys]) =>
      keys.map((key) => said(action, key)),
    );

    expect(
      keptOffPairs.filter((pair) => !declared.has(pair)),
      "a kept-off detail key its action does not declare",
    ).toEqual([]);
  });
});
