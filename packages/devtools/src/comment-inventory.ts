import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Comment as GroupedComment } from "@oxlint/plugins";
import {
  type Comment,
  type Program,
  type PropertyKey,
  type VariableDeclaration,
  Visitor,
} from "oxc-parser";
import { z } from "zod";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import { blocksIn, isExempt, lastOf, proseOf } from "../lint-rules/shared/comment-blocks.ts";
import type { Block } from "../lint-rules/shared/comment-blocks.ts";
import { flagValues } from "./flags.ts";
import { parsedSource } from "./parsed-source.ts";
import { filesUnderEach } from "./paths.ts";

const KINDS = ["doc", "line", "trailing", "directive"] as const;

type Kind = (typeof KINDS)[number];

const CLASSES = [
  "narration",
  "held",
  "structure",
  "open",
  "foreign",
  "contract",
  "suppression",
  "lost",
] as const;

type Class = (typeof CLASSES)[number] | "";

const KEPT: ReadonlySet<Class> = new Set(["foreign", "contract", "suppression"]);

const NEEDS_A_HOLDER: ReadonlySet<Class> = new Set(["held", "structure"]);

const TRACKER_ISSUE = /^BA-\d+$/;

const COLUMNS = [
  "path",
  "start",
  "end",
  "kind",
  "attached",
  "words",
  "text",
  "class",
  "holder",
  "structure",
  "unit",
] as const;

const HEADER = COLUMNS.join("\t");

const ESCAPED = new Map([
  ["\\", "\\\\"],
  ["\t", "\\t"],
  ["\n", "\\n"],
  ["\r", "\\r"],
]);

const UNESCAPED = new Map([...ESCAPED].map(([one, written]) => [written.slice(1), one]));

const WELL_ESCAPED = /^(?:[^\\]|\\[\\tnr])*$/;

const escaped = (value: string): string =>
  value.replace(/[\\\t\n\r]/g, (one) => ESCAPED.get(one) ?? one);

const field = z
  .string()
  .refine((raw) => WELL_ESCAPED.test(raw), "a backslash escapes only \\, t, n or r")
  .transform((raw) => raw.replace(/\\([\\tnr])/g, (_, one: string) => UNESCAPED.get(one) ?? one));

const counted = (least: number) => field.pipe(z.coerce.number<string>().int().min(least));

const rowSchema = z
  .object({
    path: field.pipe(z.string().min(1)),
    start: counted(1),
    end: counted(1),
    kind: field.pipe(z.enum(KINDS)),
    attached: field,
    words: counted(0),
    text: field.pipe(z.string().min(1)),
    class: field.pipe(z.union([z.enum(CLASSES), z.literal("")])),
    holder: field,
    structure: field,
    unit: field,
  })
  .refine((row) => row.end >= row.start, { message: "ends before it starts", path: ["end"] });

type Row = Readonly<z.output<typeof rowSchema>>;

type Outcome<T> = { readonly value: T } | { readonly refused: readonly string[] };

const rowAt = (line: string, number: number): Outcome<Row> => {
  const fields = line.split("\t");
  if (fields.length !== COLUMNS.length) {
    return { refused: [`line ${number}: ${fields.length} fields, not ${COLUMNS.length}`] };
  }
  const read = rowSchema.safeParse(
    Object.fromEntries(COLUMNS.map((column, index) => [column, fields[index]])),
  );
  if (read.success) return { value: read.data };
  const [issue] = read.error.issues;
  return { refused: [`line ${number}: ${issue?.path.join(".")} ${issue?.message}`] };
};

const rowsIn = (tsv: string): Outcome<readonly Row[]> => {
  const [header, ...lines] = tsv.replace(/\n$/, "").split("\n");
  if (header !== HEADER) return { refused: [`line 1: the header is not ${COLUMNS.join(", ")}`] };
  const rows: Row[] = [];
  for (const [index, line] of lines.entries()) {
    const read = rowAt(line, index + 2);
    if ("refused" in read) return read;
    rows.push(read.value);
  }
  return { value: rows };
};

