import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import type { Bound, Column, Database, Row, Statement } from "../src/store.ts";

const MIGRATION = readFileSync(new URL("../migrations/0001_messages.sql", import.meta.url), "utf8");

/** D1 hands a BLOB back as an array of bytes, so the stand-in does too. */
const columnOf = (value: SQLOutputValue): Column => {
  if (value instanceof Uint8Array) return Array.from(value);
  return typeof value === "bigint" ? Number(value) : value;
};

const rowOf = (row: Readonly<Record<string, SQLOutputValue>>): Row =>
  Object.fromEntries(Object.entries(row).map(([name, value]) => [name, columnOf(value)]));

export type D1StandIn = {
  readonly database: Database;
  /** Every statement run or read, in order, so a suite can tell that a request touched nothing. */
  readonly ran: readonly string[];
  /** Deletes one row outside the store, as a prune deletes the row a reader's cursor names. */
  readonly forget: (id: string) => void;
  /** Overwrites one column with text, which SQLite stores whatever the column's type, so D1 answers a row the store cannot read. */
  readonly corrupt: (id: string, column: "received_at" | "raw") => void;
};

/** D1 over `node:sqlite`, set up by the Worker's own migration; `failsOn` names what it refuses. */
export const d1StandIn = (failsOn?: RegExp): D1StandIn => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(MIGRATION);
  const ran: string[] = [];
  const attempted = (query: string): void => {
    ran.push(query);
    if (failsOn !== undefined && failsOn.test(query)) {
      throw new Error("D1_ERROR: the stand-in refuses this statement");
    }
  };
  const statement = (query: string, values: readonly Bound[]): Statement => ({
    bind: (...bound) => statement(query, bound),
    run: async () => {
      attempted(query);
      sqlite.prepare(query).run(...values);
      return { success: true };
    },
    all: async () => {
      attempted(query);
      return {
        results: sqlite
          .prepare(query)
          .all(...values)
          .map(rowOf),
      };
    },
  });
  return {
    database: { prepare: (query) => statement(query, []) },
    ran,
    forget: (id) => {
      sqlite.prepare("DELETE FROM messages WHERE id = ?").run(id);
    },
    corrupt: (id, column) => {
      sqlite.prepare(`UPDATE messages SET ${column} = 'unreadable' WHERE id = ?`).run(id);
    },
  };
};
