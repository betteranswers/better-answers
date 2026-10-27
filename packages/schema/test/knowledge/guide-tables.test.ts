import type pg from "pg";
import { assert, describe, expect, it } from "vitest";

import { ulid } from "../../src/index.ts";
import { asTheMigrationOwnerOf, migrationStatements } from "../migrations/journal-statements.ts";
import { type TestData, testData } from "../support/factory.ts";
import { withRollback } from "../support/harness.ts";
import { matching } from "../support/matching.ts";
import {
  ADMITTED,
  postgresForSuite,
  refusalOf,
  refusesEach,
  sqlstateOf,
} from "../support/probes.ts";
import {
  A_GUIDE_ROLE,
  A_HOMED_WRITE_UP,
  A_USAGE,
  A_WORDED_INCLUDE,
  GUIDE_RECORDS,
  THE_SECOND_GUIDE_DEFINITION_VERSION,
  THE_SECOND_WRITE_UP_VERSION,
} from "../support/rls-probes.ts";

const db = postgresForSuite();

const WS_A = "01J6AAAAAAAAAAAAAAAAAAAAAA";
const WS_B = "01J6BBBBBBBBBBBBBBBBBBBBBB";

const INSUFFICIENT_PRIVILEGE = "42501";

const THE_MIGRATION = "0098_the-guide-records.sql";

const seedTwoWorkspaces = async (client: pg.PoolClient): Promise<TestData> => {
  const seed = testData(client);
  await seed.workspace({ id: WS_A, name: "A" });
  await seed.workspace({ id: WS_B, name: "B" });
  return seed;
};

const scopedAs = async (client: pg.PoolClient, role: string, workspaceId: string) => {
  await client.query(`SET LOCAL ROLE ${role}`);
  await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
};

const PERSON = "01J6CCCCCCCCCCCCCCCCCCCCCC";

const NEXT_VERSION_OF: Readonly<
  Record<string, { readonly seeded: (seed: TestData) => Promise<string>; readonly next: string }>
> = {
  guide_definition_version: {
    seeded: async (seed) => (await seed.guideDefinitionVersion({ workspaceId: WS_A })).guideId,
    next: THE_SECOND_GUIDE_DEFINITION_VERSION,
  },
  write_up_version: {
    seeded: async (seed) => (await seed.writeUpVersion({ workspaceId: WS_A })).writeUpId,
    next: THE_SECOND_WRITE_UP_VERSION,
  },
};