const tsvOf = (rows: readonly Row[]): string =>
  [HEADER, ...rows.map((row) => COLUMNS.map((column) => escaped(String(row[column]))).join("\t"))]
    .map((line) => `${line}\n`)
    .join("");

type Cut = { readonly start: number; readonly end: number };

type Found = { readonly row: Row; readonly cut: Cut };

const lineStartOf = (source: string, offset: number): number =>
  source.lastIndexOf("\n", offset - 1) + 1;

const grouped = (
  source: string,
  lineOf: (offset: number) => number,
  comment: Comment,
): GroupedComment => {
  const at = (offset: number) => ({
    line: lineOf(offset),
    column: offset - lineStartOf(source, offset),
  });
  return {
    ...comment,
    range: [comment.start, comment.end],
    loc: { start: at(comment.start), end: at(comment.end) },
  };
};

const emptyContainersIn = (program: Program): readonly Cut[] => {
  const found: Cut[] = [];
  new Visitor({
    JSXExpressionContainer: (node) => {
      if (node.expression.type === "JSXEmptyExpression") found.push(node);
    },
  }).visit(program);
  return found;
};

const cutOf = (source: string, block: Block, containers: readonly Cut[]): Cut => {
  const start = block[0].start;
  const { end } = lastOf(block);
  const holding = containers.find(
    (one) =>
      one.start < start &&
      end < one.end &&
      source.slice(one.start + 1, start).trim() === "" &&
      source.slice(end, one.end - 1).trim() === "",
  );
  return holding ?? { start, end };
};

const BUNDLER_DIRECTIVE = /^@vite-ignore\b/;

const kindOf = (source: string, block: Block, cut: Cut): Kind => {
  if (isExempt(block[0]) || BUNDLER_DIRECTIVE.test(proseOf(block[0]))) return "directive";
  if (source.slice(lineStartOf(source, cut.start), cut.start).trim() !== "") return "trailing";
  return block[0].type === "Line" ? "line" : "doc";
};

const keyName = (key: PropertyKey): string | undefined => {
  if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
  return key.type === "Literal" && typeof key.value === "string" ? key.value : undefined;
};

const bindingName = ({ declarations: [first] }: VariableDeclaration): string | undefined =>
  first?.id.type === "Identifier" ? first.id.name : undefined;

const declaredAt = (program: Program): ReadonlyMap<number, string> => {
  const names = new Map<number, string>();
  const exported: (readonly [number, number])[] = [];
  const name = (at: Cut, value: string | undefined): void => {
    if (value !== undefined) names.set(at.start, value);
  };
  const byId = (node: Cut & { readonly id: { readonly name: string } | null }): void => {
    name(node, node.id?.name);
  };
  const byKey = (node: Cut & { readonly key: PropertyKey }): void => {
    name(node, keyName(node.key));
  };
  new Visitor({
    ExportNamedDeclaration: (node) => {
      if (node.declaration !== null) exported.push([node.start, node.declaration.start]);
    },
    ExportDefaultDeclaration: (node) => name(node, "default"),
    FunctionDeclaration: byId,
    ClassDeclaration: byId,
    TSTypeAliasDeclaration: byId,
    TSInterfaceDeclaration: byId,
    TSEnumDeclaration: byId,
    VariableDeclaration: (node) => name(node, bindingName(node)),
    MethodDefinition: byKey,
    PropertyDefinition: byKey,
    TSPropertySignature: byKey,
    TSMethodSignature: byKey,
    Property: byKey,
  }).visit(program);
  for (const [at, inner] of exported) name({ start: at, end: at }, names.get(inner));
  return names;
};

