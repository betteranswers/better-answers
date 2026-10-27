import { describe, expect, it } from "vitest";
import { z } from "zod";

import { writeConceptDelta } from "@better-answers/core/store/map";
import { citedSourcesOf, UNRESOLVED_RELATIONS } from "@better-answers/schema";
import { linksAndMarksOf } from "@better-answers/schema/concept-file";

import { contractFixture } from "../../fixtures/contract-fixture.ts";
import {
  answered,
  postgresForSuite,
  readingAs,
  seedingWith,
} from "../../support/suite-postgres.ts";

const sourceEntry = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

const linksCase = z.object({
  case: z.string().min(1),
  body: z.string().min(1),
  sources: z.union([z.array(z.string()), z.array(sourceEntry)]),
  held: z.array(z.object({ iri: z.string(), path: z.string() })).default([]),
  links: z.array(
    z.object({
      ordinal: z.int().nonnegative(),
      to: z.string().min(1),
      section: z.string().nullable(),
      sentence: z.string(),
    }),
  ),
  unresolved: z.array(
    z.object({
      relation: z.enum(UNRESOLVED_RELATIONS),
      ordinal: z.int().nonnegative(),
      path: z.string().min(1),
    }),
  ),
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

const mapMadeBy = async (each: z.output<typeof linksCase>) => {
  const reader = await seedingWith(db().pool, async (seed) => {
    const workspace = await seed.workspace();
    const admin = await seed.member({ workspaceId: workspace.id, role: "Admin" });
    for (const { iri, path } of each.held) {
      await seed.conceptIdentity({ workspaceId: workspace.id, iri });
      await seed.conceptIndex({ workspaceId: workspace.id, iri, path });
    }
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
  const rows = await db().pool.query<{
    uid: string;
    to_uid: string;
    section: string | null;
    sentence: string | null;
  }>(
    `SELECT uid, to_uid, section, sentence FROM map_edge
      WHERE workspace_id = $1 AND from_uid = $2 AND label = 'LINKS_TO'`,
    [reader.workspaceId, fixture.citing.iri],
  );
  const waiting = await db().pool.query<{
    relation: (typeof UNRESOLVED_RELATIONS)[number];
    ordinal: number;
    path: string;
  }>(
    `SELECT relation, ordinal, target_path AS path FROM map_unresolved_reference
      WHERE workspace_id = $1 AND from_uid = $2`,
    [reader.workspaceId, fixture.citing.iri],
  );
  const links = rows.rows
    .map((row) => {
      const named = LINK_UID.exec(row.uid)?.groups;
      return {
        from: named?.["from"],
        ordinal: Number(named?.["ordinal"]),
        to: row.to_uid,
        section: row.section,
        sentence: row.sentence,
      };
    })
    .toSorted((one, other) => one.ordinal - other.ordinal);
  const unresolved = waiting.rows.toSorted(
    (one, other) =>
      UNRESOLVED_RELATIONS.indexOf(one.relation) - UNRESOLVED_RELATIONS.indexOf(other.relation) ||
      one.ordinal - other.ordinal,
  );
  return { links, unresolved };
};

describe("the edges a concept body's footnotes make", () => {
  it("makes exactly the links and unresolved paths each case names", async () => {
    const made = [];
    for (const each of fixture.cases) made.push({ case: each.case, ...(await mapMadeBy(each)) });

    expect(made).toEqual(
      fixture.cases.map((each) => ({
        case: each.case,
        links: each.links.map((link) => ({ from: fixture.citing.iri, ...link })),
        unresolved: each.unresolved,
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
