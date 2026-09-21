import { describe, expect, it } from "vitest";
import { z } from "zod";

import { boundarySchemas, SENSITIVITIES } from "@better-answers/schema";

import { narrower, visibilityFrom, widens } from "../src/access/index.ts";
import { contractFixture } from "./contract-fixture.ts";

const visibility = z.object({
  published_at: z.string().nullable(),
  sensitivity: z.enum(SENSITIVITIES),
  audience: z.string().min(1),
  audience_groups: z.array(z.string().min(1)).nullable(),
});

const fixtureSchema = z.object({
  description: z.string(),
  binding_fields: z.array(z.string().min(1)),
  document_class_column: z.string().min(1),
  chunk_columns: z.array(z.string().min(1)),
  sensitivity_rank: z.record(z.enum(SENSITIVITIES), z.int().nonnegative()),
  writers: z.array(
    z.object({
      writer: z.string().min(1),
      writes: z.string().min(1),
      why: z.string().min(1),
    }),
  ),
  cases: z.array(
    z.object({
      case: z.string().min(1),
      binding: visibility,
      document: z.object({ sensitivity: z.enum(SENSITIVITIES).nullable() }),
      chunk: visibility,
      why: z.string().min(1),
    }),
  ),
});

const fixture = contractFixture("visibility-columns", fixtureSchema);

const asField = (column: string): string =>
  column.replaceAll(/_([a-z])/g, (_whole, letter: string) => letter.toUpperCase());

const rankOf = (unit: {
  readonly sensitivity: z.infer<typeof visibility>["sensitivity"] | null;
}) => (unit.sensitivity === null ? Number.NaN : fixture.sensitivity_rank[unit.sensitivity]);

const asVisibility = (row: z.infer<typeof visibility>) =>
  visibilityFrom({
    sensitivity: row.sensitivity,
    audience: row.audience,
    audienceGroups: row.audience_groups,
  });

describe("the columns the visibility-columns agreement names", () => {
  it("names fields this tier's boundary carries on a binding, every one of them", () => {
    const onABinding = Object.keys(boundarySchemas.sourceBinding.select.shape);

    for (const column of fixture.binding_fields) {
      expect({ column, onABinding: onABinding.includes(asField(column)) }).toEqual({
        column,
        onABinding: true,
      });
    }
  });

  it("names a class column a document may leave unset, which is what *the binding's* means", () => {
    const named = asField(fixture.document_class_column);
    const onADocument = Object.entries(boundarySchemas.sourceDocument.select.shape).find(
      ([field]) => field === named,
    );

    expect(onADocument?.[0]).toBe(named);
    expect(onADocument?.[1].safeParse(null).success).toBe(true);

    expect(boundarySchemas.sourceBinding.select.shape.sensitivity.safeParse(null).success).toBe(
      false,
    );
  });

  it("names columns this tier's boundary carries on a chunk row, every one of them", () => {
    const onAChunk = Object.keys(boundarySchemas.chunk.select.shape);

    for (const column of fixture.chunk_columns) {
      expect({ column, onAChunk: onAChunk.includes(asField(column)) }).toEqual({
        column,
        onAChunk: true,
      });
    }
  });

  it("names the two writers of one source, the worker's rows and the app's rewrites", () => {
    expect(fixture.writers.map((each) => each.writer)).toEqual(["the worker", "the app"]);
  });
});

describe("the order the two classes fold in", () => {
  it("ranks every class this tier has a word for, and no fourth", () => {
    expect(Object.keys(fixture.sensitivity_rank).toSorted()).toEqual([...SENSITIVITIES].toSorted());
  });

  it("ranks the classes the way this tier's own fold ranks them, for every pair both ways", () => {
    for (const one of SENSITIVITIES) {
      for (const other of SENSITIVITIES) {
        const expected =
          fixture.sensitivity_rank[one] <= fixture.sensitivity_rank[other] ? one : other;

        expect({ one, other, narrower: narrower(one, other) }).toEqual({
          one,
          other,
          narrower: expected,
        });
        expect({ one, other, narrower: narrower(other, one) }).toEqual({
          one,
          other,
          narrower: expected,
        });
      }
    }
  });
});

describe("what a chunk row carries, for each case the agreement states", () => {
  it("takes the narrower of the binding's class and the document's, and the binding's audience", () => {
    for (const { case: named, binding, document, chunk } of fixture.cases) {
      const folded =
        document.sensitivity === null
          ? binding.sensitivity
          : narrower(binding.sensitivity, document.sensitivity);

      expect({
        case: named,
        sensitivity: folded,
        audience: binding.audience,
        audienceGroups: binding.audience_groups,
      }).toEqual({
        case: named,
        sensitivity: chunk.sensitivity,
        audience: chunk.audience,
        audienceGroups: chunk.audience_groups,
      });
    }
  });

  it("carries the binding's publish stamp unchanged, because a chunk is published with it", () => {
    for (const { case: named, binding, chunk } of fixture.cases) {
      expect({ case: named, publishedAt: chunk.published_at }).toEqual({
        case: named,
        publishedAt: binding.published_at,
      });
    }
  });

  it("never widens what the binding allows, whatever the document says", () => {
    for (const { case: named, binding, chunk } of fixture.cases) {
      const fromBinding = asVisibility(binding);
      const onTheRow = asVisibility(chunk);

      if (fromBinding === undefined || onTheRow === undefined) {
        throw new Error(`the agreement states a visibility this tier cannot read: ${named}`);
      }
      expect({ case: named, widens: widens(fromBinding, onTheRow) }).toEqual({
        case: named,
        widens: false,
      });
    }
  });

  it("states a case where the document is narrower, and the row takes the document's class", () => {
    const narrowed = fixture.cases.filter(
      ({ binding, document }) => rankOf(document) < rankOf(binding),
    );

    expect(narrowed.length).toBeGreaterThan(0);
    for (const { case: named, document, chunk } of narrowed) {
      expect({ case: named, sensitivity: chunk.sensitivity }).toEqual({
        case: named,
        sensitivity: document.sensitivity,
      });
    }
  });

  it("states a case where the document is wider, and the row keeps the binding's class", () => {
    const widened = fixture.cases.filter(
      ({ binding, document }) => rankOf(document) > rankOf(binding),
    );

    expect(widened.length).toBeGreaterThan(0);
    for (const { case: named, binding, chunk } of widened) {
      expect({ case: named, sensitivity: chunk.sensitivity }).toEqual({
        case: named,
        sensitivity: binding.sensitivity,
      });
    }
  });
});
