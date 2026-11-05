import type { MigratedPostgres } from "@better-answers/schema/testing";

import { saveBrief, seedGuide } from "../../src/guides/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { northgate, type Northgate } from "../fixtures/northgate.ts";
import { doorsOf, principalFor, type Scenario } from "../fixtures/workspace-with-bundle.ts";
import { answered } from "../support/suite-postgres.ts";

const BID_LIBRARY = { templateId: "bid-library", collection: "company", subjectIri: null } as const;

export type SeededGuide = {
  readonly ng: Northgate;
  readonly guideId: string;
};

export const seededGuide = async (
  db: MigratedPostgres,
  scenario: Scenario,
): Promise<SeededGuide> => {
  const ng = await northgate(db, scenario);
  const { guideId } = answered(await seedGuide(ng.admin, doorsOf(scenario), BID_LIBRARY));
  return { ng, guideId };
};

export const editorOutsideFinance = async (
  db: MigratedPostgres,
  guide: SeededGuide,
): Promise<UserPrincipal> => {
  const found = await db.pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [
    guide.ng.reviewer,
  ]);
  const [person] = found.rows;
  if (person === undefined) throw new Error("the reviewer is no person");
  return principalFor(db, guide.ng.scenario.workspaceId, person.id);
};

export const writeUpOf = async (db: MigratedPostgres, guide: SeededGuide, prompt: string) => {
  const found = await db.pool.query<{ id: string }>(
    `SELECT w.id FROM write_up w
       JOIN guide_section s ON s.workspace_id = w.workspace_id AND s.guide_id = w.guide_id
                           AND s.id = w.section_id
      WHERE w.workspace_id = $1 AND w.guide_id = $2 AND s.prompt = $3`,
    [guide.ng.scenario.workspaceId, guide.guideId, prompt],
  );
  const row = found.rows[0];
  if (row === undefined) throw new Error(`no write-up for ${prompt}`);
  return row.id;
};

export const includeIdsOf = async (db: MigratedPostgres, writeUpId: string) => {
  const found = await db.pool.query<{ id: string }>(
    "SELECT id FROM write_up_include WHERE write_up_id = $1 ORDER BY ordinal",
    [writeUpId],
  );
  return found.rows.map((row) => row.id);
};

export const latestVersionOf = async (db: MigratedPostgres, writeUpId: string) => {
  const found = await db.pool.query<{ latest: number }>(
    "SELECT max(version)::int AS latest FROM write_up_version WHERE write_up_id = $1",
    [writeUpId],
  );
  return found.rows[0]?.latest ?? 0;
};

export const briefCiting = (includeIds: readonly string[]): string =>
  includeIds.map((id, at) => `Claim ${String(at + 1)}.[^${id}]`).join("\n\n");

export const saveBriefAs = (
  scenario: Scenario,
  as: UserPrincipal,
  input: { readonly writeUpId: string; readonly markdown: string; readonly base: number },
) => saveBrief(as, doorsOf(scenario), input);
