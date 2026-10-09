import { describe, expect, it } from "vitest";
import { z } from "zod";

import { writeConceptDelta } from "@better-answers/core/store/map";
import { citedSourcesOf } from "@better-answers/schema";
import { linksAndMarksOf } from "@better-answers/schema/concept-file";

import { contractFixture } from "./contract-fixture.ts";
import { answered, postgresForSuite, readingAs, seedingWith } from "./suite-postgres.ts";

const sourceEntry = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

const linksCase = z.object({
  case: z.string().min(1),
  body: z.string().min(1),
  sources: z.union([z.array(z.string()), z.array(sourceEntry)]),
  links: z.array(z.object({ ordinal: z.int().nonnegative(), to: z.string().min(1) })),
  marks: z.array(z.object({ mark: z.string().min(1), source: z.int().nonnegative() })),
  why: z.string().min(1),
});

const fixture = contractFixture(
  "links",
  z.object({
    description: z.string(),
    citing: z.object({ iri: z.string(), path: z.string(), kind: z.string() }),
    cases: z.array(linksCase).min(1),
  }),
);

const db = postgresForSuite();

const LINK_UID = /^links_to:(?<from>.+):(?<ordinal>\d+)$/;

const edgesMadeBy = async (each: z.output<typeof linksCase>) => {
  const reader = await seedingWith(db().pool, async (seed) => {
    const workspace = await seed.workspace();
    const admin = await seed.member({ workspaceId: workspace.id, role: "Admin" });
    return { workspaceId: workspace.id, userId: admin.userId };
  });
  answered(
    await readingAs(db().runtimePool, reader, (principal, tx) =>
      writeConceptDelta(principal, tx, {
        workspaceId: reader.workspaceId,
        iri: fixture.citing.iri,
        kind: fixture.citing.kind,
        path: fixture.citing.path,
        body: each.body,
        sources: citedSourcesOf(each.sources),
        publishedAt: null,
        sensitivity: "Internal",
        audience: "everyone",
        audienceGroups: null,
        status: "stable",
      }),
    ),
  );
  const rows = await db().pool.query<{ uid: string; to_uid: string }>(
    `SELECT uid, to_uid FROM map_edge
      WHERE workspace_id = $1 AND from_uid = $2 AND label = 'LINKS_TO'`,
    [reader.workspaceId, fixture.citing.iri],
  );
  return rows.rows
    .map((row) => {
      const named = LINK_UID.exec(row.uid)?.groups;
      return {
        from: named?.["from"],
        ordinal: Number(named?.["ordinal"]),
        to: row.to_uid,
      };
    })
    .toSorted((one, other) => one.ordinal - other.ordinal);
};

describe("the edges a concept body's footnotes make", () => {
  it("makes exactly the links each case names, by ordinal", async () => {
    const made = [];
    for (const each of fixture.cases)
      made.push({ case: each.case, links: await edgesMadeBy(each) });

    expect(made).toEqual(
      fixture.cases.map((each) => ({
        case: each.case,
        links: each.links.map((link) => ({ from: fixture.citing.iri, ...link })),
      })),
    );
  });
});

describe("the citation marks a concept body carries", () => {
  it("resolves each mark to the source each case names", () => {
    const read = fixture.cases.map((each) => ({
      case: each.case,
      marks: linksAndMarksOf(each.body, citedSourcesOf(each.sources)).marks.map(
        ({ mark, source }) => ({ mark, source }),
      ),
    }));

    expect(read).toEqual(fixture.cases.map((each) => ({ case: each.case, marks: each.marks })));
  });

  it("places each mark where the body writes it", () => {
    for (const each of fixture.cases) {
      for (const { at, mark } of linksAndMarksOf(each.body, citedSourcesOf(each.sources)).marks) {
        expect({ case: each.case, written: each.body.slice(at, at + mark.length) }).toEqual({
          case: each.case,
          written: mark,
        });
      }
    }
  });
});
