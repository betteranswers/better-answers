import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { byCodeUnit } from "@better-answers/schema/code-unit";

const ROUTE_FOLDER = "docs/specs";

const DECISIONS_FOLDER = "docs/solutions/architecture-patterns";

const GLOSSARY = "CONCEPTS.md";

export type Finding = {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly found: string;
  readonly fix: string;
};

type Banned = {
  readonly rule: string;
  readonly pattern: RegExp;
  readonly fix: string;
  readonly exempt?: RegExp;
};

const BANNED: readonly Banned[] = [
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
    pattern: /\.(?:scratch|planning)\//,
    fix: "a clone cannot open it; cite a tracked file or drop the claim",
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
];

const DECISION = /\bADR (?<number>\d{4})\b/g;

const DECISION_FILE = /^adr-(?<number>\d{4})-/;

const LINK = /\]\((?<target>[^)\s#]+)(?:#[^)]*)?\)/g;

const TRACKED_PATH =
  /`(?<target>(?:docs|apps|packages|contracts|deploy|scripts|\.agents|\.claude|\.github)\/[^`\s<>]+)`/g;

const WORDS_LINE = /^(?:\*\*)?Words\b/;

const ITALIC = /(?<!\*)\*(?<word>[^*\n]+?)\*(?!\*)/g;

const HEADING = /^### (?<word>.+)$/gm;

export type Context = {
  readonly root: string;
  readonly decisions: ReadonlySet<string>;
  readonly glossary: ReadonlySet<string>;
};

export const routeFiles = (root: string): readonly string[] =>
  readdirSync(path.join(root, ROUTE_FOLDER), { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => path.posix.join(ROUTE_FOLDER, entry.split(path.sep).join("/")))
    .sort(byCodeUnit);

const decisionNumbers = (root: string): ReadonlySet<string> =>
  new Set(
    readdirSync(path.join(root, DECISIONS_FOLDER)).flatMap((file) => {
      const number = DECISION_FILE.exec(file)?.groups?.["number"];
      return number === undefined ? [] : [number];
    }),
  );

const glossaryWords = (root: string): ReadonlySet<string> =>
  new Set(
    [...readFileSync(path.join(root, GLOSSARY), "utf8").matchAll(HEADING)].map(
      (match) => match.groups?.["word"] ?? "",
    ),
  );

export const contextOf = (root: string): Context => ({
  root,
  decisions: decisionNumbers(root),
  glossary: glossaryWords(root),
});

const LINK_TARGET = /\]\([^)]*\)/g;

const bannedIn = (file: string, line: number, text: string): readonly Finding[] =>
  BANNED.flatMap((banned) => {
    const prose = text.replace(LINK_TARGET, "]()");
    const found = banned.pattern.exec(
      banned.exempt === undefined ? prose : prose.replace(banned.exempt, "``"),
    );
    return found === null
      ? []
      : [{ file, line, rule: banned.rule, found: found[0], fix: banned.fix }];
  });

const unknownDecisionsIn = (
  file: string,
  line: number,
  text: string,
  decisions: ReadonlySet<string>,
): readonly Finding[] =>
  [...text.matchAll(DECISION)].flatMap((match) => {
    const number = match.groups?.["number"] ?? "";
    return decisions.has(number)
      ? []
      : [
          {
            file,
            line,
            rule: "unknown decision",
            found: match[0],
            fix: `no adr-${number}-*.md under ${DECISIONS_FOLDER}`,
          },
        ];
  });

const isLocal = (target: string): boolean => !/^[a-z]+:/i.test(target);

const resolvesFrom = (root: string, file: string, target: string): boolean =>
  existsSync(
    target.startsWith("/")
      ? path.join(root, target)
      : path.resolve(root, path.dirname(file), target),
  );

const deadLinksIn = (file: string, line: number, text: string, root: string): readonly Finding[] =>
  [...text.matchAll(LINK)].flatMap((match) => {
    const target = match.groups?.["target"] ?? "";
    return !isLocal(target) || resolvesFrom(root, file, target)
      ? []
      : [{ file, line, rule: "dead link", found: target, fix: "link a file the clone holds" }];
  });

const missingPathsIn = (
  file: string,
  line: number,
  text: string,
  root: string,
): readonly Finding[] =>
  [...text.matchAll(TRACKED_PATH)].flatMap((match) => {
    const target = match.groups?.["target"] ?? "";
    return existsSync(path.join(root, target))
      ? []
      : [{ file, line, rule: "missing path", found: target, fix: "name a path the clone holds" }];
  });

const unknownWordsIn = (
  file: string,
  line: number,
  text: string,
  glossary: ReadonlySet<string>,
): readonly Finding[] =>
  WORDS_LINE.test(text)
    ? [...text.matchAll(ITALIC)].flatMap((match) => {
        const word = match.groups?.["word"] ?? "";
        return glossary.has(word)
          ? []
          : [
              {
                file,
                line,
                rule: "unknown word",
                found: word,
                fix: `no \`### ${word}\` heading in ${GLOSSARY}`,
              },
            ];
      })
    : [];

