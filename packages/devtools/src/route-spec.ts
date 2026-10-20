import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { markdownUnder } from "./paths.ts";

export type Violation = {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly found: string;
  readonly fix: string;
};

type Context = {
  readonly root: string;
  readonly decisions: ReadonlySet<string>;
  readonly glossary: ReadonlySet<string>;
};

type Line = {
  readonly file: string;
  readonly number: number;
  readonly text: string;
  readonly prose: string;
};

type Judged<Answer> = (found: string, context: Context, file: string) => Answer;

type Rule = {
  readonly rule: string;
  readonly pattern: RegExp;
  readonly eachMatch?: true;
  readonly fix: string | Judged<string>;
  readonly holds?: Judged<boolean>;
  readonly onlyOn?: RegExp;
  readonly exempt?: RegExp;
  readonly readsLinkTargets?: true;
};

type Status = (typeof STATUSES)[number];

type Strand = (typeof STRANDS)[number];

type Row = { readonly line: number; readonly cells: readonly string[] };

type CellsOf<Columns extends readonly string[]> = { readonly [Index in keyof Columns]: string };

type Cells = CellsOf<typeof COLUMNS>;

type Table = {
  readonly header: Row;
  readonly rows: readonly Row[];
  readonly strays: readonly { readonly line: number; readonly text: string }[];
};

type Block = { readonly id: string; readonly target?: string };

type BlockLine = { readonly line: number; readonly id: string };

type Parsed = {
  readonly line: number;
  readonly block: Block;
  readonly strand: Strand;
  readonly waitsOn: readonly string[];
  readonly status: Status;
  readonly next: boolean;
  readonly plan: string;
};

type RowParse = Parsed | Violation;

type TableContext = {
  readonly file: string;
  readonly briefs: ReadonlySet<string>;
  readonly blocks: readonly BlockLine[];
  readonly ids: ReadonlySet<string>;
  readonly rows: readonly Parsed[];
};

type RowCheck = (row: Parsed, table: TableContext) => readonly Violation[];

type TableCheck = (table: TableContext) => readonly Violation[];

const ROUTE_FOLDER = "docs/specs";

const INDEX = "docs/specs/v01-route.md";

const BRIEFS_FOLDER = "docs/specs/route";

const NOT_A_BRIEF = "seams.md";

const DECISIONS_FOLDER = "docs/solutions/architecture-patterns";

const GLOSSARY = "CONCEPTS.md";

const INDEX_CAP_WORDS = 1500;

const BRIEF_CAP_WORDS = 600;

const LEAVES_THE_CLONE = "the path leaves the clone; cite a file inside it by a relative path";

const MACHINE_LOCAL = /\.(?:scratch|planning)\//;

const LINK_TARGET = /\]\([^)]*\)/g;

const DECISION_FILE = /^adr-(?<number>\d{4})-/;

const HEADING = /^### (?<word>.+)$/gm;

