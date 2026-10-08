import type pg from "pg";
import { describe, expect, it } from "vitest";

import { ulid } from "../src/index.ts";
import {
  AN_AUDIT_EVENT_ROW_BEFORE_THE_ACTION,
  AN_IDENTITY_SET_AUDIT_EVENT_ROW_BEFORE_THE_ACTION,
  AUDIT_LOGS,
  NAMES_BEFORE_THE_ACTION,
} from "./before-the-action.ts";
import { testData } from "./factory.ts";
import { whileAnAuditWriteIsOpen, withCommit, withRollback } from "./harness.ts";
import { asTheMigrationOwnerOf, migrationStatements } from "./journal-statements.ts";
import { postgresForSuite, refusalOf } from "./probes.ts";
import {
  AN_AUDIT_EVENT_ROW,
  AN_IDENTITY_SET_AUDIT_EVENT_ROW,
  THE_FAMILY_AND_SUBJECT_IT_LANDS_IN,
} from "./rls-probes.ts";

const db = postgresForSuite();

const THE_MIGRATION = "0073_the-action.sql";

const TEST_ACTOR = "process:better-answers-test";

const namedAsBefore = async (client: pg.PoolClient): Promise<void> => {
  for (const statement of NAMES_BEFORE_THE_ACTION) await client.query(statement);
};

/** As the superuser, since taking ownership would itself wait on a lock with no bound. */
const replayed = async (client: pg.PoolClient): Promise<void> => {
  for (const statement of migrationStatements(THE_MIGRATION)) await client.query(statement);
};

/** Run as a non-superuser owner of the two audit logs, as `migrate` connects. */
const migrated = (client: pg.PoolClient): Promise<void> =>
  asTheMigrationOwnerOf(
    client,
    AUDIT_LOGS.map((log) => `TABLE public.${log}`),
    () => replayed(client),
  );

/** Reads after 0073 runs again over the names before it, inside a transaction rolled back after. */
const replayedThen = <T>(read: (client: pg.PoolClient) => Promise<T>): Promise<T> =>
  withRollback(db().pool, async (client) => {
    await namedAsBefore(client);
    await migrated(client);
    return read(client);
  });

const STORED_ACTIONS = [
  ["audit_event", "sources.binding.published"],
  ["audit_event", "people.member.joined"],
  ["identity_audit_event", "people.person.signed_in"],
  ["identity_audit_event", "people.person.grants_ended"],
] as const;

/** Two workspaces' events and the identity set's, written under the old column's name. */
const seededBefore = async (client: pg.PoolClient): Promise<void> => {
  const seed = testData(client);
  for (const workspace of [await seed.workspace(), await seed.workspace()]) {
    for (const [log, action] of STORED_ACTIONS) {
      const detail = JSON.stringify({ kept: action });
      await (log === "audit_event"
        ? client.query(AN_AUDIT_EVENT_ROW_BEFORE_THE_ACTION, [
            ulid(),
            workspace.id,
            action,
            ulid(),
            detail,
          ])
        : client.query(AN_IDENTITY_SET_AUDIT_EVENT_ROW_BEFORE_THE_ACTION, [
            ulid(),
            action,
            ulid(),
            detail,
          ]));
    }
  }
};

/** A rewrite gives each table a new file, which a rename never does. */
const filesOf = async (client: pg.PoolClient) =>
  (
    await client.query<{ log: string; file: string }>(
      `SELECT relname AS log, relfilenode::text AS file FROM pg_class
        WHERE oid IN ('audit_event'::regclass, 'identity_audit_event'::regclass) ORDER BY 1`,
    )
  ).rows;

/** Each row with its place on disk and every value it holds. */
const rowsOf = async (client: pg.PoolClient, column: "act" | "action") => {
  const rows: Record<string, string>[] = [];
  for (const log of AUDIT_LOGS) {
    const read = await client.query<Record<string, string>>(
      `SELECT '${log}' AS log, id, ctid::text AS ctid, xmin::text AS xmin, ${column} AS stored,
              family, subject_kind, detail::text AS detail
         FROM ${log} ORDER BY id`,
    );
    rows.push(...read.rows);
  }
  return rows;
};

const columnsOf = async (client: pg.PoolClient) =>
  (
    await client.query<{ log: string; name: string; generated: string }>(
      `SELECT attrelid::regclass::text AS log, attname AS name, attgenerated AS generated
         FROM pg_attribute
        WHERE attrelid IN ('audit_event'::regclass, 'identity_audit_event'::regclass)
          AND attname IN ('act', 'action') AND NOT attisdropped
        ORDER BY 1, 2`,
    )
  ).rows;

