import { attempted, ok, type Result } from "./result.ts";

/** A value read back from D1, which hands a BLOB back as an array of bytes. */
export type Column = string | number | null | Uint8Array | ArrayBuffer | readonly number[];

export type Row = Readonly<Record<string, Column>>;

export type Bound = string | number | null | Uint8Array;

export type Statement = {
  readonly bind: (...values: readonly Bound[]) => Statement;
  readonly run: () => Promise<{ readonly success: boolean }>;
  readonly all: () => Promise<{ readonly results: readonly Row[] }>;
};

/** The few D1 calls the store makes, so a suite can drive the same SQL through `node:sqlite`. */
export type Database = { readonly prepare: (query: string) => Statement };

export type Received = {
  readonly receivedAtMs: number;
  readonly recipient: string;
  readonly from: string;
  readonly subject: string;
  readonly raw: Uint8Array;
};

export type Kept = Omit<Received, "raw"> & { readonly id: string };

type KeptMessage = Kept & { readonly raw: Uint8Array };

type PageAsked = { readonly after: string | undefined; readonly limit: number };

type KeptPage = { readonly messages: readonly Kept[]; readonly hasMore: boolean };

export type Store = {
  /** Answers the id it minted. */
  readonly keep: (received: Received) => Promise<Result<string>>;
  readonly prune: (nowMs: number) => Promise<Result<undefined>>;
  /** Newest first, after the id `after` names whether or not its row is still kept. */
  readonly page: (asked: PageAsked) => Promise<Result<KeptPage>>;
  readonly message: (id: string) => Promise<Result<KeptMessage | undefined>>;
  /** Writes one row and deletes it, so a store that cannot write answers before mail is sent. */
  readonly probe: (nowMs: number) => Promise<Result<undefined>>;
};

const RETENTION_MS = 86_400_000;

const INSERT =
  "INSERT INTO messages (id, received_at, recipient, header_from, subject, raw) VALUES (?, ?, ?, ?, ?, ?)";

const LISTED_COLUMNS = "id, received_at, recipient, header_from, subject";

const PAGE = `SELECT ${LISTED_COLUMNS} FROM messages WHERE ?1 IS NULL OR id < ?1 ORDER BY id DESC LIMIT ?2`;

const MESSAGE = `SELECT ${LISTED_COLUMNS}, raw FROM messages WHERE id = ?`;

const PRUNE = "DELETE FROM messages WHERE received_at < ?";

const FORGET = "DELETE FROM messages WHERE id = ?";

const UNREADABLE_ROW = "D1 answered a row the store cannot read";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Zero-padded, so ids sort as the times they were received do. */
const mintedId = (receivedAtMs: number): string =>
  `${String(receivedAtMs).padStart(16, "0")}-${hex(crypto.getRandomValues(new Uint8Array(8)))}`;

const bytesOf = (column: Column | undefined): Uint8Array | undefined => {
  if (column instanceof Uint8Array) return column;
  if (column instanceof ArrayBuffer) return new Uint8Array(column);
  return Array.isArray(column) ? Uint8Array.from(column) : undefined;
};

const keptOf = (row: Row): Kept | undefined => {
  const { id, received_at: receivedAtMs, recipient, header_from: from, subject } = row;
  if (typeof id !== "string" || typeof receivedAtMs !== "number") return undefined;
  if (typeof recipient !== "string" || typeof from !== "string" || typeof subject !== "string") {
    return undefined;
  }
  return { id, receivedAtMs, recipient, from, subject };
};

const keptMessageOf = (row: Row): KeptMessage | undefined => {
  const kept = keptOf(row);
  const raw = bytesOf(row["raw"]);
  return kept === undefined || raw === undefined ? undefined : { ...kept, raw };
};

const inserted = async (database: Database, id: string, received: Received): Promise<void> => {
  const { receivedAtMs, recipient, from, subject, raw } = received;
  await database.prepare(INSERT).bind(id, receivedAtMs, recipient, from, subject, raw).run();
};

const pageOf = async (database: Database, asked: PageAsked): Promise<Result<KeptPage>> => {
  const { results } = await database
    .prepare(PAGE)
    // One row more than asked, whose presence answers whether more remain.
    .bind(asked.after ?? null, asked.limit + 1)
    .all();
  const rows = results.map(keptOf);
  const messages = rows.filter((kept) => kept !== undefined);
  if (messages.length !== rows.length) return { ok: false, error: UNREADABLE_ROW };
  return ok({ messages: messages.slice(0, asked.limit), hasMore: messages.length > asked.limit });
};

const messageOf = async (
  database: Database,
  id: string,
): Promise<Result<KeptMessage | undefined>> => {
  const row = (await database.prepare(MESSAGE).bind(id).all()).results.at(0);
  if (row === undefined) return ok(undefined);
  const message = keptMessageOf(row);
  return message === undefined ? { ok: false, error: UNREADABLE_ROW } : ok(message);
};

/**
 * No recipient or sender, so no reader takes a row a failed delete leaves; the day's prune
 * removes it.
 */
const PROBE_ROW: Omit<Received, "receivedAtMs"> = {
  recipient: "",
  from: "",
  subject: "",
  raw: new TextEncoder().encode("probe"),
};

const probed = async (database: Database, nowMs: number): Promise<Result<undefined>> => {
  const id = mintedId(nowMs);
  await inserted(database, id, { ...PROBE_ROW, receivedAtMs: nowMs });
  await database.prepare(FORGET).bind(id).run();
  return ok(undefined);
};

/** Answers every D1 failure as an error, and never throws. */
export const storeOver = (database: Database): Store => ({
  keep: (received) =>
    attempted(async () => {
      const id = mintedId(received.receivedAtMs);
      await inserted(database, id, received);
      return ok(id);
    }),
  prune: (nowMs) =>
    attempted(async () => {
      await database
        .prepare(PRUNE)
        .bind(nowMs - RETENTION_MS)
        .run();
      return ok(undefined);
    }),
  page: (asked) => attempted(() => pageOf(database, asked)),
  message: (id) => attempted(() => messageOf(database, id)),
  probe: (nowMs) => attempted(() => probed(database, nowMs)),
});
