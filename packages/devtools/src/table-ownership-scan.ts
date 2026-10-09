import { readdirSync } from "node:fs";
import path from "node:path";

import { type Program, Visitor } from "oxc-parser";

import { parsedSource } from "./parsed-source.ts";
import { filesUnderEach, isTestPath } from "./paths.ts";

export const WHERE_THE_MAP_LIVES = "packages/schema/src/table-ownership.ts";

export const SCAN_EXECUTABLE = {
  package: "@better-answers/devtools",
  path: ["..", "..", "scripts", "table-ownership-scan.mjs"],
} as const;

const CORE = "packages/core/src";

/** The schema's own suite names these two as never an owner; `store`'s doors are listed outside. */
const NEVER_A_SLICE: ReadonlySet<string> = new Set(["kernel", "store"]);

const SCANNED = /\.tsx?$/;

export type CrossOwnerEntry = {
  readonly table: string;
  readonly by: string;
  readonly access: string;
};

export type OwnershipMap = {
  readonly TABLE_OWNERS: Readonly<Record<string, string>>;
  readonly CROSS_OWNER_TABLE_ACCESS: readonly CrossOwnerEntry[];
  readonly OWNERS_OUTSIDE_CORE: readonly string[];
};

export type Slice = { readonly name: string; readonly directory: string };

/** Each core directory but the two, and each outside owner by its path, the deepest first. */
export const slicesUnder = (root: string, outsideCore: readonly string[]): readonly Slice[] => {
  const inCore = readdirSync(path.join(root, CORE), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NEVER_A_SLICE.has(entry.name))
    .map((entry) => ({ name: entry.name, directory: `${CORE}/${entry.name}` }));
  const outside = outsideCore.map((owner) => ({ name: owner, directory: owner }));
  return [...inCore, ...outside].toSorted(
    (one, other) => other.directory.length - one.directory.length,
  );
};

export const sliceOf = (file: string, slices: readonly Slice[]): string | undefined =>
  slices.find(({ directory }) => file.startsWith(`${directory}/`))?.name;

/** Production TypeScript under the `roots` directories, relative to `root`, once and sorted. */
export const scannedFilesUnder = (root: string, roots: readonly string[]): readonly string[] =>
  filesUnderEach(root, roots).filter((file) => SCANNED.test(file) && !isTestPath(file));