const attachedTo = (source: string, cut: Cut, declared: ReadonlyMap<number, string>): string => {
  const gap = /^[ \t]*(?:\r?\n)?[ \t]*/.exec(source.slice(cut.end))?.[0].length ?? 0;
  return declared.get(cut.end + gap) ?? "";
};

const wordsIn = (prose: string): number => prose.match(/\S+/g)?.length ?? 0;

const foundIn = (file: string, source: string): readonly Found[] => {
  const { program, comments, lineOf } = parsedSource(file, source);
  const all = comments.map((comment) => grouped(source, lineOf, comment));
  const blocks = [
    ...all.filter(isExempt).map((comment): Block => [comment]),
    ...blocksIn(source, all),
  ].sort((left, right) => left[0].start - right[0].start);
  const containers = emptyContainersIn(program);
  const declared = declaredAt(program);
  return blocks.map((block) => {
    const cut = cutOf(source, block, containers);
    const kind = kindOf(source, block, cut);
    const row: Row = {
      path: file,
      start: lineOf(block[0].start),
      end: lineOf(lastOf(block).end),
      kind,
      attached: kind === "trailing" ? "" : attachedTo(source, cut, declared),
      words: wordsIn(block.map(proseOf).join("\n")),
      text: source.slice(block[0].start, lastOf(block).end),
      class: "",
      holder: "",
      structure: "",
      unit: "",
    };
    return { row, cut };
  });
};

const GENERATED = "// Generated, never edited";

const SOURCE_FILE = /\.[cm]?tsx?$/;

const sourceFilesUnder = (root: string, paths: readonly string[]): readonly string[] =>
  [
    ...new Set(
      paths.flatMap((one) =>
        statSync(path.resolve(root, one)).isDirectory()
          ? filesUnderEach(root, [one])
          : [path.normalize(one)],
      ),
    ),
  ]
    .filter((file) => SOURCE_FILE.test(file) && !file.split(path.sep).includes("skills"))
    .sort(byCodeUnit);

const sourceAt = (root: string, file: string): string | undefined => {
  const at = path.resolve(root, file);
  return existsSync(at) && statSync(at).isFile() ? readFileSync(at, "utf8") : undefined;
};

const HOLDER = /^(?<file>.+?) › (?<text>.+)$/;

const timesIn = (source: string, text: string): number => {
  let times = 0;
  for (let found = source.indexOf(text); found !== -1; found = source.indexOf(text, found + 1)) {
    times += 1;
  }
  return times;
};

type Survivor = (file: string) => string | undefined;

const survivorOf = (root: string, rows: readonly Row[]): Survivor => {
  const doomed = Map.groupBy(
    rows.filter((row) => !KEPT.has(row.class)),
    (row) => row.path,
  );
  return (file) =>
    (doomed.get(file) ?? []).reduce<string | undefined>(
      (source, row) => source?.split(row.text).join(""),
      sourceAt(root, file),
    );
};

const holderRefusal = (survivor: Survivor, holder: string): string | undefined => {
  const named = HOLDER.exec(holder)?.groups;
  if (named === undefined) {
    return `holder \`${holder}\` is not path › text: anchor it on text its file holds once, not a line number`;
  }
  const source = survivor(String(named["file"]));
  if (source === undefined) return `holder \`${holder}\` names no file`;
  const times = timesIn(source, String(named["text"]));
  return times === 1 ? undefined : `holder \`${holder}\`: the file holds this text ${times} times`;
};

const at = (row: Row): string => `${row.path}:${row.start}`;

const rowRefusals = (survivor: Survivor, row: Row): readonly string[] => {
  if (row.class === "") return [`${at(row)}: unclassified, so nothing says its reason may go`];
  if (row.class === "open") {
    return TRACKER_ISSUE.test(row.holder)
      ? []
      : [`${at(row)}: an open row's holder is the tracker issue its reason went to, as BA-196`];
  }
  if (!NEEDS_A_HOLDER.has(row.class)) return [];
  const holders = row.holder.split("; ").filter((one) => one !== "");
  if (holders.length === 0) return [`${at(row)}: a ${row.class} row names no holder`];
  return holders.flatMap((holder) => {
    const refused = holderRefusal(survivor, holder);
    return refused === undefined ? [] : [`${at(row)}: ${refused}`];
  });
};