const RULES: readonly Rule[] = [
  {
    rule: "ordna id",
    pattern: /\bT-\d{3}\b/,
    fix: "the ordna tracker is retired; cite the Linear issue, the pull request or the commit, or drop the claim",
  },
  {
    rule: "ordna ticket",
    pattern: /\b(?:[Tt]ickets?|briefings?|research) \d{2}\b/,
    fix: "the ordna map is gone; cite a tracked file or drop the claim",
  },
  {
    rule: "machine-local path",
    pattern: MACHINE_LOCAL,
    fix: "a clone cannot open it; cite a tracked file or drop the claim",
    readsLinkTargets: true,
  },
  { rule: "em dash", pattern: /—/, fix: "end the sentence or use a comma" },
  { rule: "strikethrough", pattern: /~~/, fix: "say what is true now; git keeps the history" },
  {
    rule: "date",
    pattern:
      /\b20\d{2}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/,
    fix: "the route holds no date; a reading goes to docs/operations/readings.md and a deadline to Linear",
    exempt: /`[^`\n]*`/g,
  },
  {
    rule: "retired workflow",
    pattern:
      /\bgrill|\/ce-|\/to-spec|\/to-tickets|Compound Engineering|\bordna\b|\bWayfinder\b|\(map \d|gate §|\bthe handoff\b/,
    fix: "say it in the words of docs/agents/workflow.md",
  },
  {
    rule: "unknown decision",
    pattern: /\bADR \d{4}\b/,
    eachMatch: true,
    holds: (cite, context) => context.decisions.has(cite),
    fix: (cite) => `no ${cite.replace("ADR ", "adr-")}-*.md under ${DECISIONS_FOLDER}`,
  },
  {
    rule: "dead link",
    pattern: /\]\((?<found>[^)\s#]+)(?:#[^)]*)?\)/,
    eachMatch: true,
    readsLinkTargets: true,
    holds: (target, context, file) =>
      /^[a-z]+:/i.test(target) ||
      MACHINE_LOCAL.test(target) ||
      heldInside(context.root, path.dirname(file), target),
    fix: (target, context, file) =>
      leavesTheClone(context.root, path.dirname(file), target)
        ? LEAVES_THE_CLONE
        : "link a file the clone holds",
  },
  {
    rule: "missing path",
    pattern:
      /`(?<found>(?:docs|apps|packages|contracts|deploy|scripts|\.agents|\.claude|\.github)\/[^`\s<>]+)`/,
    eachMatch: true,
    holds: (target, context) => heldInside(context.root, ".", target),
    fix: (target, context) =>
      leavesTheClone(context.root, ".", target) ? LEAVES_THE_CLONE : "name a path the clone holds",
  },
  {
    rule: "unknown word",
    pattern: /(?<!\*)\*(?<found>[^*\n]+?)\*(?!\*)/,
    eachMatch: true,
    onlyOn: /^(?:\*\*)?Words\b/,
    holds: (word, context) => context.glossary.has(word),
    fix: (word) => `no \`### ${word}\` heading in ${GLOSSARY}`,
  },
];

const COLUMNS = ["Block", "Strand", "Delivers", "Blocked by", "Status", "Next", "Plan"] as const;

const STATUSES = ["unplanned", "planned", "building", "done", "reserve"] as const;

const LIVE: ReadonlySet<Status> = new Set(STATUSES.filter((status) => status !== "done"));

const MAY_CARRY_NEXT: ReadonlySet<Status> = new Set(["unplanned", "planned"]);

const STRANDS = ["knowledge", "records", "people", "ops", "customer"] as const;

const NEXT_CELL: ReadonlyMap<string, boolean> = new Map([
  ["next", true],
  ["", false],
]);

const NO_BLOCKER: ReadonlySet<string> = new Set(["none", "trigger"]);

const BLOCK_ID = String.raw`[A-Z]\d[ab]?`;

const BLOCK_CELL = new RegExp(
  String.raw`^(?:\[(?<linked>${BLOCK_ID})\]\((?<target>[^)]+)\)|(?<bare>${BLOCK_ID}))$`,
);

const BLOCKER = new RegExp(String.raw`^(?<id>${BLOCK_ID})(?: \([^()]+\))?$`);

const BETWEEN_BLOCKERS = /, (?![^()]*\))/;

const violation = (
  file: string,
  line: number,
  rule: string,
  found: string,
  fix: string,
): Violation => ({ file, line, rule, found, fix });

const decisionCites = (root: string): ReadonlySet<string> =>
  new Set(
    readdirSync(path.join(root, DECISIONS_FOLDER)).flatMap((file) => {
      const number = DECISION_FILE.exec(file)?.groups?.["number"];
      return number === undefined ? [] : [`ADR ${number}`];
    }),
  );

const glossaryWords = (root: string): ReadonlySet<string> =>
  new Set(
    [...readFileSync(path.join(root, GLOSSARY), "utf8").matchAll(HEADING)].map(
      (match) => match.groups?.["word"] ?? "",
    ),
  );

