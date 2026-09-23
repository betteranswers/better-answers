import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { type MigratedPostgres, withRollback } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
  return async () => {
    await db.stop();
  };
});

const NULL_SAFE_IDIOMS: readonly {
  readonly idiom: string;
  readonly why: string;
  readonly example: string;
}[] = [
  {
    idiom: "x IS [NOT] NULL, as in (a IS NULL) = (b IS NULL)",
    why: "IS NULL and IS NOT NULL answer true or false and never NULL, so a comparison of two such answers is never NULL either",
    example: "(maybe IS NULL) = (other IS NOT NULL)",
  },
  {
    idiom: "a IS [NOT] DISTINCT FROM b",
    why: "IS [NOT] DISTINCT FROM compares NULL as a value, answering true or false where = would answer NULL",
    example: "maybe IS NOT DISTINCT FROM 'a'",
  },
  {
    idiom: "x IS NULL OR …",
    why: "when x is NULL that branch is true and so is the OR, so the other branches decide only a row whose x is not NULL",
    example: "maybe IS NULL OR maybe <> always",
  },
  {
    idiom: "x IS NOT NULL AND …",
    why: "when x is NULL that branch is false and so is the AND, so the other branches decide only a row whose x is not NULL",
    example: "maybe IS NOT NULL AND maybe <> always",
  },
];

type Tree =
  | {
      readonly kind: "node";
      readonly name: string;
      readonly fields: ReadonlyMap<string, readonly Tree[]>;
    }
  | { readonly kind: "list"; readonly items: readonly Tree[] }
  | { readonly kind: "atom"; readonly text: string };

// The stored tree rather than `pg_get_constraintdef`'s SQL, where a quoted string or a pattern
// could hide a column's name.
const TOKEN = /"(?:\\.|[^"\\])*"|[{}()[\]]|(?:\\.|[^\s{}()[\]"\\])+/gu;

const treeOf = (stored: string): Tree => {
  const tokens = stored.match(TOKEN) ?? [];
  let at = 0;
  const take = (): string => {
    const token = tokens[at];
    if (token === undefined) throw new Error(`the stored expression ended early: ${stored}`);
    at += 1;
    return token;
  };
  const read = (): Tree => {
    const token = take();
    if (token === "{") {
      const name = take();
      const fields = new Map<string, Tree[]>();
      let values: Tree[] = [];
      while (tokens[at] !== "}") {
        if (tokens[at]?.startsWith(":")) {
          values = [];
          fields.set(take(), values);
        } else {
          values.push(read());
        }
      }
      take();
      return { kind: "node", name, fields };
    }
    if (token === "(" || token === "[") {
      const close = token === "(" ? ")" : "]";
      const items: Tree[] = [];
      while (tokens[at] !== close) items.push(read());
      take();
      return { kind: "list", items };
    }
    return { kind: "atom", text: token };
  };
  return read();
};

const fieldOf = (tree: Tree | undefined, name: string): readonly Tree[] =>
  tree?.kind === "node" ? (tree.fields.get(name) ?? []) : [];

const atomIn = (values: readonly Tree[]): string | undefined => {
  const [first] = values;
  return first?.kind === "atom" ? first.text : undefined;
};

// An outer join can hand a NULL to a domain declared NOT NULL, so its VALUE counts as nullable
// whatever the domain declares.
const DOMAIN_VALUE = "VALUE";

const inputReadBy = (tree: Tree | undefined): string | undefined => {
  if (tree?.kind !== "node") return undefined;
  if (tree.name === "VAR") return atomIn(fieldOf(tree, ":varattno"));
  if (tree.name === "COERCETODOMAINVALUE") return DOMAIN_VALUE;
  return undefined;
};

// Postgres stores a NullTestType as its ordinal.
const IS_NULL = "0";
const IS_NOT_NULL = "1";

const guardsAmong = (tree: Extract<Tree, { kind: "node" }>): readonly string[] => {
  const boolop = atomIn(fieldOf(tree, ":boolop"));
  const guard = boolop === "or" ? IS_NULL : boolop === "and" ? IS_NOT_NULL : undefined;
  return fieldOf(tree, ":args").flatMap((args) =>
    args.kind === "list"
      ? args.items.flatMap((arg) => {
          const input =
            arg.kind === "node" &&
            arg.name === "NULLTEST" &&
            atomIn(fieldOf(arg, ":nulltesttype")) === guard
              ? inputReadBy(fieldOf(arg, ":arg")[0])
              : undefined;
          return input === undefined ? [] : [input];
        })
      : [],
  );
};

// A NULL written into a CHECK answers as a NULL column does, so `x IN ('a', NULL)` is a read.
const WRITTEN_NULL = "NULL";

const readsOutsideAnIdiom = (
  tree: Tree,
  nullable: ReadonlyMap<string, string>,
): readonly string[] => {
  const walk = (at: Tree, guarded: ReadonlySet<string>): readonly string[] => {
    if (at.kind === "atom") return [];
    if (at.kind === "list") return at.items.flatMap((item) => walk(item, guarded));
    if (at.name === "NULLTEST" || at.name === "DISTINCTEXPR") return [];
    if (at.name === "CONST") {
      return atomIn(fieldOf(at, ":constisnull")) === "true" ? [WRITTEN_NULL] : [];
    }
    const input = inputReadBy(at);
    if (input !== undefined) {
      const column = nullable.get(input);
      return column === undefined || guarded.has(input) ? [] : [column];
    }
    const guardedBelow =
      at.name === "BOOLEXPR" ? new Set([...guarded, ...guardsAmong(at)]) : guarded;
    return [...at.fields.values()].flat().flatMap((value) => walk(value, guardedBelow));
  };
  return walk(tree, new Set());
};

