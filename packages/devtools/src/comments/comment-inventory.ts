import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import { flagValues } from "../flags.ts";
import {
  sourceAt,
  languageOf,
  lineStartOf,
  sourceFilesUnder,
  LANGUAGES,
  type Found,
  type Cut,
  type Language,
} from "./comment-finding.ts";
import {
  KEPT,
  TRACKER_ISSUE,
  NEEDS_A_HOLDER,
  tsvOf,
  rowsIn,
  type Row,
  type Outcome,
} from "./comment-rows.ts";

const HOLDER = /^(?<file>.+?) › (?<text>.+)$/u;

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
  const language = languageOf(file);
  if (language === undefined) {
    return { refused: rows.map((row) => `${at(row)}: neither TypeScript nor Python`) };
  }
  const found = language.foundIn(file, source);
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

const OPENS = /[{[(:]\s*$/u;

const CLOSES = /^\s*[}\])]/u;

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

const withoutCut = (source: string, { start, end, replacement }: Cut): string => {
  if (replacement !== "") return source.slice(0, start) + replacement + source.slice(end);
  const lineStart = lineStartOf(source, start);
  const newline = source.indexOf("\n", end);
  const lineEnd = newline === -1 ? source.length : newline + 1;
  const before = source.slice(lineStart, start);
  const after = source.slice(end, lineEnd);
  if (`${before}${after}`.trim() === "") {
    return joined(source.slice(0, lineStart), source.slice(lineEnd));
  }
  return after.trim() === ""
    ? source.slice(0, lineStart) + before.trimEnd() + source.slice(end)
    : source.slice(0, start) + source.slice(end);
};

const BOM = "\uFEFF";

/** String.prototype.trim takes U+FEFF for white space, so a byte order mark waits outside the cuts. */
const withCuts = ({ source, cuts }: Planned): string => {
  const mark = source.startsWith(BOM) ? BOM.length : 0;
  const rest = [...cuts]
    .sort((left, right) => right.cut.start - left.cut.start)
    .reduce(
      (text, one) =>
        withoutCut(text, { ...one.cut, start: one.cut.start - mark, end: one.cut.end - mark }),
      source.slice(mark),
    );
  return source.slice(0, mark) + rest;
};

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
  const rows = sourceFilesUnder(root, paths).flatMap(({ file, language }) => {
    const source = readFileSync(path.resolve(root, file), "utf8");
    if (source.startsWith(language.generated)) return [];
    return language.foundIn(file, source).map(({ row }) => row);
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

const formatFailure = (
  root: string,
  { formatter, formatterCommand }: Language,
  files: readonly string[],
): string | undefined => {
  try {
    const [command, ...argv] = formatterCommand();
    const ran = spawnSync(command, [...argv, "--", ...files], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
    });
    if (ran.error !== undefined) return `${formatter}: ${ran.error.message}`;
    return ran.status === 0 ? undefined : `${formatter}: ${ran.stderr}`;
  } catch (cause) {
    return `${formatter}: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
};

const formatFailures = (root: string, files: readonly string[]): readonly string[] => {
  const byLanguage = Map.groupBy(files, languageOf);
  return LANGUAGES.flatMap((language) => {
    const own = byLanguage.get(language);
    const failed = own === undefined ? undefined : formatFailure(root, language, own);
    return failed === undefined ? [] : [failed];
  });
};

const apply = (root: string, argv: readonly string[]): number => {
  const request = requestOf(root, argv);
  if ("refused" in request) return refuse(request.refused, 2);
  const { rows, unit } = request.value;
  if (unit === undefined) return refuse([USAGE], 2);
  const plan = planFor(root, rows, unit);
  if ("refused" in plan)
    return refuse([`unit ${unit} refused, no file changed:`, ...plan.refused], 1);
  for (const one of plan.value) writeFileSync(path.resolve(root, one.file), withCuts(one));
  const failed = formatFailures(
    root,
    plan.value.map(({ file }) => file),
  );
  if (failed.length > 0) {
    for (const one of plan.value) writeFileSync(path.resolve(root, one.file), one.source);
    return refuse([`unit ${unit}: the formatter failed, so no file changed:`, ...failed], 2);
  }
  for (const one of plan.value) process.stdout.write(`${reportOf("deleted", one)}\n`);
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