const contextOf = (root: string): Context => ({
  root,
  decisions: decisionCites(root),
  glossary: glossaryWords(root),
});

const leavesTheClone = (root: string, from: string, target: string): boolean =>
  path.isAbsolute(target) ||
  path.relative(root, path.resolve(root, from, target)).split(path.sep)[0] === "..";

const heldInside = (root: string, from: string, target: string): boolean =>
  !leavesTheClone(root, from, target) && existsSync(path.resolve(root, from, target));

const subjectOf = (line: Line, rule: Rule): string => {
  const subject = rule.readsLinkTargets === true ? line.text : line.prose;
  return rule.exempt === undefined ? subject : subject.replace(rule.exempt, "``");
};

const matchesOf = (subject: string, rule: Rule): readonly RegExpMatchArray[] => {
  const matches = [...subject.matchAll(new RegExp(rule.pattern, `${rule.pattern.flags}g`))];
  return rule.eachMatch === true ? matches : matches.slice(0, 1);
};

const violationsOn = (line: Line, context: Context, rule: Rule): readonly Violation[] => {
  if (rule.onlyOn?.test(line.text) === false) return [];
  return matchesOf(subjectOf(line, rule), rule).flatMap((match) => {
    const found = match.groups?.["found"] ?? match[0];
    if (rule.holds?.(found, context, line.file) === true) return [];
    const fix = typeof rule.fix === "string" ? rule.fix : rule.fix(found, context, line.file);
    return [violation(line.file, line.number, rule.rule, found, fix)];
  });
};

const violationsIn = (file: string, source: string, context: Context): readonly Violation[] =>
  source.split("\n").flatMap((text, index) => {
    const line = { file, number: index + 1, text, prose: text.replace(LINK_TARGET, "]()") };
    return RULES.flatMap((rule) => violationsOn(line, context, rule));
  });

const cellsOf = (text: string): readonly string[] =>
  text
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

const isSeparator = (cells: readonly string[]): boolean =>
  cells.every((cell) => /^:?-+:?$/.test(cell));

const tableOf = (source: string): Table | undefined => {
  const lines = source.split("\n");
  const start = lines.findIndex((text) => text.trim().startsWith(`| ${COLUMNS[0]} |`));
  if (start === -1) return undefined;
  const end = lines.findIndex((text, index) => index > start && text.trim() === "");
  const body = lines
    .slice(start + 1, end === -1 ? lines.length : end)
    .map((text, offset) => ({ line: start + 2 + offset, text: text.trim() }));
  return {
    header: { line: start + 1, cells: cellsOf(lines[start] ?? "") },
    rows: body
      .filter((row) => row.text.startsWith("|"))
      .map((row) => ({ line: row.line, cells: cellsOf(row.text) }))
      .filter((row) => !isSeparator(row.cells)),
    strays: body.filter((row) => !row.text.startsWith("|")),
  };
};

const sameColumns = (cells: readonly string[]): boolean =>
  cells.length === COLUMNS.length && COLUMNS.every((column, index) => cells[index] === column);

const hasColumns = (cells: readonly string[]): cells is Cells => cells.length === COLUMNS.length;

const blockOf = (cell: string): Block | undefined => {
  const match = BLOCK_CELL.exec(cell)?.groups;
  if (match === undefined) return undefined;
  const linked = match["linked"];
  const target = match["target"];
  if (linked !== undefined && target !== undefined) return { id: linked, target };
  const bare = match["bare"];
  return bare === undefined ? undefined : { id: bare };
};

const wordOf = <Word extends string>(words: readonly Word[], cell: string): Word | undefined =>
  words.find((word) => word === cell);

const blockersOf = (cell: string): readonly string[] | undefined => {
  if (NO_BLOCKER.has(cell)) return [];
  const ids = cell.split(BETWEEN_BLOCKERS).map((entry) => BLOCKER.exec(entry)?.groups?.["id"]);
  return ids.every((id) => id !== undefined) ? ids : undefined;
};