const versionTables = async (client: pg.PoolClient): Promise<readonly string[]> => {
  const found = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name IN ('version', 'actor', 'at', 'note')
      GROUP BY table_name HAVING count(DISTINCT column_name) = 4
      ORDER BY table_name`,
  );
  return found.rows.map((row) => row.table_name);
};

describe("the version tables", () => {
  it("refuses update and delete on every version table", async () => {
    await withRollback(db().pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const tables = await versionTables(client);
      expect(tables).toEqual(["guide_definition_version", "write_up_version"]);

      const nextVersions: { table: string; next: string; parent: string }[] = [];
      for (const table of tables) {
        const shape = NEXT_VERSION_OF[table];
        assert(shape !== undefined, `a next version is written for ${table}`);
        nextVersions.push({ table, next: shape.next, parent: await shape.seeded(seed) });
      }
      await scopedAs(client, "app_rt", WS_A);

      for (const table of tables) {
        await refusesEach(client, [
          [`UPDATE "${table}" SET note = 'x'`, `a version of ${table} is never rewritten`],
          [`DELETE FROM "${table}"`, `a version of ${table} is kept for good`],
        ]);
      }
      for (const { table, next, parent } of nextVersions) {
        const appended = await client.query(next, [WS_A, parent]);
        expect({ table, appended: appended.rowCount }).toEqual({ table, appended: 1 });
      }
    });
  });
});

describe("the write-up's home and marks", () => {
  const placed = async (client: pg.PoolClient) => {
    const seed = await seedTwoWorkspaces(client);
    const section = await seed.guideSection({ workspaceId: WS_A });
    await scopedAs(client, "app_rt", WS_A);
    return section;
  };

  it("refuses a section home without its section", async () => {
    await withRollback(db().pool, async (client) => {
      const section = await placed(client);
      const id = ulid();
      const homed = (sectionId: string | null) => [
        WS_A,
        id,
        "section",
        section.guideId,
        sectionId,
        null,
        null,
      ];

      expect({
        valid: await refusalOf(client, () => client.query(A_HOMED_WRITE_UP, homed(section.id))),
        refused: await refusalOf(client, () => client.query(A_HOMED_WRITE_UP, homed(null))),
      }).toEqual({ valid: ADMITTED, refused: "write_up_home_check" });
    });
  });

  it("refuses a response home carrying a guide", async () => {
    await withRollback(db().pool, async (client) => {
      const section = await placed(client);
      const [id, question] = [ulid(), ulid()];
      const answering = (guideId: string | null) => [
        WS_A,
        id,
        "response",
        guideId,
        null,
        question,
        null,
      ];

      expect({
        valid: await refusalOf(client, () => client.query(A_HOMED_WRITE_UP, answering(null))),
        refused: await refusalOf(client, () =>
          client.query(A_HOMED_WRITE_UP, answering(section.guideId)),
        ),
      }).toEqual({ valid: ADMITTED, refused: "write_up_home_check" });
    });
  });

  it("refuses a needs review reason outside the four", async () => {
    await withRollback(db().pool, async (client) => {
      const section = await placed(client);
      const id = ulid();
      const marked = (reason: string) => [
        WS_A,
        id,
        "section",
        section.guideId,
        section.id,
        null,
        reason,
      ];

      expect({
        valid: await refusalOf(client, () =>
          client.query(A_HOMED_WRITE_UP, marked("concept-changed")),
        ),
        refused: await refusalOf(client, () => client.query(A_HOMED_WRITE_UP, marked("stale"))),
      }).toEqual({ valid: ADMITTED, refused: "write_up_needs_review_check" });
    });
  });

  it("refuses a wording heading without its hash", async () => {
    await withRollback(db().pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const writeUp = await seed.writeUp({ workspaceId: WS_A });
      const { iri } = await seed.conceptIdentity({ workspaceId: WS_A });
      await scopedAs(client, "app_rt", WS_A);
      const worded = (hash: string | null) => [WS_A, writeUp.id, iri, "Our approach", hash];

      expect({
        valid: await refusalOf(client, () =>
          client.query(A_WORDED_INCLUDE, worded("b".repeat(64))),
        ),
        refused: await refusalOf(client, () => client.query(A_WORDED_INCLUDE, worded(null))),
      }).toEqual({ valid: ADMITTED, refused: "write_up_include_wording_check" });
    });
  });
});

describe("the usage record", () => {
  it("refuses usage naming both a write-up and a concept", async () => {
    await withRollback(db().pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const version = await seed.writeUpVersion({ workspaceId: WS_A });
      const { iri } = await seed.conceptIdentity({ workspaceId: WS_A });
      await scopedAs(client, "app_rt", WS_A);
      const id = ulid();
      const used = (target: string | null) => [
        WS_A,
        id,
        version.writeUpId,
        version.version,
        target,
      ];

      expect({
        valid: await refusalOf(client, () => client.query(A_USAGE, used(null))),
        refused: await refusalOf(client, () => client.query(A_USAGE, used(iri))),
      }).toEqual({ valid: ADMITTED, refused: "usage_one_target_check" });
    });
  });
});

describe("the guide's roles", () => {
  it("refuses a second row for one guide role", async () => {
    await withRollback(db().pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const guide = await seed.guideDefinition({ workspaceId: WS_A });
      await scopedAs(client, "app_rt", WS_A);
      await client.query(A_GUIDE_ROLE, [WS_A, guide.id, "Editor", "assembled"]);

      expect({
        another: await refusalOf(client, () =>
          client.query(A_GUIDE_ROLE, [WS_A, guide.id, "Viewer", "assembled"]),
        ),
        second: await refusalOf(client, () =>
          client.query(A_GUIDE_ROLE, [WS_A, guide.id, "Editor", "quoted"]),
        ),
      }).toEqual({ another: ADMITTED, second: "guide_role_workspace_id_guide_id_role_pk" });
    });
  });
});

describe("the actor definer", () => {
  const PSEUDONYMISE =
    "SELECT pseudonymise_record_actors($1, 'write_up_version', $2, $3) AS rewritten";

  it("refuses the actor definer another workspace's rows", async () => {
    await withRollback(db().pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const actor = `human:${PERSON}`;
      const markdown = "Our approach to insurance.";
      await seed.writeUpVersion({ workspaceId: WS_A, actor, markdown });
      await seed.writeUpVersion({ workspaceId: WS_B, actor, markdown });
      const { pseudonym } = await seed.erasureRequest({ workspaceId: WS_A });
      await scopedAs(client, "app_rt", WS_A);

      await refusesEach(client, [
        [
          PSEUDONYMISE,
          "the definer rewrites the transaction's own workspace and no other",
          [WS_B, [PERSON], pseudonym],
          /the transaction is scoped to another workspace/,
        ],
        [
          PSEUDONYMISE,
          "the definer takes a person by their person id alone",
          [WS_A, ["priya@example.invalid"], pseudonym],
          /a person is named by their person id/,
        ],
        [
          PSEUDONYMISE,
          "the definer writes only a pseudonym an erasure here minted",
          [WS_A, [PERSON], ulid()],
          /no erasure in this workspace minted that pseudonym/,
        ],
        [
          "SELECT pseudonymise_record_actors($1, 'usage', $2, $3)",
          "the definer rewrites the two version tables and no other",
          [WS_A, [PERSON], pseudonym],
          /names no version table/,
        ],
      ]);
      const allowed = await client.query<{ rewritten: number }>(PSEUDONYMISE, [
        WS_A,
        [PERSON],
        pseudonym,
      ]);
      await client.query("RESET ROLE");
      const after = await client.query<{ workspace_id: string; actor: string; markdown: string }>(
        "SELECT workspace_id, actor, markdown FROM write_up_version ORDER BY workspace_id",
      );

      expect({ rewritten: allowed.rows[0]?.rewritten, after: after.rows }).toEqual({
        rewritten: 1,
        after: [
          { workspace_id: WS_A, actor: `human:${pseudonym}`, markdown },
          { workspace_id: WS_B, actor, markdown },
        ],
      });

      await scopedAs(client, "worker_rt", WS_A);
      await refusesEach(client, [
        [PSEUDONYMISE, "the worker never rewrites a version", [WS_A, [PERSON], pseudonym]],
      ]);
    });
  });
});

describe("the worker", () => {
  const sqlstateAnswering = async (client: pg.PoolClient, statement: string): Promise<string> => {
    await client.query("SAVEPOINT worker_probe");
    const answered = await client.query(statement).then(() => "allowed", sqlstateOf);
    await client.query("ROLLBACK TO SAVEPOINT worker_probe");
    return answered;
  };

  it("refuses the worker every guide record", async () => {
    await withRollback(db().pool, async (client) => {
      await seedTwoWorkspaces(client);
      await scopedAs(client, "worker_rt", WS_A);
      const statements = GUIDE_RECORDS.flatMap((table) => [
        `SELECT 1 FROM "${table}" LIMIT 1`,
        `INSERT INTO "${table}" DEFAULT VALUES`,
        `DELETE FROM "${table}"`,
      ]);

      const answered: Record<string, string> = {};
      for (const statement of statements) {
        answered[statement] = await sqlstateAnswering(client, statement);
      }

      expect(answered).toEqual(
        Object.fromEntries(statements.map((statement) => [statement, INSUFFICIENT_PRIVILEGE])),
      );
    });
  });
});

describe("the migration over stored write-ups", () => {
  const guard = (): readonly string[] => {
    const statements = migrationStatements(THE_MIGRATION);
    return statements.slice(
      0,
      statements.findIndex((statement) => statement.startsWith("CREATE TABLE")),
    );
  };

  const guarded = (client: pg.PoolClient): Promise<string> =>
    asTheMigrationOwnerOf(client, ["TABLE public.write_up", "TABLE public.write_up_include"], () =>
      refusalOf(client, async () => {
        for (const statement of guard()) await client.query(statement);
      }),
    );

  it("stops before adding columns over a stored write-up", async () => {
    const empty = await withRollback(db().pool, guarded);
    const held = await withRollback(db().pool, async (client) => {
      await testData(client).writeUp();
      return guarded(client);
    });

    expect({ empty, held }).toEqual({
      empty: ADMITTED,
      held: matching.stringMatching(/write_up and write_up_include hold rows/),
    });
  });
});
