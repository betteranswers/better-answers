import { describe, expect, it } from "vitest";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import { declarations, STORED_ACT_NAMES, STORED_DETAIL_KEYS } from "../../src/audit/index.ts";
import { loadEveryEntryPoint } from "./entry-points.ts";

const declaredActionNames = (): readonly string[] =>
  declarations().flatMap((declaration) => declaration.actions);

const declaredDetailKeys = (): ReadonlySet<string> =>
  new Set(declarations().flatMap((declaration) => Object.values(declaration.detailKeysOf).flat()));

const sorted = (names: Iterable<string>): readonly string[] => [...names].toSorted(byCodeUnit);

describe("the stored audit names in stored-names.ts", () => {
  it("lists exactly the declared action names", async () => {
    await loadEveryEntryPoint();

    expect(
      sorted(STORED_ACT_NAMES),
      "STORED_ACT_NAMES differs from the declared action names. An audit row keeps the action name it was written with, so declare the action under the name packages/core/src/audit/stored-names.ts pins, or append the new action's name there.",
    ).toEqual(sorted(declaredActionNames()));
  });

  it("lists exactly the declared detail keys", async () => {
    await loadEveryEntryPoint();

    expect(
      sorted(Object.values(STORED_DETAIL_KEYS)),
      "STORED_DETAIL_KEYS differs from the declared detail keys. An audit row keeps the detail keys it was written with, so write each key through its name in STORED_DETAIL_KEYS, or append the new key there.",
    ).toEqual(sorted(declaredDetailKeys()));
  });
});