const IDENTIFIER = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)`;

const TABLE_REFERENCE = new RegExp(
  String.raw`\b(?<verb>DELETE\s+FROM|FROM|JOIN)\s+(?:ONLY\s+)?(?<name>${IDENTIFIER}(?:\.${IDENTIFIER})?)`,
  "gi",
);

/** A name followed by `AS (`, after `WITH` or a comma: a column list and `MATERIALIZED` allowed. */
const CTE_NAME = new RegExp(
  String.raw`(?:\bWITH(?:\s+RECURSIVE)?|,)\s*(?<name>${IDENTIFIER})\s*(?:\([^()]*\)\s*)?AS\s+(?:(?:NOT\s+)?MATERIALIZED\s+)?\(`,
  "gi",
);

/** Postgres folds an unquoted name to lower case and keeps a quoted one as written. */
const folded = (identifier: string): string =>
  identifier.startsWith('"') ? identifier.slice(1, -1) : identifier.toLowerCase();

/** A table is named by schema and name; an unqualified one is on the search path, `public`. */
const qualified = (name: string): string => {
  const parts = (name.match(new RegExp(IDENTIFIER, "gi")) ?? []).map(folded);
  return parts.length === 1 ? `public.${parts.join("")}` : parts.join(".");
};

export type TableRead = {
  readonly file: string;
  readonly line: number;
  readonly table: string;
  readonly reads: boolean;
};

type Piece = { readonly offset: number; readonly text: string };

/** A quoted string's value, since it escapes a quoted name; a template raw, so its offsets are the file's. */
const stringsIn = (program: Program, source: string): readonly (readonly Piece[])[] => {
  const found: Piece[][] = [];
  new Visitor({
    Literal: (node) => {
      if (typeof node.value !== "string") return;
      found.push([{ offset: node.start + 1, text: node.value }]);
    },
    TemplateLiteral: (node) => {
      found.push(
        node.quasis.map(({ start, value }) => ({
          offset: source.indexOf(value.raw, start),
          text: value.raw,
        })),
      );
    },
  }).visit(program);
  return found;
};

const cteNamesIn = (pieces: readonly Piece[]): ReadonlySet<string> =>
  new Set(
    pieces.flatMap(({ text }) =>
      [...text.matchAll(CTE_NAME)].map((match) => folded(match.groups?.["name"] ?? "")),
    ),
  );

type Reference = { readonly offset: number; readonly name: string; readonly verb: string };

const referencesIn = ({ offset, text }: Piece): readonly Reference[] =>
  [...text.matchAll(TABLE_REFERENCE)].map((match) => ({
    offset: offset + match.index,
    name: match.groups?.["name"] ?? "",
    verb: match.groups?.["verb"] ?? "",
  }));

/** A CTE shadows only an unqualified name, so `public.member` past a `member` CTE is the table. */
const isCte = (name: string, ctes: ReadonlySet<string>): boolean =>
  !name.includes(".") && ctes.has(folded(name));

/** @throws when the file does not parse, which would otherwise read as naming no table. */
export const tablesReadIn = (file: string, source: string): readonly TableRead[] => {
  const { program, lineOf } = parsedSource(file, source);
  return stringsIn(program, source).flatMap((pieces) => {
    const ctes = cteNamesIn(pieces);
    return pieces
      .flatMap(referencesIn)
      .filter(({ name }) => !isCte(name, ctes))
      .map(({ offset, name, verb }) => ({
        file,
        line: lineOf(offset),
        table: qualified(name),
        reads: !/^DELETE/i.test(verb),
      }));
  });
};

export type SliceRead = TableRead & { readonly slice: string | undefined };

/** A write-only entry is out of reach: the slices write through helpers that take the table's name. */
const claimsARead = ({ access }: CrossOwnerEntry): boolean => access !== "write";

/** A read needs an entry that claims one; a delete is a write, which any entry covers. */
const isDeclared = (map: OwnershipMap, { table, slice, reads }: SliceRead): boolean =>
  map.TABLE_OWNERS[table] === slice ||
  map.CROSS_OWNER_TABLE_ACCESS.some(
    (entry) => entry.table === table && entry.by === slice && (!reads || claimsARead(entry)),
  );

const refusalOf = (map: OwnershipMap, { file, line, table, slice, reads }: SliceRead): string => {
  const where = `${file}:${String(line)}`;
  if (slice === undefined) {
    return `${where}: names ${table} outside every slice the map can name; move the statement into the slice that needs it.`;
  }
  const declared = reads ? "declares no read" : "declares no access";
  return `${where}: ${slice} names ${table}, which ${String(map.TABLE_OWNERS[table])} owns, and ${WHERE_THE_MAP_LIVES} ${declared} by ${slice}; read it through its owner's face, or give it an entry with its reason in CROSS_OWNER_TABLE_ACCESS.`;
};

/** Each table a slice names beyond what it owns or declares, and each named outside a slice. */
export const undeclaredIn = (map: OwnershipMap, reads: readonly SliceRead[]): readonly string[] =>
  reads
    .filter(({ table }) => Object.hasOwn(map.TABLE_OWNERS, table))
    .filter((read) => read.slice === undefined || !isDeclared(map, read))
    .map((read) => refusalOf(map, read));

/** Each entry that claims a read no statement in its slice makes. */
export const unreadIn = (map: OwnershipMap, reads: readonly SliceRead[]): readonly string[] =>
  map.CROSS_OWNER_TABLE_ACCESS.filter(claimsARead)
    .filter(
      (entry) =>
        !reads.some((read) => read.reads && read.table === entry.table && read.slice === entry.by),
    )
    .map(
      ({ table, by }) =>
        `${WHERE_THE_MAP_LIVES}: declares that ${by} reads ${table}, and no statement under ${by} reads it; remove the entry, or correct its access to a write if the slice only writes it.`,
    );
