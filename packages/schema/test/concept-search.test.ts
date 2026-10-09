import type pg from "pg";
import { describe, expect, it } from "vitest";

import { IRI } from "../src/index.ts";
import { type TestData, testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { ADMITTED, postgresForSuite, refusalOf } from "./probes.ts";
import { A_CONCEPT_INDEX_ROW } from "./rls-probes.ts";

const db = postgresForSuite();

const WS_A = "01J6EAAAAAAAAAAAAAAAAAAAAA";

const ULID = "01J6MMMMMMMMMMMMMMMMMMMMMM";

const AT = "https://better-answers.com/c/";

/** Each string, and whether the IRI pattern accepts it. */
const CANDIDATES: readonly (readonly [string, boolean])[] = [
  [`${AT}${ULID}`, true],
  [`${AT}00000000000000000000000000`, true],
  [`${AT}7ZZZZZZZZZZZZZZZZZZZZZZZZZ`, true],
  [`${AT}${ULID.toLowerCase()}`, false],
  [`${AT}01J6IIIIIIIIIIIIIIIIIIIIII`, false],
  [`${AT}01J6LLLLLLLLLLLLLLLLLLLLLL`, false],
  [`${AT}01J6OOOOOOOOOOOOOOOOOOOOOO`, false],
  [`${AT}01J6UUUUUUUUUUUUUUUUUUUUUU`, false],
  [`${AT}${ULID.slice(1)}`, false],
  [`${AT}${ULID}M`, false],
  [`${AT}${ULID}\n`, false],
  [`\n${AT}${ULID}`, false],
  [` ${AT}${ULID}`, false],
  [`${AT}${ULID}/`, false],
  [`${AT}０１J6MMMMMMMMMMMMMMMMMMMMMM`, false],
  [`https://better-answersXcom/c/${ULID}`, false],
  [`http://better-answers.com/c/${ULID}`, false],
  [`HTTPS://BETTER-ANSWERS.COM/C/${ULID}`, false],
  [`https://better-answers.com/concepts/${ULID}`, false],
  [ULID, false],
  ["", false],
];

const insertingAt = (client: pg.PoolClient, iri: string, commitSha: string) =>
  client.query(A_CONCEPT_INDEX_ROW, [
    WS_A,
    iri,
    "knowledge/probe.md",
    "a".repeat(64),
    commitSha,
    "stable",
    "Internal",
    new Date(),
  ]);

/** Runs `work` in a rolled-back transaction holding workspace A and one bundle commit. */
const withACommit = (work: (client: pg.PoolClient, seed: TestData, sha: string) => Promise<void>) =>
  withRollback(db().pool, async (client) => {
    const seed = testData(client);
    await seed.workspace({ id: WS_A, name: "A" });
    const commit = await seed.bundleCommit({ workspaceId: WS_A });
    await work(client, seed, commit.sha);
  });

const columnOf = async (client: pg.PoolClient, column: string) => {
  const read = await client.query<{ type: string; not_null: boolean; generated: string }>(
    `SELECT format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
            a.attgenerated AS generated
       FROM pg_attribute a
      WHERE a.attrelid = 'public.concept_index'::regclass AND a.attname = $1`,
    [column],
  );
  return read.rows[0];
};

describe("the concept's search column", () => {
  it("is computed and stored by the pinned image", async () => {
    await withRollback(db().pool, async (client) => {
      expect(await columnOf(client, "search")).toEqual({
        type: "tsvector",
        not_null: true,
        generated: "s",
      });
    });
  });

  it("weighs tags at B, as a list or one string", async () => {
    await withACommit(async (client, seed) => {
      const weighedB = async (frontmatter: Record<string, string | string[]>) => {
        const row = await seed.conceptIndex({ workspaceId: WS_A, frontmatter });
        const read = await client.query<{ lexemes: string[] }>(
          `SELECT array(SELECT lexeme FROM unnest(ts_filter(search, '{b}'))) AS lexemes
             FROM concept_index WHERE iri = $1`,
          [row.iri],
        );
        return read.rows[0]?.lexemes;
      };

      expect({
        list: await weighedB({ title: "Expenses", tags: ["finance"] }),
        string: await weighedB({ title: "Expenses", tags: "finance" }),
        none: await weighedB({ title: "Expenses" }),
      }).toEqual({ list: ["financ"], string: ["financ"], none: [] });
    });
  });
});

describe("the concept IRI's constraint", () => {
  it("refuses a raw concept row with a malformed IRI", async () => {
    await withACommit(async (client, _seed, sha) => {
      expect(
        await refusalOf(client, () => insertingAt(client, `${AT}${ULID.toLowerCase()}`, sha)),
      ).toBe("concept_index_iri_check");
    });
  });

  it("accepts and refuses the strings the TypeScript IRI does", async () => {
    await withACommit(async (client, seed, sha) => {
      const outcomes = [];
      for (const [candidate, accepted] of CANDIDATES) {
        if (accepted) await seed.conceptIdentity({ workspaceId: WS_A, iri: candidate });
        outcomes.push({
          candidate,
          typescript: IRI.test(candidate),
          database: await refusalOf(client, () => insertingAt(client, candidate, sha)),
        });
      }

      expect(outcomes).toEqual(
        CANDIDATES.map(([candidate, accepted]) => ({
          candidate,
          typescript: accepted,
          database: accepted ? ADMITTED : "concept_index_iri_check",
        })),
      );
    });
  });
});
