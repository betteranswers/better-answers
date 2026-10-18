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

export const scannedFilesUnder = (root: string, roots: readonly string[]): readonly string[] =>
  filesUnderEach(root, roots).filter((file) => SCANNED.test(file) && !isTestPath(file));

const IDENTIFIER = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)`;

const TABLE_REFERENCE = new RegExp(
  String.raw`\b(?<verb>DELETE\s+FROM|FROM|JOIN)\s+(?:ONLY\s+)?(?<name>${IDENTIFIER}(?:\.${IDENTIFIER})?)`,
  "gi",
);

const CTE_NAME = new RegExp(
  String.raw`(?:\bWITH(?:\s+RECURSIVE)?|,)\s*(?<name>${IDENTIFIER})\s*(?:\([^()]*\)\s*)?AS\s+(?:(?:NOT\s+)?MATERIALIZED\s+)?\(`,
  "gi",
);

const folded = (identifier: string): string =>
  identifier.startsWith('"') ? identifier.slice(1, -1) : identifier.toLowerCase();

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

const isCte = (name: string, ctes: ReadonlySet<string>): boolean =>
  !name.includes(".") && ctes.has(folded(name));

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

const claimsARead = ({ access }: CrossOwnerEntry): boolean => access !== "write";

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

export const undeclaredIn = (map: OwnershipMap, reads: readonly SliceRead[]): readonly string[] =>
  reads
    .filter(({ table }) => Object.hasOwn(map.TABLE_OWNERS, table))
    .filter((read) => read.slice === undefined || !isDeclared(map, read))
    .map((read) => refusalOf(map, read));

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