type Planned = { readonly file: string; readonly source: string; readonly cuts: readonly Found[] };

const located = (
  file: string,
  source: string | undefined,
  rows: readonly Row[],
): Outcome<Planned> => {
  if (source === undefined) return { refused: rows.map((row) => `${at(row)}: no such file`) };
  const found = foundIn(file, source);
  const cuts: Found[] = [];
  const refused: string[] = [];
  for (const same of Map.groupBy(rows, (row) => `${row.kind}\n${row.text}`).values()) {
    const matches = found.filter(
      (one) => one.row.kind === same[0]?.kind && one.row.text === same[0].text,
    );
    if (matches.length === same.length) cuts.push(...matches);
    else {
      refused.push(
        ...same.map(
          (row) =>
            `${at(row)}: the file holds this block ${matches.length} times and the unit deletes it ${same.length}`,
        ),
      );
    }
  }
  return refused.length > 0 ? { refused } : { value: { file, source, cuts } };
};

const planFor = (root: string, rows: readonly Row[], unit: string): Outcome<readonly Planned[]> => {
  const named = rows.filter((row) => row.unit === unit);
  if (named.length === 0) return { refused: [`no row names unit ${unit}`] };
  const deleted = named.filter((row) => !KEPT.has(row.class));
  const byFile = [...Map.groupBy(deleted, (row) => row.path)].sort(([left], [right]) =>
    byCodeUnit(left, right),
  );
  const planned = byFile.map(([file, same]) => located(file, sourceAt(root, file), same));
  const survivor = survivorOf(root, rows);
  const refused = [
    ...deleted.flatMap((row) => rowRefusals(survivor, row)),
    ...planned.flatMap((one) => ("refused" in one ? one.refused : [])),
  ];
  if (refused.length > 0) return { refused };
  return { value: planned.flatMap((one) => ("value" in one ? [one.value] : [])) };
};

const OPENS = /[{[(]\s*$/;

const CLOSES = /^\s*[}\])]/;

const lastLineOf = (head: string): string =>
  head.slice(head.lastIndexOf("\n", head.length - 2) + 1, -1);

const firstLineOf = (tail: string): string => tail.split("\n", 1)[0] ?? "";

const isBlank = (line: string | undefined): line is string => line?.trim() === "";

const opensOrEdge = (line: string | undefined): boolean =>
  line === undefined || isBlank(line) || OPENS.test(line);

const closesOrEdge = (line: string | undefined): boolean => line === undefined || CLOSES.test(line);

const joined = (head: string, tail: string): string => {
  const previous = head === "" ? undefined : lastLineOf(head);
  const next = tail === "" ? undefined : firstLineOf(tail);
  if (isBlank(next) && opensOrEdge(previous)) return head + tail.slice(next.length + 1);
  if (isBlank(previous) && closesOrEdge(next)) {
    return head.slice(0, head.length - previous.length - 1) + tail;
  }
  return head + tail;
};

const withoutCut = (source: string, { start, end }: Cut): string => {
  const lineStart = lineStartOf(source, start);
  const newline = source.indexOf("\n", end);
  const lineEnd = newline === -1 ? source.length : newline;
  if (source.slice(lineStart, start).trim() !== "") {
    return source.slice(0, start).replace(/[ \t]+$/, "") + source.slice(end);
  }
  if (source.slice(end, lineEnd).trim() !== "") {
    return source.slice(0, start) + source.slice(end).replace(/^[ \t]+/, "");
  }
  return joined(source.slice(0, lineStart), source.slice(lineEnd + 1));
};