const constraintsOf = async (client: pg.PoolClient) =>
  (
    await client.query<{ name: string; definition: string }>(
      `SELECT conname AS name, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid IN ('audit_event'::regclass, 'identity_audit_event'::regclass)
          AND conname ~ '_(act|action)_'
        ORDER BY 1`,
    )
  ).rows;

const derivedOf = async (client: pg.PoolClient) =>
  (
    await client.query<{ derived: string }>(
      `SELECT d.adrelid::regclass::text || '.' || a.attname || ' = ' || pg_get_expr(d.adbin, d.adrelid) AS derived
         FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
        WHERE d.adrelid IN ('audit_event'::regclass, 'identity_audit_event'::regclass)
          AND a.attgenerated = 's'
        ORDER BY 1`,
    )
  ).rows.map((row) => row.derived);

const ACTION_PATTERN = String.raw`'^(people|knowledge|sources|platform)\.[a-z][a-z_]*\.[a-z][a-z_]*$'::text`;

describe("migration 0073 over audit logs written before it", () => {
  it("keeps every row where it lay, under its stored name", async () => {
    const [before, after] = await withRollback(db().pool, async (client) => {
      await namedAsBefore(client);
      await seededBefore(client);
      const held = { files: await filesOf(client), rows: await rowsOf(client, "act") };
      await migrated(client);
      return [held, { files: await filesOf(client), rows: await rowsOf(client, "action") }];
    });

    expect(before.rows).toHaveLength(STORED_ACTIONS.length * 2);
    expect(after).toEqual(before);
    expect(after.rows.map((row) => row["stored"]).toSorted()).toEqual(
      [...STORED_ACTIONS, ...STORED_ACTIONS].map(([, action]) => action).toSorted(),
    );
  });

  it("renames the column and four constraints, leaving no old name", async () => {
    const [columns, constraints] = await replayedThen(async (client) => [
      await columnsOf(client),
      await constraintsOf(client),
    ]);

    expect(columns).toEqual([
      { log: "audit_event", name: "action", generated: "" },
      { log: "identity_audit_event", name: "action", generated: "" },
    ]);
    expect(constraints).toEqual([
      { name: "audit_event_action_check", definition: `CHECK ((action ~ ${ACTION_PATTERN}))` },
      { name: "audit_event_action_not_null", definition: "NOT NULL action" },
      {
        name: "identity_audit_event_action_check",
        definition: `CHECK ((action ~ ${ACTION_PATTERN}))`,
      },
      { name: "identity_audit_event_action_not_null", definition: "NOT NULL action" },
    ]);
  });

  it("derives family and subject kind from the renamed column", async () => {
    const [derived, landed] = await replayedThen(async (client) => {
      const { id: workspaceId } = await testData(client).workspace();
      const row = await client.query<{ family: string; subject_kind: string }>(
        `${AN_AUDIT_EVENT_ROW} ${THE_FAMILY_AND_SUBJECT_IT_LANDS_IN}`,
        [ulid(), workspaceId, "knowledge.concept.committed", TEST_ACTOR, ulid()],
      );
      return [await derivedOf(client), row.rows[0]];
    });

    expect(derived).toEqual([
      "audit_event.family = split_part(action, '.'::text, 1)",
      "audit_event.subject_kind = split_part(action, '.'::text, 2)",
      "identity_audit_event.family = split_part(action, '.'::text, 1)",
      "identity_audit_event.subject_kind = split_part(action, '.'::text, 2)",
    ]);
    expect(landed).toEqual({ family: "knowledge", subject_kind: "concept" });
  });

  it("refuses an action of no family by the new check", async () => {
    const refused = await replayedThen((client) =>
      refusalOf(client, () =>
        client.query(AN_IDENTITY_SET_AUDIT_EVENT_ROW, [
          ulid(),
          "nobody.person.signed_in",
          TEST_ACTOR,
          ulid(),
        ]),
      ),
    );

    expect(refused).toBe("identity_audit_event_action_check");
  });

  it("leaves no lock bound on the migrations after it", async () => {
    const after = await replayedThen(async (client) => {
      const shown = await client.query<{ lock_timeout: string }>("SHOW lock_timeout");
      return shown.rows[0]?.lock_timeout;
    });

    expect(after).toBe("0");
  });

  it("fails rather than waits behind an open audit write", async () => {
    await withCommit(db().pool, namedAsBefore);
    try {
      const blocked = whileAnAuditWriteIsOpen(db().pool, () => withRollback(db().pool, replayed));

      await expect(blocked).rejects.toThrow(/canceling statement due to lock timeout/u);
    } finally {
      await withCommit(db().pool, replayed);
    }
  });
});
