import { expect, it } from "vitest";

import { foldKind } from "../../src/bundle/index.ts";

it.each([
  ["policy", "Policy"],
  ["Policies", "Policy"],
  ["POLICY", "Policy"],
  ["Boxes", "Box"],
  ["Standards", "Standard"],
  ["Assessments", "Assessment"],

  ["Assessment", "Assessment"],
  ["Business", "Business"],
  ["Bonus", "Bonus"],
  ["Analysis", "Analysis"],
  ["Rate  card", "Rate  Card"],
])("folds the kind %s to %s", (kind, folded) => {
  expect(foldKind(kind)).toBe(folded);
});