const withCuts = ({ source, cuts }: Planned): string =>
  [...cuts]
    .sort((left, right) => right.cut.start - left.cut.start)
    .reduce((text, { cut }) => withoutCut(text, cut), source);

const linesOf = ({ row }: Found): string =>
  row.start === row.end ? String(row.start) : `${row.start}-${row.end}`;

const reportOf = (verb: string, { file, cuts }: Planned): string =>
  `${file}: ${verb} ${cuts.length} block${cuts.length === 1 ? "" : "s"}, lines ${cuts.map(linesOf).join(", ")}`;

const USAGE =
  "usage: comment-inventory inventory <path>... | apply <tsv> --unit <unit> | check <tsv> [--unit <unit>]";

const refuse = (lines: readonly string[], status: number): number => {
  for (const line of lines) process.stderr.write(`${line}\n`);
  return status;
};

const inventory = (root: string, paths: readonly string[]): number => {
  if (paths.length === 0) return refuse([USAGE], 2);
  const rows = sourceFilesUnder(root, paths).flatMap((file) => {
    const source = readFileSync(path.resolve(root, file), "utf8");
    return source.startsWith(GENERATED) ? [] : foundIn(file, source).map(({ row }) => row);
  });
  process.stdout.write(tsvOf(rows));
  return 0;
};

type Request = { readonly rows: readonly Row[]; readonly unit: string | undefined };

const requestOf = (root: string, argv: readonly string[]): Outcome<Request> => {
  const [tsv, ...rest] = argv;
  const flags = flagValues(rest);
  if (tsv === undefined || flags === undefined || [...flags.keys()].some((key) => key !== "unit")) {
    return { refused: [USAGE] };
  }
  const source = sourceAt(root, tsv);
  if (source === undefined) return { refused: [`${tsv}: no such file`] };
  const rows = rowsIn(source);
  return "refused" in rows
    ? { refused: rows.refused.map((line) => `${tsv}: ${line}`) }
    : { value: { rows: rows.value, unit: flags.get("unit") } };
};

const apply = (root: string, argv: readonly string[]): number => {
  const request = requestOf(root, argv);
  if ("refused" in request) return refuse(request.refused, 2);
  const { rows, unit } = request.value;
  if (unit === undefined) return refuse([USAGE], 2);
  const plan = planFor(root, rows, unit);
  if ("refused" in plan)
    return refuse([`unit ${unit} refused, no file changed:`, ...plan.refused], 1);
  for (const one of plan.value) {
    writeFileSync(path.resolve(root, one.file), withCuts(one));
    process.stdout.write(`${reportOf("deleted", one)}\n`);
  }
  return 0;
};

const check = (root: string, argv: readonly string[]): number => {
  const request = requestOf(root, argv);
  if ("refused" in request) return refuse(request.refused, 2);
  const { rows, unit } = request.value;
  const units = unit === undefined ? [...new Set(rows.map((row) => row.unit))] : [unit];
  const refused = units
    .filter((one) => one !== "")
    .sort(byCodeUnit)
    .flatMap((one) => {
      const plan = planFor(root, rows, one);
      if ("refused" in plan) return plan.refused.map((line) => `unit ${one}: ${line}`);
      for (const file of plan.value) {
        process.stdout.write(`unit ${one}: ${reportOf("would delete", file)}\n`);
      }
      return [];
    });
  return refused.length > 0 ? refuse(refused, 1) : 0;
};

const COMMANDS = new Map([
  ["inventory", inventory],
  ["apply", apply],
  ["check", check],
]);

export const commentInventory = (argv: readonly string[]): number => {
  const [name = "", ...rest] = argv;
  const command = COMMANDS.get(name);
  if (command === undefined) return refuse([USAGE], 2);
  try {
    return command(process.cwd(), rest);
  } catch (cause) {
    return refuse([cause instanceof Error ? cause.message : String(cause)], 2);
  }
};