type UnsafeCheck = {
  readonly check: string;
  readonly on: string;
  readonly definition: string;
  readonly reads: readonly string[];
};

// Reads columns and written NULLs only: a subscript, field or function answering NULL on a
// non-NULL value, as `->` on an absent key, passes unseen.
const unsafeChecks = async (client: pg.PoolClient): Promise<readonly UnsafeCheck[]> => {
  const { rows } = await client.query<{
    check: string;
    on: string;
    definition: string;
    tree: string;
    nullable: { input: string; column: string }[];
  }>(
    `SELECT c.conname AS "check",
            CASE WHEN c.contypid = 0 THEN c.conrelid::regclass::text
                 ELSE c.contypid::regtype::text END AS "on",
            pg_get_constraintdef(c.oid) AS definition,
            c.conbin::text AS tree,
            CASE WHEN c.contypid = 0 THEN
                   COALESCE((SELECT json_agg(json_build_object('input', a.attnum::text,
                                                               'column', a.attname))
                               FROM pg_attribute a
                              WHERE a.attrelid = c.conrelid AND a.attnum > 0
                                AND NOT a.attnotnull AND NOT a.attisdropped), '[]'::json)
                 ELSE json_build_array(json_build_object('input', $1::text, 'column', $1::text))
            END AS nullable
       FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.contype = 'c' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY 2, 1`,
    [DOMAIN_VALUE],
  );
  return rows.flatMap(({ check, on, definition, tree, nullable }) => {
    const reads = readsOutsideAnIdiom(
      treeOf(tree),
      new Map(nullable.map(({ input, column }) => [input, column])),
    );
    return reads.length === 0 ? [] : [{ check, on, definition, reads: [...new Set(reads)] }];
  });
};

const PROBE_TABLE = "null_probe";

const PROBE_DOMAIN = "null_probe_value";

const onTheProbe = (expression: string): string =>
  `ALTER TABLE ${PROBE_TABLE} ADD CHECK (${expression})`;

const readsOfEach = async (
  client: pg.PoolClient,
  statements: readonly string[],
): Promise<readonly (readonly [string, readonly string[]])[]> => {
  await client.query(`CREATE TABLE ${PROBE_TABLE} (maybe text, other text, always text NOT NULL)`);
  const answers: (readonly [string, readonly string[]])[] = [];
  for (const statement of statements) {
    await client.query("SAVEPOINT null_probe");
    await client.query(statement);
    const probed = (await unsafeChecks(client)).filter(
      ({ on }) => on === PROBE_TABLE || on === PROBE_DOMAIN,
    );
    answers.push([statement, probed.flatMap(({ reads }) => reads)]);
    await client.query("ROLLBACK TO SAVEPOINT null_probe");
  }
  return answers;
};

describe("every CHECK the migrated database holds", () => {
  it("reads a nullable column only in a NULL-safe idiom, so none admits a row for the NULL in it", async () => {
    expect(await withRollback(db.pool, unsafeChecks)).toEqual([]);
  });
});

describe("the NULL-safety gate over the CHECKs", () => {
  it("turns red on the quarantine error CHECK written with = over its nullable outcome, which admits the row it exists to refuse", async () => {
    await withRollback(db.pool, async (client) => {
      await client.query(
        'ALTER TABLE "source_document" DROP CONSTRAINT "source_document_quarantine_error_check"',
      );
      await client.query(
        `ALTER TABLE "source_document" ADD CONSTRAINT "source_document_quarantine_error_check"
           CHECK (quarantine_error IS NULL OR outcome = 'quarantined')`,
      );

      expect(await unsafeChecks(client)).toEqual([
        {
          check: "source_document_quarantine_error_check",
          on: "source_document",
          definition: "CHECK (((quarantine_error IS NULL) OR (outcome = 'quarantined'::text)))",
          reads: ["outcome"],
        },
      ]);
    });
  });

  it.each(NULL_SAFE_IDIOMS)("admits $idiom, because $why", async ({ example }) => {
    await withRollback(db.pool, async (client) => {
      expect(await readsOfEach(client, [onTheProbe(example)])).toEqual([[onTheProbe(example), []]]);
    });
  });

  it("admits a CHECK naming NOT NULL columns alone, and a domain's VALUE behind its guard", async () => {
    const admitted = [
      [onTheProbe("always <> ''"), []],
      [`CREATE DOMAIN ${PROBE_DOMAIN} AS text CHECK (VALUE IS NULL OR VALUE <> '')`, []],
    ] as const;

    await withRollback(db.pool, async (client) => {
      expect(
        await readsOfEach(
          client,
          admitted.map(([statement]) => statement),
        ),
      ).toEqual(admitted);
    });
  });

  it("refuses a nullable read outside an idiom, a guard misplaced or read past its own OR, and a written NULL", async () => {
    const refused = [
      [onTheProbe("maybe <> always"), ["maybe"]],
      [onTheProbe("maybe IS NOT NULL OR maybe <> always"), ["maybe"]],
      [onTheProbe("maybe IS NULL AND maybe <> always"), ["maybe"]],
      [onTheProbe("(maybe IS NULL OR maybe <> '') AND maybe <> always"), ["maybe"]],
      [onTheProbe("always IN ('a', NULL)"), ["NULL"]],
      [`CREATE DOMAIN ${PROBE_DOMAIN} AS text NOT NULL CHECK (VALUE <> '')`, ["VALUE"]],
    ] as const;

    await withRollback(db.pool, async (client) => {
      expect(
        await readsOfEach(
          client,
          refused.map(([statement]) => statement),
        ),
      ).toEqual(refused);
    });
  });
});
