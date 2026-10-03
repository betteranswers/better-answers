import { describe, expect, it } from "vitest";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import { declarations, STORED_ACT_NAMES, STORED_DETAIL_KEYS } from "../src/audit/index.ts";
import { loadEveryEntryPoint } from "./entry-points.ts";

const declaredActNames = (): readonly string[] =>
  declarations().flatMap((declaration) => declaration.acts);

const declaredDetailKeys = (): ReadonlySet<string> =>
  new Set(declarations().flatMap((declaration) => declaration.detailKeys));

const sorted = (names: Iterable<string>): readonly string[] => [...names].toSorted(byCodeUnit);

describe("the stored-names register", () => {
  it("pins every declared act name, and no other", async () => {
    await loadEveryEntryPoint();

    expect(
      sorted(STORED_ACT_NAMES),
      "an audit row keeps the act name it was written with. Declare the act under the name packages/core/src/audit/stored-names.ts pins, or append a new act's name there.",
    ).toEqual(sorted(declaredActNames()));
  });

  it("pins every declared detail key, and no other", async () => {
    await loadEveryEntryPoint();

    expect(
      sorted(Object.values(STORED_DETAIL_KEYS)),
      "an audit row keeps the detail keys it was written with. Write each key through its name in STORED_DETAIL_KEYS, or append a new key there.",
    ).toEqual(sorted(declaredDetailKeys()));
  });
});
