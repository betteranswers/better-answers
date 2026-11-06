import { expect, it } from "vitest";

import { foldKind } from "../../src/bundle/index.ts";

it.each([
  ["policy", "Policy"],
  ["Policies", "Policy"],
  ["POLICY", "Policy"],
  ["Boxes", "Box"],
  ["Standards", "Standard"],
  ["Assessments", "Assessment"],
  ["Classes", "Class"],
  ["Statuses", "Status"],
  ["Courses", "Course"],
  ["Analyses", "Analyse"],

  ["Assessment", "Assessment"],
  ["Business", "Business"],
  ["Bonus", "Bonus"],
  ["Analysis", "Analysis"],
  ["Rate  card", "Rate  Card"],
])("folds the kind %s to %s", (kind, folded) => {
  expect(foldKind(kind)).toBe(folded);
});

it.each([
  "Policy",
  "Policies",
  "Boxes",
  "Churches",
  "Wishes",
  "Classes",
  "Processes",
  "Analysis",
  "Analyses",
  "Lens",
  "Lenses",
  "Gas",
  "Gases",
  "Status",
  "Statuses",
  "Bus",
  "Buses",
  "Series",
  "Courses",
  "Responses",
  "Databases",
  "Crises",
  "Rate cards",
  "ies",
  "s",
  "ßes",
])("folds %s to a kind that folds to itself", (kind) => {
  const folded = foldKind(kind);
  expect(foldKind(folded)).toBe(folded);
});
