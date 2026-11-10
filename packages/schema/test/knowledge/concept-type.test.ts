import { expect, it } from "vitest";

import { foldConceptType } from "../../src/knowledge/concept-type.ts";

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
  ["Gases", "Gas"],
  ["Lenses", "Lens"],
  ["natural gas", "Natural Gas"],
])("folds the type %s to %s", (conceptType, folded) => {
  expect(foldConceptType(conceptType)).toBe(folded);
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
  "Atlases",
  "Aliases",
  "Species",
  "News",
  "ies",
  "s",
  "ßes",
])("folds %s to a type that folds to itself", (conceptType) => {
  const folded = foldConceptType(conceptType);
  expect(foldConceptType(folded)).toBe(folded);
});

it.each(["Gas", "Lens", "Atlas", "Alias", "Bias", "Canvas", "Series", "Species", "News"])(
  "keeps the singular type %s as it is",
  (conceptType) => {
    expect(foldConceptType(conceptType)).toBe(conceptType);
  },
);
