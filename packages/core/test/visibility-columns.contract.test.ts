import { describe, expect, it } from "vitest";
import { z } from "zod";

import { boundarySchemas, SENSITIVITIES } from "@better-answers/schema";

import { narrower, visibilityFrom, widens } from "../src/access/index.ts";
import { contractFixture } from "./contract-fixture.ts";

/**
 * The visibility-columns agreement's TypeScript half (ADR 0031, ADR 0023, ADR 0039): the
 * fixture in `contracts/visibility-columns/` is the contract — the fields a binding carries,
 * the class a document may carry of its own, and the columns every chunk row must carry so
 * the read predicate has something to test — and this suite holds this tier's boundary and
 * its one fold to it. The Python half is
 * `apps/worker/tests/test_visibility_columns_contract.py`, where the same file is read by the
 * tier that writes the rows.
 *
 * **Why the columns are the agreement and the predicate is not.** The predicate's logic is
 * this tier's alone (ADR 0031, *The read predicate leaves the contract*). What crosses the
 * seam is the columns: a row the worker lands without them, or with them copied from the
 * wrong place, makes this tier's predicate silently over- or under-filter, and nothing fails
 * until a reader sees a passage they should not have.
 *
 * **Two writers, one source.** The worker writes these columns on every chunk row a run
 * lands and re-copies them in the run's last statement; the app rewrites them on a publish, a
 * binding's narrowing and a document's narrowing. Both copy from one row — the binding,
 * narrowed by the document — so they can disagree only in a race the re-copy settles. The
 * cases below are that one source written down; the race itself is the cross-tier test's
 * (T-137).
 *
 * Neither half holds the other's literals (`[TEST9]`): this one folds the fixture's two
 * classes through the tier's own `narrower` and parses the expected row through its own
 * boundary, and the Python half reads the columns out of the generated schema view.
 */

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

/** The database's column name as this tier's boundary spells the same field. */
const asField = (column: string): string =>
  column.replaceAll(/_([a-z])/g, (_whole, letter: string) => letter.toUpperCase());

/**
 * Where a case's class sits in the agreement's own order. A document with no class of its
 * own is unranked, so it is neither narrower nor wider than its binding — it is the binding's.
 */
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

    // Null is the ordinary case and a fact, not a gap: a document with no class of its own
    // takes its binding's. A column the boundary made required would have no way to say so.
    expect(onADocument?.[0]).toBe(named);
    expect(onADocument?.[1].safeParse(null).success).toBe(true);
    // And the binding's own class is not optional, which is what makes null on the document
    // readable as a deferral rather than as an unanswered question on both rows at once.
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

        // Both ways round the pair (`[TEST7]`): a fold that answered by argument order
        // rather than by class would pass one direction and fail the other.
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

  // The pair the document's class turns on (`[TEST7]`): a class narrower than the binding's
  // reaches the row, and a class wider than it does not. One arm without the other would let
  // an override pass for a narrowing, or a column nothing reads pass for a narrowing.
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