const parseRow = (file: string, row: Row): RowParse => {
  const { line, cells } = row;
  if (!hasColumns(cells)) {
    const fix = `a row has ${COLUMNS.length} cells`;
    return violation(file, line, "table shape", cells.join(" | "), fix);
  }
  const [blockCell, strandCell, , blockedByCell, statusCell, nextCell, plan] = cells;
  const block = blockOf(blockCell);
  if (block === undefined) {
    return violation(
      file,
      line,
      "table shape",
      blockCell,
      "a Block cell is an id, linked while live",
    );
  }
  const strand = wordOf(STRANDS, strandCell);
  if (strand === undefined) {
    return violation(file, line, "strand", strandCell, `one of ${STRANDS.join(", ")}`);
  }
  const waitsOn = blockersOf(blockedByCell);
  if (waitsOn === undefined) {
    const fix = "`none`, `trigger`, or ids joined by `, `, each optionally followed by (words)";
    return violation(file, line, "table shape", blockedByCell, fix);
  }
  const status = wordOf(STATUSES, statusCell);
  if (status === undefined) {
    return violation(file, line, "status word", statusCell, `one of ${STATUSES.join(", ")}`);
  }
  const next = NEXT_CELL.get(nextCell);
  if (next === undefined) return violation(file, line, "next marker", nextCell, "`next` or empty");
  return { line, block, strand, waitsOn, status, next, plan };
};

const isParsed = (parse: RowParse): parse is Parsed => "block" in parse;

const isViolation = (parse: RowParse): parse is Violation => !isParsed(parse);

const blockLinesIn = (rows: readonly Row[]): readonly BlockLine[] =>
  rows.flatMap((row) => {
    const block = blockOf(row.cells[0] ?? "");
    return block === undefined ? [] : [{ line: row.line, id: block.id }];
  });

const briefOf = (id: string): string => `${id.toLowerCase()}.md`;

const nextPlacementCheck: RowCheck = (row, table) =>
  row.next && !MAY_CARRY_NEXT.has(row.status)
    ? [violation(table.file, row.line, "next marker", row.block.id, `never on a ${row.status} row`)]
    : [];

const blockersCheck: RowCheck = (row, table) =>
  row.waitsOn
    .filter((id) => !table.ids.has(id))
    .map((id) =>
      violation(table.file, row.line, "unknown block", id, "every Blocked by id is a row"),
    );

const selfBlockCheck: RowCheck = (row, table) =>
  row.waitsOn.includes(row.block.id)
    ? [
        violation(
          table.file,
          row.line,
          "blocked by itself",
          row.block.id,
          "a row never waits on itself",
        ),
      ]
    : [];

const briefCheck: RowCheck = (row, table) => {
  const brief = briefOf(row.block.id);
  const linked = row.block.target === `route/${brief}` && table.briefs.has(brief);
  const fix = `a live row links \`route/${brief}\`, and the file exists`;
  return LIVE.has(row.status) && !linked
    ? [violation(table.file, row.line, "row without brief", row.block.id, fix)]
    : [];
};

const planCheck: RowCheck = (row, table) =>
  row.status === "planned" && row.plan === ""
    ? [
        violation(
          table.file,
          row.line,
          "row without plan",
          row.block.id,
          "a planned row links its plan in the Plan cell",
        ),
      ]
    : [];

const ROW_CHECKS: readonly RowCheck[] = [
  nextPlacementCheck,
  blockersCheck,
  selfBlockCheck,
  briefCheck,
  planCheck,
];

const duplicateBlocks: TableCheck = (table) =>
  table.blocks
    .filter((block, index) => table.blocks.findIndex((other) => other.id === block.id) < index)
    .map((block) =>
      violation(table.file, block.line, "table shape", block.id, "one row per Block id"),
    );