export const findingsIn = (file: string, source: string, context: Context): readonly Finding[] =>
  source.split("\n").flatMap((text, index) => {
    const line = index + 1;
    return [
      ...bannedIn(file, line, text),
      ...unknownDecisionsIn(file, line, text, context.decisions),
      ...deadLinksIn(file, line, text, context.root),
      ...missingPathsIn(file, line, text, context.root),
      ...unknownWordsIn(file, line, text, context.glossary),
    ];
  });

const INDEX = "docs/specs/v01-route.md";

const BRIEFS_FOLDER = "docs/specs/route";

const NOT_A_BRIEF: ReadonlySet<string> = new Set(["seams.md"]);

const COLUMNS = ["Block", "Strand", "Delivers", "Blocked by", "Status", "Next", "Plan"] as const;

const STATUS_WORDS: ReadonlySet<string> = new Set([
  "unplanned",
  "planned",
  "building",
  "done",
  "reserve",
]);

const STRANDS: ReadonlySet<string> = new Set(["knowledge", "records", "people", "ops", "customer"]);

const BLOCK_ID = /\b[A-Z]\d[ab]?\b/g;

const BLOCK_CELL = /^(?:\[(?<linked>[A-Z]\d[ab]?)\]\((?<target>[^)]+)\)|(?<bare>[A-Z]\d[ab]?))$/;

const NO_BLOCKER: ReadonlySet<string> = new Set(["none", "trigger"]);

const INDEX_CAP_WORDS = 1500;

const BRIEF_CAP_WORDS = 600;

type Row = { readonly line: number; readonly cells: readonly string[] };

type Table = { readonly header?: Row; readonly rows: readonly Row[] };

type Block = { readonly id: string; readonly target?: string };

type Parsed = {
  readonly line: number;
  readonly block: Block;
  readonly strand: string;
  readonly blockedBy: string;
  readonly status: string;
  readonly next: string;
};

type TableContext = {
  readonly file: string;
  readonly ids: ReadonlySet<string>;
  readonly briefs: ReadonlySet<string>;
  readonly nextOn: Map<string, number>;
};

type RowCheck = (row: Parsed, table: TableContext) => readonly Finding[];

const cellsOf = (text: string): readonly string[] =>
  text
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

const isSeparator = (cells: readonly string[]): boolean =>
  cells.every((cell) => /^:?-+:?$/.test(cell));

const tableRowsIn = (source: string): Table => {
  const lines = source.split("\n");
  const start = lines.findIndex((text) => text.trim().startsWith(`| ${COLUMNS[0]} |`));
  if (start === -1) return { rows: [] };
  const header = { line: start + 1, cells: cellsOf(lines[start] ?? "") };
  const rows: Row[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const text = lines[index] ?? "";
    if (!text.trim().startsWith("|")) break;
    const cells = cellsOf(text);
    if (!isSeparator(cells)) rows.push({ line: index + 1, cells });
  }
  return { header, rows };
};

const sameColumns = (cells: readonly string[]): boolean =>
  cells.length === COLUMNS.length && COLUMNS.every((column, index) => cells[index] === column);

const blockOf = (cell: string): Block | undefined => {
  const match = BLOCK_CELL.exec(cell)?.groups;
  if (match === undefined) return undefined;
  const linked = match["linked"];
  const target = match["target"];
  if (linked !== undefined && target !== undefined) return { id: linked, target };
  const bare = match["bare"];
  return bare === undefined ? undefined : { id: bare };
};

const finding = (
  file: string,
  line: number,
  rule: string,
  found: string,
  fix: string,
): Finding => ({ file, line, rule, found, fix });

const briefOf = (block: Block): string => `${block.id.toLowerCase()}.md`;

const isLive = (row: Parsed): boolean => row.status !== "done";

const parseRow = (file: string, row: Row): Parsed | Finding => {
  if (row.cells.length !== COLUMNS.length) {
    const found = row.cells.join(" | ");
    return finding(file, row.line, "table shape", found, `a row has ${COLUMNS.length} cells`);
  }
  const [blockCell = "", strand = "", , blockedBy = "", status = "", next = ""] = row.cells;
  const block = blockOf(blockCell);
  if (block === undefined) {
    const fix = "a Block cell is an id, linked while live";
    return finding(file, row.line, "table shape", blockCell, fix);
  }
  return { line: row.line, block, strand, blockedBy, status, next };
};

const isParsed = (parsed: Parsed | Finding): parsed is Parsed => "block" in parsed;

const isFinding = (parsed: Parsed | Finding): parsed is Finding => !isParsed(parsed);

const strandCheck: RowCheck = (row, table) =>
  STRANDS.has(row.strand)
    ? []
    : [finding(table.file, row.line, "strand", row.strand, `one of ${[...STRANDS].join(", ")}`)];

const statusCheck: RowCheck = (row, table) =>
  STATUS_WORDS.has(row.status)
    ? []
    : [
        finding(
          table.file,
          row.line,
          "status word",
          row.status,
          `one of ${[...STATUS_WORDS].join(", ")}`,
        ),
      ];

const nextSpellingCheck: RowCheck = (row, table) =>
  row.next === "" || row.next === "next"
    ? []
    : [finding(table.file, row.line, "next marker", row.next, "`next` or empty")];

