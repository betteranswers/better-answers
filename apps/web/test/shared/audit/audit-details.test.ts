import { describe, expect, it } from "vitest";

import { DETAIL_KEYS } from "@/shared/audit/audit-actions.ts";
import {
  detailLinesOf,
  KEPT_OFF_DETAIL_KEYS,
  LABELLED_DETAIL_KEYS,
} from "@/shared/audit/audit-details.ts";

const pairName = (action: string, key: string): string => `${action} ${key}`;

const isKeptOff = (action: (typeof DETAIL_KEYS)[number][0], key: string): boolean =>
  KEPT_OFF_DETAIL_KEYS[action]?.includes(key) ?? false;

const isLabelledOrKeptOff = ([action, key]: (typeof DETAIL_KEYS)[number]): boolean =>
  LABELLED_DETAIL_KEYS.includes(key) || isKeptOff(action, key);

describe("the audit log's detail labels", () => {
  it("cover every declared key not kept off the page", () => {
    const unlabelled = DETAIL_KEYS.filter((entry) => !isLabelledOrKeptOff(entry)).map(
      ([action, key]) => pairName(action, key),
    );

    expect(
      unlabelled,
      "detail keys with no label in audit-details.ts; add a label or keep the key off for its action",
    ).toEqual([]);
  });

  it("are written in sentence case", () => {
    const labels = detailLinesOf({
      detail: Object.fromEntries(LABELLED_DETAIL_KEYS.map((key) => [key, "held"])),
      named: {},
    }).map((line) => line.label);

    expect(
      labels.filter((label) => /\s[A-Z][a-z]/.test(label)),
      "detail labels with a capital letter after the first word",
    ).toEqual([]);
  });

  it("label only keys that some action declares", () => {
    const declared = new Set<string>(DETAIL_KEYS.map(([, key]) => key));

    expect(
      LABELLED_DETAIL_KEYS.filter((key) => !declared.has(key)),
      "labels for detail keys that no audit action declares",
    ).toEqual([]);
  });

  it("keep off only keys that their action declares", () => {
    const declared = new Set(DETAIL_KEYS.map(([action, key]) => pairName(action, key)));
    const keptOffPairs = Object.entries(KEPT_OFF_DETAIL_KEYS).flatMap(([action, keys]) =>
      keys.map((key) => pairName(action, key)),
    );

    expect(
      keptOffPairs.filter((pair) => !declared.has(pair)),
      "kept-off detail keys that their action does not declare",
    ).toEqual([]);
  });

  it("do not label any key an action keeps off", () => {
    const labelledAndKeptOff = Object.entries(KEPT_OFF_DETAIL_KEYS).flatMap(([action, keys]) =>
      keys.filter((key) => LABELLED_DETAIL_KEYS.includes(key)).map((key) => pairName(action, key)),
    );

    expect(
      labelledAndKeptOff,
      "detail keys both labelled in audit-details.ts and kept off by an action; a label applies to every action, so remove the key from the kept-off lists or remove the label",
    ).toEqual([]);
  });
});