const nextTwiceOnAStrand: TableCheck = (table) =>
  [
    ...Map.groupBy(
      table.rows.filter((row) => row.next),
      (row) => row.strand,
    ).values(),
  ].flatMap(([first, ...later]) =>
    first === undefined
      ? []
      : later.map((row) => {
          const fix = `the ${row.strand} strand already marks line ${String(first.line)}`;
          return violation(table.file, row.line, "next marker", row.block.id, fix);
        }),
  );

const orphanBriefs: TableCheck = (table) => {
  const done = new Set(table.rows.filter((row) => !LIVE.has(row.status)).map((row) => row.line));
  const live = new Set(
    table.blocks.filter((block) => !done.has(block.line)).map((block) => briefOf(block.id)),
  );
  const fix = `every brief under ${BRIEFS_FOLDER}/ has a live row, so a done block's brief leaves the folder`;
  return [...table.briefs]
    .filter((brief) => !live.has(brief))
    .map((brief) => violation(table.file, 1, "brief without row", brief, fix));
};

const TABLE_CHECKS: readonly TableCheck[] = [duplicateBlocks, nextTwiceOnAStrand, orphanBriefs];

const tableViolationsIn = (
  file: string,
  source: string,
  briefs: ReadonlySet<string>,
): readonly Violation[] => {
  const table = tableOf(source);
  if (table === undefined) {
    const fix = `a table whose header is | ${COLUMNS.join(" | ")} |`;
    return [violation(file, 1, "table shape", "no status table", fix)];
  }
  const { header } = table;
  if (!sameColumns(header.cells)) {
    const fix = `the columns are ${COLUMNS.join(", ")}`;
    return [violation(file, header.line, "table shape", header.cells.join(" | "), fix)];
  }
  const parses = table.rows.map((row) => parseRow(file, row));
  const rows = parses.filter(isParsed);
  const blocks = blockLinesIn(table.rows);
  const ids = new Set(blocks.map((block) => block.id));
  const context: TableContext = { file, briefs, blocks, ids, rows };
  const strayFix = "the table ends at a blank line, and every line before it is a row";
  return [
    ...table.strays.map((stray) =>
      violation(file, stray.line, "table shape", stray.text, strayFix),
    ),
    ...parses.filter(isViolation),
    ...rows.flatMap((row) => ROW_CHECKS.flatMap((check) => check(row, context))),
    ...TABLE_CHECKS.flatMap((check) => check(context)),
  ];
};

const wordCount = (source: string): number =>
  source.split(/\s+/).filter((word) => word !== "").length;

const capViolationsIn = (file: string, source: string, cap: number): readonly Violation[] => {
  const words = wordCount(source);
  return words > cap
    ? [violation(file, 1, "over cap", String(words), `at most ${String(cap)} words`)]
    : [];
};

const isBrief = (file: string): boolean =>
  path.posix.dirname(file) === BRIEFS_FOLDER && path.posix.basename(file) !== NOT_A_BRIEF;

export const violationsUnder = (root: string): readonly Violation[] => {
  const context = contextOf(root);
  const sources = new Map(
    markdownUnder(root, ROUTE_FOLDER).map((file) => [
      file,
      readFileSync(path.join(root, file), "utf8"),
    ]),
  );
  const briefs = [...sources].filter(([file]) => isBrief(file));
  const index = sources.get(INDEX) ?? "";
  const briefNames = new Set(briefs.map(([file]) => path.posix.basename(file)));
  return [
    ...[...sources].flatMap(([file, source]) => violationsIn(file, source, context)),
    ...tableViolationsIn(INDEX, index, briefNames),
    ...capViolationsIn(INDEX, index, INDEX_CAP_WORDS),
    ...briefs.flatMap(([file, source]) => capViolationsIn(file, source, BRIEF_CAP_WORDS)),
  ];
};

export const reportOf = (violation: Violation): string =>
  `${violation.file}:${String(violation.line)}: ${violation.rule} \`${violation.found}\`: ${violation.fix}`;