const nextPlacementCheck: RowCheck = (row, table) =>
  row.next === "next" && row.status !== "unplanned" && row.status !== "planned"
    ? [finding(table.file, row.line, "next marker", row.block.id, `never on a ${row.status} row`)]
    : [];

const nextOnceCheck: RowCheck = (row, table) => {
  if (row.next !== "next") return [];
  const earlier = table.nextOn.get(row.strand);
  if (earlier === undefined) {
    table.nextOn.set(row.strand, row.line);
    return [];
  }
  const fix = `the ${row.strand} strand already marks line ${String(earlier)}`;
  return [finding(table.file, row.line, "next marker", row.block.id, fix)];
};

const blockersCheck: RowCheck = (row, table) =>
  NO_BLOCKER.has(row.blockedBy)
    ? []
    : [...row.blockedBy.matchAll(BLOCK_ID)].flatMap((match) =>
        table.ids.has(match[0])
          ? []
          : [
              finding(
                table.file,
                row.line,
                "unknown block",
                match[0],
                "every Blocked by id is a row",
              ),
            ],
      );

const briefCheck: RowCheck = (row, table) => {
  const brief = briefOf(row.block);
  if (isLive(row)) {
    const linked = row.block.target === `route/${brief}` && table.briefs.has(brief);
    const fix = `a live row links \`route/${brief}\`, and the file exists`;
    return linked ? [] : [finding(table.file, row.line, "row without brief", row.block.id, fix)];
  }
  const fix = "a done block's brief leaves docs/specs/route/";
  return table.briefs.has(brief)
    ? [finding(table.file, row.line, "brief for a done block", brief, fix)]
    : [];
};

const ROW_CHECKS: readonly RowCheck[] = [
  strandCheck,
  statusCheck,
  nextSpellingCheck,
  nextPlacementCheck,
  nextOnceCheck,
  blockersCheck,
  briefCheck,
];

const orphanBriefs = (table: TableContext, rows: readonly Parsed[]): readonly Finding[] => {
  const live = new Set(rows.filter(isLive).map((row) => briefOf(row.block)));
  const fix = "every brief under docs/specs/route/ has a live row";
  return [...table.briefs]
    .filter((brief) => !live.has(brief))
    .map((brief) => finding(table.file, 1, "brief without row", brief, fix));
};

export const tableFindingsIn = (
  file: string,
  source: string,
  briefs: ReadonlySet<string>,
): readonly Finding[] => {
  const { header, rows } = tableRowsIn(source);
  if (header === undefined) {
    const fix = `a table whose header is | ${COLUMNS.join(" | ")} |`;
    return [finding(file, 1, "table shape", "no status table", fix)];
  }
  if (!sameColumns(header.cells)) {
    const fix = `the columns are ${COLUMNS.join(", ")}`;
    return [finding(file, header.line, "table shape", header.cells.join(" | "), fix)];
  }
  const parsed = rows.map((row) => parseRow(file, row));
  const good = parsed.filter(isParsed);
  const table: TableContext = {
    file,
    ids: new Set(good.map((row) => row.block.id)),
    briefs,
    nextOn: new Map(),
  };
  return [
    ...parsed.filter(isFinding),
    ...good.flatMap((row) => ROW_CHECKS.flatMap((check) => check(row, table))),
    ...orphanBriefs(table, good),
  ];
};

const wordCount = (source: string): number =>
  source.split(/\s+/).filter((word) => word !== "").length;

export const capFindingsIn = (file: string, words: number, cap: number): readonly Finding[] =>
  words > cap ? [finding(file, 1, "over cap", String(words), `at most ${String(cap)} words`)] : [];

const briefFiles = (root: string): ReadonlySet<string> =>
  new Set(
    readdirSync(path.join(root, BRIEFS_FOLDER)).filter(
      (entry) => entry.endsWith(".md") && !NOT_A_BRIEF.has(entry),
    ),
  );

export const findingsUnder = (root: string): readonly Finding[] => {
  const context = contextOf(root);
  const files = routeFiles(root);
  const sources = new Map(files.map((file) => [file, readFileSync(path.join(root, file), "utf8")]));
  const briefs = existsSync(path.join(root, BRIEFS_FOLDER)) ? briefFiles(root) : new Set<string>();
  const index = sources.get(INDEX) ?? "";
  return [
    ...files.flatMap((file) => findingsIn(file, sources.get(file) ?? "", context)),
    ...tableFindingsIn(INDEX, index, briefs),
    ...capFindingsIn(INDEX, wordCount(index), INDEX_CAP_WORDS),
    ...[...briefs].flatMap((brief) =>
      capFindingsIn(
        `${BRIEFS_FOLDER}/${brief}`,
        wordCount(sources.get(`${BRIEFS_FOLDER}/${brief}`) ?? ""),
        BRIEF_CAP_WORDS,
      ),
    ),
  ];
};

export const reportOf = (finding: Finding): string =>
  `${finding.file}:${String(finding.line)}: ${finding.rule} \`${finding.found}\`: ${finding.fix}`;
