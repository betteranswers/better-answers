import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";
import { throwawayRepository, writeUnder } from "@better-answers/devtools/throwaway-tree";

import { keptNamesUnder } from "./kept-names.ts";
import {
  type CarveOut,
  NOT_WATCHED_ON_PAGES,
  OLD_WORDS,
  type OldWord,
  type Renamed,
  under,
} from "./old-words.ts";
import { readUnder } from "./tree-walk.ts";
import {
  AVOID_LIST,
  bulletEntriesIn,
  type Counts,
  entriesOf,
  type Finding,
  GLOSSARY,
  type InternalFinding,
  internalFindings,
  isRenamed,
  lineFindings,
  listFaults,
  overduePending,
  ratchetCounts,
  ratchetRises,
  readerFindings,
  readerStringsIn,
  readerStringsPerSource,
} from "./words-scan.ts";

/** A sweep that lands a word carves out, on its own row, the plans dated before it. */
const CARVED_OUT: readonly CarveOut[] = [
  {
    holds: under("docs/archive/"),
    why: "the archive is frozen history, kept in the words of its day",
  },
  {
    holds: (file) =>
      /^packages\/schema\/migrations\/(?:.*\.sql|meta\/\d{4}_snapshot\.json)$/.test(file),
    why: "a migration and its snapshot are a dated record, never edited once it has run",
  },
  {
    holds: (file) => file === "packages/core/src/audit/stored-names.ts",
    why: "the stored-names register spells each act name and detail key as audit rows keep it",
  },
  {
    holds: under("packages/devtools/renames/"),
    why: "a rename map names the old word it replaces, as a migration does",
  },
  {
    holds: (file) => file === "packages/devtools/test/rename.test.ts",
    why: "the rename runner's fixtures spell the old words they rename",
  },
  { holds: under(".cubic/"), why: "Cubic generates it and rewrites it" },
  {
    holds: under("apps/api/.claude/skills/"),
    why: "third-party skills, kept as upstream wrote them so their skills-lock hashes hold",
  },
  {
    holds: under(".claude/skills/pixel-perfect/"),
    why: "a third-party plugin, kept as upstream wrote it so it still matches its source commit",
  },
  {
    holds: (file) =>
      [
        "apps/api/tests/avoid-words.test.ts",
        "apps/api/tests/old-words.ts",
        "apps/api/tests/old-words-ratchet.json",
      ].includes(file),
    why: "this scan, its list and its baseline spell the words they refuse",
  },
];

const KEPT = keptNamesUnder(repositoryRoot);

const SCAN = { rows: OLD_WORDS, carvedOut: CARVED_OUT, kept: Object.values(KEPT).flat() };

const glossary = readUnder(repositoryRoot, GLOSSARY);

const said = (findings: readonly Finding[]): readonly string[] =>
  findings.map(
    ({ file, line, text, word, use, sweep }) =>
      `${file}:${String(line)}: ${text} → write "${use}" (the ${sweep} sweep replaced "${word}")`,
  );

const saidOfInternals = (findings: readonly InternalFinding[]): readonly string[] =>
  findings.map(({ file, line, text, internal }) => {
    const instead = internal.pagesSay ?? "what it means for the person, in the glossary's words";
    return `${file}:${String(line)}: ${text} → "${internal.head}" is internal; write ${instead}`;
  });

describe("the list of old words", () => {
  it("agrees with the glossary it serves", () => {
    expect(
      listFaults(OLD_WORDS, glossary, NOT_WATCHED_ON_PAGES),
      "apps/api/tests/old-words.ts and CONCEPTS.md disagree. Keep the list sorted, one row per word, each under an entry the glossary heads, and a pending row for every entry marked pending.",
    ).toEqual([]);
  });

  it("holds no row pending past its sweep's day", () => {
    expect(
      overduePending(OLD_WORDS, new Date().toISOString().slice(0, 10)),
      "a row in apps/api/tests/old-words.ts is pending with no day, or past its day. Once the sweep has merged, land the row. If it has not merged, set landsBy to the day it is now expected to.",
    ).toEqual([]);
  });

  it("reads a name from every source of kept names", () => {
    expect(
      Object.entries(KEPT)
        .filter(([, names]) => names.length === 0)
        .map(([source]) => source),
      "a source of kept names yielded nothing, so the scan would keep no name from it. Point kept-names.ts at where those names are declared now.",
    ).toEqual([]);
  });

  it("reads a string from every source of reader text", () => {
    expect(
      Object.entries(readerStringsPerSource(repositoryRoot))
        .filter(([, count]) => count === 0)
        .map(([source]) => source),
      "a source of reader text yielded no string, so every reader-text check passes on nothing there. Point words-scan.ts at where those words are written now.",
    ).toEqual([]);
  });

  it("leaves the glossary no list of words to avoid", () => {
    expect(glossary).not.toMatch(AVOID_LIST);
  });

  it("writes every entry of the glossary as a heading", () => {
    expect(
      bulletEntriesIn(glossary),
      "CONCEPTS.md writes an entry as a bullet, which the words test does not read. Write it as a `### head` heading, its definition below it.",
    ).toEqual([]);
  });
});

const RATCHET = path.join(import.meta.dirname, "old-words-ratchet.json");

const COUNTS = z.record(z.string(), z.record(z.string(), z.number().int()));

const baseline = (): Counts =>
  existsSync(RATCHET) ? COUNTS.parse(JSON.parse(readFileSync(RATCHET, "utf8"))) : {};

describe("the tree, against the list", () => {
  it("uses no landed word outside the senses it keeps", () => {
    expect(
      said(lineFindings(repositoryRoot, SCAN)),
      "a line writes a word the glossary has replaced. Write the word each line names, as CONCEPTS.md and apps/web/CODING_STANDARDS.md say; where the use is a sense the word keeps, add that sense to its row in apps/api/tests/old-words.ts.",
    ).toEqual([]);
  });

  it("writes no landed word in what a person reads", () => {
    expect(
      said(readerFindings(repositoryRoot, SCAN)),
      "a page, an MCP tool's text, an answer or an email writes a word the glossary has replaced. Write the word each line names.",
    ).toEqual([]);
  });

  it("writes no internal word where a person reads it", () => {
    expect(
      saidOfInternals(internalFindings(repositoryRoot, glossary, SCAN, NOT_WATCHED_ON_PAGES)),
      "a person would read a word CONCEPTS.md marks internal. Write what each line names; where the head is ordinary English, add it to NOT_WATCHED_ON_PAGES in apps/api/tests/old-words.ts.",
    ).toEqual([]);
  });

  it("writes no pending word on a page above its baseline", () => {
    const counts = ratchetCounts(repositoryRoot, OLD_WORDS);
    if (process.env["UPDATE_OLD_WORDS_RATCHET"] === "1") {
      writeFileSync(RATCHET, `${JSON.stringify(counts, null, 2)}\n`);
    }

    expect(
      ratchetRises(counts, baseline()),
      "a page's words write a word still pending its sweep more often than before. Write the reader's word its row names in apps/api/tests/old-words.ts. Once counts fall, lower the baseline: UPDATE_OLD_WORDS_RATCHET=1 pnpm --filter @better-answers/api run test tests/avoid-words.test.ts",
    ).toEqual([]);
  });
});

const scratch = mkdtempSync(path.join(tmpdir(), "avoid-words-"));
afterAll(() => {
  rmSync(scratch, { force: true, recursive: true });
});

let trees = 0;

const plantedTree = (files: Readonly<Record<string, string>>): string => {
  trees += 1;
  const root = throwawayRepository(path.join(scratch, `tree-${String(trees)}`));
  for (const [file, text] of Object.entries(files)) writeUnder(root, file, `${text}\n`);
  return root;
};

const at = ({ file, line, text }: { file: string; line: number; text: string }): string =>
  `${file}:${String(line)}: ${text}`;

const rowOf = (word: string): Renamed => {
  const row = OLD_WORDS.find((one) => one.word === word);
  if (row === undefined || !isRenamed(row)) throw new Error(`no renamed row for ${word}`);
  return row;
};

const landedNow = (row: Renamed, change: Partial<Renamed> = {}): Renamed => ({
  ...row,
  state: "landed",
  ...change,
});

/** A landed row as it stood before its sweep, for a fixture about a word still pending. */
const pendingNow = (row: Renamed): Renamed => ({ ...row, state: "pending" });

/** Spelled in halves, so no fixture reads as a finding should this file's carve-out be lifted. */
const WORD = ["a", "pp"].join("");
const APP = rowOf(WORD);

/** A retired word, spelled in halves for the same reason, and capitalised as a type opens. */
const RETIRED = ["led", "ger"].join("");
const Retired = `L${RETIRED.slice(1)}`;
const LEDGER = rowOf(RETIRED);
const LEDGER_ACT = rowOf(`${RETIRED} act`);

const BOUND = ["bind", "ing"].join("");
const BINDING = landedNow(rowOf(BOUND));

const CHECKED = ["Un", "checked"].join("");

/** The row as it read before the verification sweep widened it, for fixtures on reader text alone. */
const CHECKED_IN_READER_TEXT: Renamed = (({ word, use, entry, sweep, state }: Renamed) => ({
  word,
  use,
  entry,
  sweep,
  state,
  reach: "reader text" as const,
}))(rowOf(CHECKED));

const WORDS = "apps/web/src/features/sources/words.ts";

const scanOf = (rows: readonly OldWord[], kept: readonly string[] = []) => ({
  rows,
  carvedOut: CARVED_OUT,
  kept,
});

const linesOver = (
  files: Readonly<Record<string, string>>,
  rows: readonly OldWord[],
  kept: readonly string[] = [],
): readonly string[] => [...new Set(lineFindings(plantedTree(files), scanOf(rows, kept)).map(at))];

const findingsOver = (planted: string, file = "docs/planted.md"): readonly string[] =>
  linesOver({ [file]: planted }, [APP, LEDGER, LEDGER_ACT]);

describe("the sense a planted line is read in", () => {
  it.each([
    `The ${WORD} claims the job.`,
    `No ${WORD}↔worker HTTP — the control plane is rows.`,
    `The ${WORD} refuses to start unless PUBLIC_URL is set.`,
    `Every restore replays the erasures before the ${WORD} turns healthy.`,
    `Nothing reaches the ${WORD}.`,
    `The ${WORD}'s own hostname list is the second fence.`,
    `# The store is the target-state tracking: rows the ${WORD} deleted beside a store`,
    `The ${WORD} landed the rows.`,
    `The tunnel routes to \`http://${WORD}:3000\` on the platform stack.`,
    `Every restore replays the erasures before \`${WORD}\` turns healthy.`,
    `const bootstrap = requireBootstrap("the ${WORD}");`,
    `logger.info({ port: address.port }, "${WORD} listening");`,
    `throw new Error("the browser suite's ${WORD} needs a port as its one argument");`,
    `It starts ${WORD}, worker and migrate in that order.`,
  ])("refuses the tier sense, case %$", (planted) => {
    expect(findingsOver(planted)).toEqual([`docs/planted.md:1: ${planted}`]);
  });

  it.each([
    `better-answers is an ${WORD} for a company's knowledge.`,
    `The better-answers ${WORD} holds a company's knowledge.`,
    `Vite React single-page ${WORD}; talks to the api over tRPC only.`,
    `The web ${WORD} shows the Sources page.`,
    `Signed in on ${WORD}., a session cookie host-only.`,
    `The uptime check watches \`${WORD}.<apex>\` and two paths on the ${WORD} hostname.`,
    `The ruleset's bypass list names the GitHub ${WORD}.`,
    `The OAuth ${WORD} a client registers.`,
    `A view of an MCP ${WORD}.`,
    `ALTER ROLE ${WORD}_rt LOGIN PASSWORD '<new>';`,
    `SET LOCAL ${WORD}.workspace_id from the Principal.`,
    `const ${WORD} = new Hono();`,
    `${WORD}s/web/src/${WORD}/ composes the features.`,
    `| \`${WORD}.<apex>\` | \`${WORD}\` | everything: the SPA, /health, /mcp |`,
    `\`src/server.ts\` builds the tier's only Hono ${WORD}.`,
    `Read them against hostnames.ts: ${WORD} · agent · apex.`,
    `The nextjs-${WORD}-router skill, and the ${WORD}-router module.`,
    `        ${WORD} = coco.App(self.${WORD}_config(run, CHUNKS_APP), declare_rows)`,
    `    coco.App(`,
    `        self.${WORD}: coco.App = coco.App(config, declare_nothing)`,
    `        "${WORD}": LANDED_APP,`,
    `        '${WORD}': "chunks",`,
    `# The second store: the landed ${WORD} and the findings memo.`,
    `# The store: the chunks ${WORD} and its target-state tracking.`,
    `<p>This ${WORD} calls itself “Claude”. It is hosted at <strong>claude.ai</strong>.</p>`,
    `      : undefined) ?? "This ${WORD}",`,
  ])("passes a permitted sense, case %$", (planted) => {
    expect(findingsOver(planted)).toEqual([]);
  });

  it.each([
    `export const HOSTNAME_ROLES = ["${WORD}", "agent", "apex", "loopback"] as const;`,
    `  readonly ${WORD}: string;`,
    `    ${WORD}: hostnameOfUrl(publicUrl),`,
    `expect(read.ok && read.value.hostnames.${WORD}).toBe("${WORD}.example.test");`,
    `export const openTestGit = (${WORD}: TestApp): GitDoor => {`,
    `    ${WORD} = await startApp();`,
    `  const acme = await ${WORD}().provision({ name: "Acme" });`,
    `  const tokens = await connectAsHost(${WORD}, client, workspace.admin);`,
    `  const git = openTestGit(${WORD});`,
    `  const response = await ${WORD}`,
    `      ${WORD},`,
  ])("passes the api's own names in apps/api alone, case %$", (planted) => {
    expect(findingsOver(planted, "apps/api/src/planted.ts")).toEqual([]);
    expect(findingsOver(planted)).toEqual([`docs/planted.md:1: ${planted.trim()}`]);
  });
});

const ASSISTANT_WORD = ["cli", "ent"].join("");
const MEMBER_WORD = ["member", "ship"].join("");
const SHORT_NAME_WORD = ["sl", "ug"].join("");

/** The trees whose code may hold a library's client object, which the row's senses leave be. */
const CLIENT_OBJECT_TREES = ["apps/api/tests/", "packages/core/test/", "packages/schema/test/"];

describe("the senses the people words keep", () => {
  it.each(CLIENT_OBJECT_TREES)("refuses an assistant in prose under %s", (tree) => {
    const planted = `// Connect a ${ASSISTANT_WORD} to the workspace; the ${ASSISTANT_WORD}'s access ends.`;
    expect(linesOver({ [`${tree}planted.ts`]: planted }, [rowOf(ASSISTANT_WORD)])).toEqual([
      `${tree}planted.ts:1: ${planted}`,
    ]);
  });

  it.each([
    `  const rows = await ${ASSISTANT_WORD}.query("SELECT 1");`,
    `  await refusesEach(${ASSISTANT_WORD}, [["DELETE FROM job", "removing a job"]]);`,
    `const s3 = new S3Client({ region }); // the S3 ${ASSISTANT_WORD} signing for one region`,
    `// The tRPC ${ASSISTANT_WORD} batches its reads; the ${ASSISTANT_WORD}_id names the assistant.`,
  ])("passes a library's client object or OAuth's name, case %$", (planted) => {
    expect(linesOver({ "apps/api/tests/planted.ts": planted }, [rowOf(ASSISTANT_WORD)])).toEqual(
      [],
    );
  });

  it("keeps the stored count of members ended in core alone", () => {
    const planted = `  ${MEMBER_WORD}sEnded: swept.membersEnded,`;
    const row = rowOf(MEMBER_WORD);
    expect(linesOver({ "packages/core/src/planted.ts": planted }, [row])).toEqual([]);
    expect(linesOver({ "apps/web/src/planted.ts": planted }, [row])).toEqual([
      `apps/web/src/planted.ts:1: ${planted.trim()}`,
    ]);
  });

  it("refuses the short name's old word in any form", () => {
    const planted = `const ${SHORT_NAME_WORD}Taken = await held(${SHORT_NAME_WORD}s);`;
    expect(linesOver({ "apps/web/src/planted.ts": planted }, [rowOf(SHORT_NAME_WORD)])).toEqual([
      `apps/web/src/planted.ts:1: ${planted}`,
    ]);
  });

  it("keeps Better Auth's short name field in its files", () => {
    const planted = `  organization: { modelName: "workspace", fields: { ${SHORT_NAME_WORD}: "shortName" } },`;
    const row = rowOf(SHORT_NAME_WORD);
    expect(linesOver({ "apps/api/src/auth/auth.ts": planted }, [row])).toEqual([]);
    expect(linesOver({ "apps/api/src/planted.ts": planted }, [row])).toEqual([
      `apps/api/src/planted.ts:1: ${planted.trim()}`,
    ]);
  });

  it("keeps the short name's stored detail key in the web", () => {
    const planted = `  ${SHORT_NAME_WORD}Changed: "Short name changed",`;
    const row = rowOf(SHORT_NAME_WORD);
    expect(linesOver({ "apps/web/src/planted.ts": planted }, [row])).toEqual([]);
    expect(linesOver({ "packages/core/src/planted.ts": planted }, [row])).toEqual([
      `packages/core/src/planted.ts:1: ${planted.trim()}`,
    ]);
  });

  it("refuses the old word for access in any form", () => {
    const planted = `const ${ASSISTANT_WORD}Grants = await grantsOf(person);`;
    expect(
      linesOver({ "apps/web/src/planted.ts": planted }, [rowOf(`${ASSISTANT_WORD} grant`)]),
    ).toEqual([`apps/web/src/planted.ts:1: ${planted}`]);
  });

  it("reads an ordinary line as nothing", () => {
    expect(findingsOver("An ordinary line.")).toEqual([]);
  });

  it("reads nothing a carve-out holds but a rules file", () => {
    const findings = linesOver(
      {
        "docs/archive/adr/0001-planted.md": `The ${WORD} claims the job.`,
        "docs/archive/specs/T-001.md": `The ${WORD} claims the job.`,
        "docs/plans/2026-01-01-planted-plan.md": `The ${WORD} claims the job.`,
        "docs/specs/v01-route.md": `The ${WORD} claims the job.`,
        "apps/api/.claude/skills/resend/SKILL.md": `The ${WORD} claims the job.`,
        "apps/web/src/planted.ts": `// The ${WORD} claims the job.`,
        "apps/web/CODING_STANDARDS.md": `The ${WORD} claims the job.`,
        "packages/core/src/audit/stored-names.ts": `// The ${WORD} claims the job.`,
        "packages/devtools/renames/planted.ts": `// The ${WORD} claims the job.`,
        "packages/devtools/test/rename.test.ts": `// The ${WORD} claims the job.`,
        "packages/devtools/test/planted.test.ts": `// The ${WORD} claims the job.`,
      },
      [APP],
    );

    expect(findings).toEqual([
      `apps/web/CODING_STANDARDS.md:1: The ${WORD} claims the job.`,
      `docs/plans/2026-01-01-planted-plan.md:1: The ${WORD} claims the job.`,
      `docs/specs/v01-route.md:1: The ${WORD} claims the job.`,
      `packages/devtools/test/planted.test.ts:1: // The ${WORD} claims the job.`,
    ]);
  });

  it("holds a row's own carve-out for that row alone", () => {
    const findings = linesOver(
      {
        "apps/web/src/planted.ts": `// The ${WORD} keeps the ${RETIRED}.`,
        "packages/design-system/planted.md": `The ${WORD} keeps the ${RETIRED}.`,
      },
      [APP, LEDGER],
    );

    expect(findings).toEqual([
      `apps/web/src/planted.ts:1: // The ${WORD} keeps the ${RETIRED}.`,
      `packages/design-system/planted.md:1: The ${WORD} keeps the ${RETIRED}.`,
    ]);
  });

  it.each([
    {
      where: "the worker's source",
      file: "apps/worker/src/planted.py",
      planted: `# The ${WORD} claims the job.`,
    },
    {
      where: "the tier contract's fixtures",
      file: "contracts/queue/cases.json",
      planted: `      "why": "the rebuild the ${WORD} claimed in the foreground",`,
    },
  ])("reads $where, which no carve-out holds", ({ file, planted }) => {
    expect(findingsOver(planted, file)).toEqual([`${file}:1: ${planted.trim()}`]);
  });

  it("reads the api's source and tests, except this scan's files", () => {
    const findings = linesOver(
      {
        "apps/api/src/planted.ts": `// The ${WORD} claims the job.`,
        "apps/api/tests/planted.test.ts": `// The ${WORD} claims the job.`,
        "apps/api/tests/avoid-words.test.ts": `// The ${WORD} claims the job.`,
        "apps/api/tests/old-words.ts": `// The ${WORD} claims the job.`,
        "apps/api/tests/old-words-ratchet.json": `{ "${WORD}": 1 }`,
      },
      [APP],
    );

    expect(findings).toEqual([
      `apps/api/src/planted.ts:1: // The ${WORD} claims the job.`,
      `apps/api/tests/planted.test.ts:1: // The ${WORD} claims the job.`,
    ]);
  });

  it("reads a pending word nowhere", () => {
    const findings = linesOver({ "docs/planted.md": `The ${WORD} claims the job.` }, [
      { ...APP, state: "pending" },
    ]);

    expect(findings).toEqual([]);
  });
});

describe("a word retired outright, beside one held to its senses", () => {
  it.each([
    { file: "packages/core/src/planted.ts", planted: `const rows = await ${RETIRED}RowsOf(tx);` },
    { file: "packages/core/src/planted.ts", planted: `type ${Retired}Act = AuditAct;` },
    { file: "packages/core/src/planted.ts", planted: `const row = readHTTP${Retired}Row();` },
    {
      file: "packages/core/src/planted.ts",
      planted: `export const ${RETIRED.toUpperCase()}_ACT = 1;`,
    },
    { file: "apps/worker/src/planted.py", planted: `def read_${RETIRED}_row(tx): ...` },
    { file: "packages/schema/src/planted.sql", planted: `SELECT id FROM a_${RETIRED}_row;` },
    { file: "docs/planted.md", planted: `Every act books its ${RETIRED}-row, insert-only.` },
    { file: "docs/planted.md", planted: `The Admin reads the ${RETIRED}s.` },
  ])("refuses it inside a compound, case %$", ({ file, planted }) => {
    expect(findingsOver(planted, file)).toEqual([`${file}:1: ${planted}`]);
  });

  it.each([
    {
      file: "packages/core/src/planted.ts",
      planted: `const fixture = contractFixture("cost-${RETIRED}");`,
    },
    {
      file: "apps/worker/tests/planted.py",
      planted: `def read_cost_${RETIRED}() -> dict[str, Any]:`,
    },
    {
      file: "packages/core/src/planted.ts",
      planted: `const cost${Retired} = readCost${Retired}();`,
    },
    {
      file: "docs/planted.md",
      planted: `The \`llm_call\` ${RETIRED} and the model client land in S2.`,
    },
    {
      file: "docs/planted.md",
      planted: `Every signal over the cost ${RETIRED} groups by workspace.`,
    },
    {
      file: "contracts/cost-ledger/rows.json",
      planted: `"is": "every signal over this ${RETIRED}"`,
    },
  ])("passes spend's cost-ledger sense, case %$", ({ file, planted }) => {
    expect(findingsOver(planted, file)).toEqual([]);
  });

  it("passes a migration's tag in the journal alone", () => {
    const planted = `      "tag": "0008_${RETIRED}-substrate",`;

    expect(findingsOver(planted, "packages/schema/migrations/meta/_journal.json")).toEqual([]);
    expect(findingsOver(planted)).toEqual([`docs/planted.md:1: ${planted.trim()}`]);
  });

  it("passes a migration's snapshot, carved out whole", () => {
    const planted = `      "name": "a_${RETIRED}_row",`;

    expect(findingsOver(planted, "packages/schema/migrations/meta/0008_snapshot.json")).toEqual([]);
  });

  it("passes a company's own books in the worker's fixtures alone", () => {
    const planted = `and the ${RETIRED} is the record the claim rests on`;

    expect(findingsOver(planted, "apps/worker/tests/fixtures/terms.txt")).toEqual([]);
    expect(findingsOver(planted)).toEqual([`docs/planted.md:1: ${planted}`]);
  });

  it("reads a word held to senses whole, never in compounds", () => {
    expect(findingsOver(`const my_${WORD}_name = ${WORD}Router;`)).toEqual([]);
  });

  it("refuses a retired two-word item inside a compound", () => {
    const findings = linesOver(
      { "docs/planted.md": `type ${Retired}Act = string;\nThe ${RETIRED} holds it.` },
      [LEDGER_ACT],
    );

    expect(findings).toEqual([`docs/planted.md:1: type ${Retired}Act = string;`]);
  });

  it("reads the word whole once held to one sense", () => {
    const findings = linesOver(
      { "docs/planted.md": `${RETIRED}RowsOf\nThe ${RETIRED} holds it.` },
      [{ ...LEDGER, reach: "one sense", permitted: [] }],
    );

    expect(findings).toEqual([`docs/planted.md:2: The ${RETIRED} holds it.`]);
  });
});

describe("a word that lands with its sweep", () => {
  const AT_SOURCE = {
    "packages/core/src/planted.ts": `const ${BOUND} = await read(tx);`,
    "packages/schema/migrations/0099_planted.sql": `ALTER TABLE source_${BOUND} ADD COLUMN x text;`,
    "packages/schema/migrations/meta/0099_snapshot.json": `"name": "source_${BOUND}"`,
    "apps/api/tests/old-words.ts": `word: "${BOUND}",`,
  };

  it("passes in code while pending, and fails once landed", () => {
    expect(linesOver(AT_SOURCE, [pendingNow(rowOf(BOUND))])).toEqual([]);
    expect(linesOver(AT_SOURCE, [BINDING])).toEqual([
      `packages/core/src/planted.ts:1: const ${BOUND} = await read(tx);`,
    ]);
  });

  it("names the reader's word and sweep for a new identifier", () => {
    const tree = plantedTree({ "packages/core/src/planted.ts": `const ${BOUND}Id = ulid();` });

    expect(lineFindings(tree, scanOf([BINDING]))).toEqual([
      {
        file: "packages/core/src/planted.ts",
        line: 1,
        text: `const ${BOUND}Id = ulid();`,
        word: BOUND,
        use: "connected source",
        sweep: "connected source",
      },
    ]);
  });

  it("passes a kept refusal word once the word has landed", () => {
    const refusal = `no-such-${BOUND}`;
    const line = `return found ? "${refusal}" : err("${refusal}");`;
    const files = { "packages/core/src/planted.ts": line };

    expect(linesOver(files, [BINDING], [refusal])).toEqual([]);
    expect(linesOver(files, [BINDING])).toEqual([`packages/core/src/planted.ts:1: ${line}`]);
  });

  it("refuses a stored detail key outside the stored-names register", () => {
    const outside = [
      `bound: act("sources.${BOUND}.bound", { ${BOUND}Id: "id" }),`,
      `expect(row.detail["${BOUND}Id"]).toBe(id);`,
    ];
    const files = {
      "packages/core/src/audit/stored-names.ts": `  connectedSourceId: "${BOUND}Id",`,
      "packages/core/src/sources/planted.ts": [
        ...outside,
        `bound: act("sources.${BOUND}.bound", { [STORED_DETAIL_KEYS.connectedSourceId]: "id" }),`,
      ].join("\n"),
    };

    expect(linesOver(files, [BINDING], SCAN.kept)).toEqual(
      outside.map(
        (line, index) => `packages/core/src/sources/planted.ts:${String(index + 1)}: ${line}`,
      ),
    );
  });

  it("keeps a stored act name the generated list has lost", () => {
    const tree = plantedTree({
      "apps/web/src/features/people/audit-actions.ts": `export const DECLARED_ACTIONS = ["sources.connected_source.bound"] as const;`,
      "apps/web/src/shared/navigation.ts": `movedFrom: ["/sources"],`,
      "apps/api/tests/better-auth-endpoints.txt": "/sign-in/email",
    });
    const files = { "docs/planted.md": `Each upload records sources.${BOUND}.bound.` };

    expect(linesOver(files, [BINDING], Object.values(keptNamesUnder(tree)).flat())).toEqual([]);
  });

  it("keeps every older address a page lists", () => {
    const tree = plantedTree({
      "apps/web/src/features/people/audit-actions.ts": `export const DECLARED_ACTIONS = [] as const;`,
      "apps/web/src/shared/navigation.ts": [
        `movedFrom: ["/system/old-name"],`,
        `movedFrom: [`,
        `  "/system/older-name",`,
        `  "/agent-operations/old-name",`,
        `],`,
      ].join("\n"),
      "apps/api/tests/better-auth-endpoints.txt": "/sign-in/email",
    });

    expect(keptNamesUnder(tree)["old page addresses"]).toEqual([
      "/system/old-name",
      "/system/older-name",
      "/agent-operations/old-name",
    ]);
  });

  it("passes a deferred sense until its later sweep lands", () => {
    const chunk = ["ch", "unk"].join("");
    const passage = rowOf(chunk);
    const line = `    WHERE ${BOUND}_id = %s`;
    const deferred = landedNow(rowOf(BOUND), {
      permitted: [
        {
          sense: `the ${BOUND}_id column on index.${chunk}`,
          written: new RegExp(`\\b${BOUND}_id\\b`, "g"),
          until: "passage",
        },
      ],
    });
    const files = { "apps/worker/src/planted.py": line };

    expect(linesOver(files, [deferred, { ...passage, state: "pending" }])).toEqual([]);
    expect(linesOver(files, [deferred, landedNow(passage)])).toEqual([
      `apps/worker/src/planted.py:1: ${line.trim()}`,
    ]);
  });

  it("keeps a dotted or hyphenated name wherever prose writes it", () => {
    const act = `sources.${BOUND}.published`;
    const refusal = `no-such-${BOUND}`;
    const files = { "docs/planted.md": `It records ${act} and answers ${refusal}.` };

    expect(linesOver(files, [BINDING], [act, refusal])).toEqual([]);
  });

  it("passes named parameters, and refuses landed words, in MCP text", () => {
    const hit = ["h", "it"].join("");
    const files = {
      "apps/api/src/mcp/entries/index.ts": [
        `const find = defineEntry({`,
        `  description: "Use \`open\` with a concept's \`iri\`, or its 'iri' again.",`,
        `  title: "One line per ${hit}",`,
        `  hint: "Give the iri you found.",`,
        `});`,
      ].join("\n"),
    };
    const rows = [landedNow(rowOf("IRI")), landedNow(rowOf(hit))];
    const tree = plantedTree(files);
    const scan = scanOf(rows, ["iri"]);

    expect(readerFindings(tree, scan).map(at)).toEqual([
      "apps/api/src/mcp/entries/index.ts:4: Give the iri you found.",
    ]);
    expect(lineFindings(tree, scan).map(at)).toEqual([
      `apps/api/src/mcp/entries/index.ts:3: title: "One line per ${hit}",`,
    ]);
  });

  it("refuses an act, passing React's act and the verb", () => {
    const act = ["a", "ct"].join("");
    const refused = {
      "apps/web/src/features/people/planted-words.ts": `export const TAKEN = "Each ${act} lands at once.";`,
      "packages/core/src/members/planted.ts": `/** An ${act} on the person names them by person id. */`,
      "docs/operations/planted.md": `A role change is the Admin's ${act} on the People page.`,
      "apps/web/test/planted.test.tsx": `// The ${act} the row menu opened has landed.`,
      "docs/architecture/planted.md": `It removes the store as the first statement of the sync that ${act} queued.`,
      "apps/web/e2e/planted.spec.ts": `test("opens the invite ${act} on Members for an Admin", async () => {});`,
      "packages/core/test/planted.test.ts": `it("waits behind a live ${act} on the same bundle", async () => {});`,
    };
    const passed = {
      "apps/web/test/planted-react.test.tsx": `await ${act}(async () => render(<Members />));`,
      "apps/web/test/planted-import.test.tsx": `import { ${act}, cleanup } from "@testing-library/react";`,
      "apps/api/src/auth/planted.ts": `/** A session that must confirm first holds no claims to ${act} on. */`,
      "apps/web/src/shared/planted.tsx": `/** Only \`forbidden\` names who can ${act}, because the reader can't. */`,
      "apps/web/src/shared/planted-grid.tsx": `/** The row focus is in, for keystrokes that ${act} on it. */`,
      "packages/design-system/planted.md": `Ask some questions, and ${act} as an expert designer.`,
      "apps/web/src/shared/address-ask.ts": `const ASKED_BEFORE = { action: "${act}", search: undefined };`,
      "packages/schema/test/before-the-action.ts": `ALTER TABLE "audit_event" RENAME COLUMN "action" TO "${act}"`,
    };

    expect([...linesOver({ ...refused, ...passed }, [rowOf(act)])].toSorted()).toEqual(
      Object.entries(refused)
        .map(([file, text]) => `${file}:1: ${text}`)
        .toSorted(),
    );
  });

  it("refuses an action's plural and compounds, passing the verb", () => {
    const acts = ["a", "cts"].join("");
    const Acts = `A${acts.slice(1)}`;
    const refused = {
      "packages/core/src/members/planted.ts": `const GROUP_${acts.toUpperCase()} = declare${Acts}("people", {});`,
      "apps/web/src/shared/planted-menu.tsx": `<RowActions label={\`${Acts} for \${name}\`} />`,
      "apps/web/src/features/sources/planted.tsx": `import { Review } from "./review-${acts}.tsx";`,
      "docs/architecture/planted.md": `The three bulk ${acts} take groups of findings.`,
      "docs/solutions/planted.md": `The credential class is for ${acts} on our own estate.`,
      "packages/core/src/audit/planted.ts": `// The audit log records ${acts} on a person.`,
    };
    const passed = {
      "apps/api/src/mcp/planted.ts": `// the set's word alone, which is what an agent ${acts} on.`,
      "CODING_STANDARDS.md": `- the purposes a platform principal ${acts} for;`,
      ".claude/skills/planted/SKILL.md": `Name who ${acts}, what they do, and why it matters.`,
    };

    expect([...linesOver({ ...refused, ...passed }, [rowOf(acts)])].toSorted()).toEqual(
      Object.entries(refused)
        .map(([file, text]) => `${file}:1: ${text}`)
        .toSorted(),
    );
  });

  it("refuses the old group name, passing ADR 0047's Flux comparison", () => {
    const group = ["Agent", "Operations"].join(" ");
    const adr =
      "docs/solutions/architecture-patterns/adr-0047-the-platform-is-surfaces-groups-and-screens.md";
    const files = {
      "packages/design-system/readme.md": `  Sources, ${group}, Questions, People.`,
      [adr]: `- Questions stays apart from ${group}.\n**${group} against Flux AgentOps.**`,
      "apps/web/src/shared/navigation.ts": `movedFrom: ["/agent-operations/routes-and-spend"],`,
    };
    const kept = ["/agent-operations/routes-and-spend"];

    expect([...linesOver(files, [rowOf(group)], kept)].toSorted()).toEqual([
      `${adr}:1: - Questions stays apart from ${group}.`,
      `packages/design-system/readme.md:1: Sources, ${group}, Questions, People.`,
    ]);
  });

  it("refuses the old People page name where pages are named", () => {
    const tokens = ["Tok", "ens"].join("");
    const navigation = "apps/web/src/shared/navigation.ts";
    const files = {
      [navigation]: `name: "${tokens}",\nname: "Personal ${tokens.toLowerCase()}",`,
      "apps/web/src/features/people/audit-details.ts": `${tokens.toLowerCase()}: "${tokens}",`,
    };

    expect(linesOver(files, [rowOf(tokens)])).toEqual([`${navigation}:1: name: "${tokens}",`]);
  });

  it("refuses a sync written as a run, passing other runs", () => {
    const run = ["r", "un"].join("");
    const refused = {
      [WORDS]: `export const SAID = "Last ${run} failed.";`,
      "packages/core/src/sources/listing.ts": `* off the connected source's latest ${run}.`,
      "docs/architecture/c4-dynamic-sync.md": `A document the ${run} cannot read is quarantined.`,
      "packages/core/src/sources/connected-source.ts": `// its first ${run} and its publish`,
    };
    const passed = {
      "apps/web/test/planted.test.ts": `// pnpm --filter @better-answers/web ${run} test`,
      "docs/operations/CI.md": `The mutation ${run} keeps its baseline.`,
      "docs/operations/local-gates.md": `A failed CI ${run} names its leg.`,
      "apps/api/src/trpc/planted.ts": `  ${run}: (input) => answer(input),`,
      "CONCEPTS.md": `- **${run} key** — _Internal._ the key a queued job is held to.`,
    };

    expect([...linesOver({ ...refused, ...passed }, [rowOf(run)])].toSorted()).toEqual(
      Object.entries(refused)
        .map(([file, text]) => `${file}:1: ${text}`)
        .toSorted(),
    );
  });

  it("refuses the type vocabulary, passing the refusal Vocabulary type", () => {
    const old = ["type", "vocabulary"].join(" ");
    const refused = {
      "docs/okf-v02.md": `the ${old} is a derived Kinds list`,
      "packages/core/src/concepts/planted.ts":
        `export type ${old.split(" ")[1]} = readonly string[];`.replace("vocabulary", "Vocabulary"),
    };
    const passed = {
      "packages/core/src/kernel/planted.ts":
        "export type Vocabulary = Readonly<Record<string, RefusalClass>>;",
    };

    expect([...linesOver({ ...refused, ...passed }, [rowOf(old)])].toSorted()).toEqual(
      Object.entries(refused)
        .map(([file, text]) => `${file}:1: ${text}`)
        .toSorted(),
    );
  });

  it("refuses a match written as a hit, passing other hits", () => {
    const hit = ["h", "it"].join("");
    const refused = {
      [WORDS]: `export const SAID = "One ${hit} per line.";`,
      "packages/core/src/answering/planted.ts": `const first = (${hit}: FindMatch) => ${hit}.title;`,
      "docs/solutions/architecture-patterns/adr-0018-planted.md": `- A concept ${hit} sits beside a document.`,
      "packages/core/src/concepts/planted.ts": `// the reconciler's ${hit} is not this one`,
    };
    const passed = {
      "apps/worker/Dockerfile": `# a cache ${hit} stands in for it`,
      ".github/workflows/planted.yml": `if: steps.node.outputs.cache-${hit} != 'true'`,
      "CONCEPTS.md": `- **reconciler ${hit}** — _Internal._ one commit the reconciler replayed.`,
      [`packages/core/src/concepts/reconciler-${hit}.ts`]: `const ${hit} = await tx.query(REPLAYED);`,
      "apps/web/src/shared/ui/planted.tsx": `/** The button stays a bare ${hit} area. */`,
    };

    expect([...linesOver({ ...refused, ...passed }, [rowOf(hit)])].toSorted()).toEqual(
      Object.entries(refused)
        .map(([file, text]) => `${file}:1: ${text}`)
        .toSorted(),
    );
  });

  it("refuses a collection written as a domain, passing other domains", () => {
    const domain = ["dom", "ain"].join("");
    const refused = {
      [WORDS]: `export const SAID = "Who owns each ${domain}.";`,
      "docs/solutions/architecture-patterns/adr-0047-planted.md": `- An owner per ${domain} decides.`,
      "docs/specs/v01-route.md": `the ${domain}'s owner, with a per-${domain} default`,
      "packages/core/src/concepts/planted.ts": `// A ${domain} is never a file key.`,
      "CONCEPTS.md": `listed with its owners, ${domain} by ${domain}.`,
      "docs/architecture/c4-planted.md": `Each concept is scoped to its ${domain}; the rule lands on that ${domain}.`,
    };
    const passed = {
      "packages/core/src/members/planted.ts": `const ${domain} = await testingDomainOf(admin, tx);`,
      "docs/operations/RUNBOOK.md": `an address on that ${domain}, or on the testing ${domain}`,
      "docs/solutions/architecture-patterns/adr-0008-planted.md": `at \`app.<${domain}>/mcp\``,
      "packages/schema/test/planted.test.ts": `CREATE ${domain.toUpperCase()} probe AS text`,
      "AGENTS.md": `### ${domain} docs: each ${domain} word is defined first.`,
      "apps/web/playwright.config.ts": `/** A relying party must be a ${domain}, never an IP. */`,
    };

    expect([...linesOver({ ...refused, ...passed }, [rowOf(domain)])].toSorted()).toEqual(
      Object.entries(refused)
        .map(([file, text]) => `${file}:1: ${text}`)
        .toSorted(),
    );
  });

  it.each([
    {
      word: "candidate",
      refused: ["packages/core/src/concepts/planted.ts", "contracts/suggestions/cases.json"],
      passed: ["apps/api/src/refusal.ts", "packages/core/src/erasure/documents.ts"],
    },
    {
      word: "repair",
      refused: [
        "packages/schema/src/suggestion-tables.ts",
        "packages/core/test/suggestions.test.ts",
      ],
      passed: ["apps/web/journeys/test-workspace.ts", "docs/operations/RUNBOOK.md"],
    },
    {
      word: "inbox",
      refused: ["packages/core/src/concepts/planted.ts", "packages/schema/src/definer-reach.ts"],
      passed: ["apps/web/journeys/inbox.ts", "packages/schema/src/test-inbox.ts"],
    },
    {
      word: "class",
      refused: [
        "apps/web/src/features/sources/planted-words.ts",
        "packages/core/src/sources/review.ts",
      ],
      passed: ["apps/api/src/refusal.ts", "docs/operations/SECRETS.md"],
    },
  ])("refuses $word only where it writes the renamed sense", ({ word, refused, passed }) => {
    const line = `// the ${word} it names`;
    const files = Object.fromEntries([...refused, ...passed].map((file) => [file, line]));

    expect([...linesOver(files, [rowOf(word)])].toSorted()).toEqual(
      refused.map((file) => `${file}:1: ${line}`).toSorted(),
    );
  });
});

describe("the product's name in a planted tree", () => {
  const nameFindingsIn = (files: Readonly<Record<string, string>>): readonly string[] =>
    linesOver(files, [rowOf("Better Answers")]);

  it("reads the tab title, word tables and pages alone", () => {
    const planted = 'export const PRODUCT_NAME = "Better Answers";';

    const findings = nameFindingsIn({
      "apps/web/index.html": "<title>Better Answers</title>",
      "apps/web/src/planted.ts": planted,
      "apps/api/src/planted.ts": planted,
      "apps/web/e2e/planted.ts": planted,
      "apps/web/src/shared/ui/NOTICES.md": "The licence Better Answers ships under.",
      "packages/core/src/planted.ts": planted,
    });

    expect(findings).toEqual([
      `apps/api/src/planted.ts:1: ${planted}`,
      "apps/web/index.html:1: <title>Better Answers</title>",
      `apps/web/src/planted.ts:1: ${planted}`,
    ]);
  });

  it("reads the old form in any case, passing the name", () => {
    const findings = nameFindingsIn({
      "apps/api/src/planted.ts":
        'subject: "Your better answers code",\nsubject: "Your better-answers code",',
    });

    expect(findings).toEqual(['apps/api/src/planted.ts:1: subject: "Your better answers code",']);
  });
});

const PLANTED_GLOSSARY = [
  "# Glossary",
  "",
  "### watermark",
  "_Internal._ the last commit a workspace's rows know about.",
  "",
  "### job",
  "_Internal._ one unit of background work.",
  "",
  "### landed copy",
  "_Internal._ a document's bytes as the platform holds them. A page says",
  "*Received*.",
  "",
  "### actor id",
  "_Internal._ who a record names. A page shows the person's name.",
  "",
  "### step (of an action)",
  "_Internal._ a part of an action that runs only inside it.",
  "",
  "### `ui://`",
  "_Internal._ the wire URI scheme for a view.",
  "",
  "### principal",
  "_Internal._ who a call is made as:",
  "  - **cursor** — _Internal._ an indented line, part of its entry.",
  "",
  "### connected source",
  "_Code rename pending._ an Admin's connection of one source.",
  "",
  "### Unverified",
  "nobody has confirmed it.",
  "",
].join("\n");

describe("the glossary's entries", () => {
  it("reads no bullet as an entry", () => {
    const glossary = [
      "- **job** — _Internal._ one unit of background work.",
      "",
      "### watermark",
      "_Internal._ the last commit a workspace's rows know about.",
      "- **cursor** — _Internal._ a bullet line inside the entry above.",
    ].join("\n");

    expect(entriesOf(glossary)).toEqual([
      {
        term: "watermark",
        definition:
          "_Internal._ the last commit a workspace's rows know about. - **cursor** — _Internal._ a bullet line inside the entry above.",
      },
    ]);
  });

  it("reads a headed entry up to the next heading", () => {
    const glossary = [
      "## Work",
      "",
      "### job",
      "_Internal._ one unit of background work.",
      "",
      "It runs once per claim.",
      "",
      "### connected source",
      "",
      "_Code rename pending._ an Admin's connection of one source.",
      "## Flagged ambiguities",
      "- *job* and *watermark* are distinct.",
    ].join("\n");

    expect(entriesOf(glossary)).toEqual([
      {
        term: "job",
        definition: "_Internal._ one unit of background work. It runs once per claim.",
      },
      {
        term: "connected source",
        definition: "_Code rename pending._ an Admin's connection of one source.",
      },
    ]);
  });

  it("reads no entry under a tail, but the next cluster", () => {
    const glossary = [
      "## Flagged ambiguities",
      "",
      "### cursor",
      "_Internal._ a heading under the first tail.",
      "",
      "## Retired",
      "",
      "### checkpoint",
      "_Internal._ a heading under the second tail.",
      "",
      "## Work",
      "",
      "### job",
      "_Internal._ one unit of background work.",
    ].join("\n");

    expect(entriesOf(glossary)).toEqual([
      { term: "job", definition: "_Internal._ one unit of background work." },
    ]);
  });

  it("finds a bullet entry outside the tails, by its line", () => {
    const glossary = [
      "## Work",
      "",
      "- **job** — _Internal._ one unit of background work.",
      "",
      "### watermark",
      "_Internal._ the last commit, read with:",
      "  - **cursor** — an indented line, part of its entry.",
      "",
      "## Retired",
      "",
      "- **checkpoint** — what a watermark was once called.",
    ].join("\n");

    expect(bulletEntriesIn(glossary)).toEqual([
      'line 3: "- **job** — _Internal._ one unit of background work." is a bullet; write it as "### job"',
    ]);
  });

  it("reads the mark that opens a headed entry's definition", () => {
    const glossary = [
      "### job",
      "_Internal._ one unit of background work. A page says *Task*.",
      "",
      "### connected source",
      "_Code rename pending._ an Admin's connection of one source.",
      "",
      "### Unverified",
      "nobody has confirmed it.",
    ].join("\n");

    expect(
      internalFindings(
        plantedTree({ [WORDS]: 'export const A = "One job left.";' }),
        glossary,
        scanOf([]),
        [],
      ).map((finding) => `${finding.internal.head} → ${finding.internal.pagesSay ?? "-"}`),
    ).toEqual(["job → Task"]);
    expect(listFaults([], glossary, [])).toContain(
      `"connected source" is marked pending, but no pending row names its code's word`,
    );
  });

  it("refuses a list of words to avoid, in any emphasis", () => {
    const lists = ["*Avoid:* booking", "_Avoid_: booking", "**Avoid:** booking", "Avoid: booking"];

    expect(lists.filter((line) => !AVOID_LIST.test(line))).toEqual([]);
    expect(AVOID_LIST.test("a word to avoid on a page")).toBe(false);
  });
});

describe("what a person reads, in a planted tree", () => {
  const internalsOver = (
    text: string,
    file = WORDS,
    rows: readonly OldWord[] = [],
  ): readonly string[] =>
    internalFindings(plantedTree({ [file]: text }), PLANTED_GLOSSARY, scanOf(rows), [
      { head: "job" },
    ]).map((finding) => `${at(finding)} → ${finding.internal.pagesSay ?? "-"}`);

  it("refuses an internal page word and names what to write", () => {
    expect(
      internalsOver(
        'export const READY = "The landed copy is ready.";\nexport const BY = "By actor id 7";',
      ),
    ).toEqual([
      `${WORDS}:1: The landed copy is ready. → Received`,
      `${WORDS}:2: By actor id 7 → the person's name`,
    ]);
  });

  it("finds an internal word in any form, bare of qualifiers", () => {
    expect(
      internalsOver(
        [
          'export const A = "Take one step back";',
          'export const B = "Two watermarks moved";',
          'export const C = "Open the ui:// view";',
        ].join("\n"),
      ),
    ).toEqual([
      `${WORDS}:1: Take one step back → -`,
      `${WORDS}:2: Two watermarks moved → -`,
      `${WORDS}:3: Open the ui:// view → -`,
    ]);
  });

  it("finds an internal word standing alone in lowercase", () => {
    expect(internalsOver('export const W = "watermark";')).toEqual([`${WORDS}:1: watermark → -`]);
  });

  it("skips a string that is a kept name whole", () => {
    const tree = plantedTree({
      [WORDS]: [
        `export const T = "${CHECKED}";`,
        'export const W = "watermark";',
        'export const M = "The watermark moved";',
      ].join("\n"),
    });
    const scan = scanOf([CHECKED_IN_READER_TEXT], [CHECKED, "watermark"]);

    expect(readerFindings(tree, scan)).toEqual([]);
    expect(internalFindings(tree, PLANTED_GLOSSARY, scan, []).map(at)).toEqual([
      `${WORDS}:3: The watermark moved`,
    ]);
  });

  it("reads a sub-bullet as part of its entry", () => {
    expect(internalsOver('export const C = "Move the cursor here";')).toEqual([]);
  });

  it("refuses an internal word in an email or the navigation", () => {
    expect(
      internalsOver(
        "const line = `Behind the watermark: ${count}`;",
        "apps/api/src/trpc/invitation-email.ts",
      ),
    ).toEqual(["apps/api/src/trpc/invitation-email.ts:1: Behind the watermark: → -"]);
    expect(
      internalsOver('const summary = "Behind the watermark";', "apps/web/src/shared/navigation.ts"),
    ).toEqual(["apps/web/src/shared/navigation.ts:1: Behind the watermark → -"]);
  });

  it("passes an internal head left unwatched as ordinary English", () => {
    expect(internalsOver('export const DONE = "The job is done.";')).toEqual([]);
  });

  it("waits on a pending row's word, never a landed row's", () => {
    const text = 'export const MOVED = "The watermark moved";';
    const row: Renamed = {
      word: "watermark",
      use: "last commit",
      entry: "watermark",
      sweep: "map",
      state: "pending",
      reach: "reader text",
    };

    expect(internalsOver(text, WORDS, [row])).toEqual([]);
    expect(internalsOver(text, WORDS, [{ ...row, state: "landed" }])).toEqual([
      `${WORDS}:1: The watermark moved → -`,
    ]);
  });

  it("reads no file where a person's text is not written", () => {
    expect(
      internalsOver(
        'const why = "the watermark moved";',
        "apps/web/src/features/sources/table.tsx",
      ),
    ).toEqual([]);
  });

  it("refuses a landed word in reader text alone", () => {
    const tree = plantedTree({
      [WORDS]: `export const TRUST = "${CHECKED}";`,
      "packages/design-system/tokens.css": `--trust-${CHECKED.toLowerCase()}-ink: #444;`,
    });

    expect(readerFindings(tree, scanOf([CHECKED_IN_READER_TEXT])).map(at)).toEqual([
      `${WORDS}:1: ${CHECKED}`,
    ]);
  });

  it("refuses the old trust token once its row reads everywhere", () => {
    const token = `--trust-${CHECKED.toLowerCase()}-bg: #444;`;

    expect(linesOver({ "packages/design-system/tokens.css": token }, [rowOf(CHECKED)])).toEqual([
      `packages/design-system/tokens.css:1: ${token}`,
    ]);
  });

  it("refuses any form of a landed word in MCP text", () => {
    const tree = plantedTree({
      "apps/api/src/mcp/entries/index.ts": 'const description = "Lists both IRIs here.";',
      "packages/core/src/answering/index.ts": `const unverified = (): string => "${CHECKED}";`,
    });
    const rows = [landedNow(rowOf("IRI")), CHECKED_IN_READER_TEXT];

    expect(readerFindings(tree, scanOf(rows)).map(at)).toEqual([
      "apps/api/src/mcp/entries/index.ts:1: Lists both IRIs here.",
      `packages/core/src/answering/index.ts:1: ${CHECKED}`,
    ]);
  });

  it("counts the strings each source of reader text holds", () => {
    const tree = plantedTree({
      [WORDS]: 'export const A = "Connect a document";\nexport const B = "Members";',
      "apps/web/src/shared/navigation.ts": 'export const N = "Members and groups";',
      "apps/api/src/mcp/entries/index.ts": 'const description = "Lists every concept.";',
      "packages/core/src/answering/index.ts": 'const said = "Nothing found here";',
      "apps/api/src/emails/invitation.ts": 'const subject = "You are invited";',
    });

    expect(readerStringsPerSource(tree)).toEqual({
      "page words modules": 2,
      "the navigation": 1,
      "MCP entries": 1,
      answers: 1,
      "emails and consent pages": 0,
    });
  });
});

describe("the strings a person reads in a source file", () => {
  const readIn = (source: string, file = "planted-words.tsx"): readonly string[] =>
    readerStringsIn(file, source).map(({ line, text }) => `${String(line)}: ${text}`);

  it("reads sentences, one-word labels, template text and JSX text", () => {
    expect(
      readIn(
        [
          'export const A = "Connect a document";',
          'export const B = "Members";',
          "export const C = `Sent to ${who} today`;",
          "export const D = () => <p>Nothing here yet</p>;",
          'export const E = () => <button aria-label="Close the menu" />;',
          'export const F = new Set(["Add a person"]);',
          'export const G = names.join(" and also ");',
        ].join("\n"),
      ),
    ).toEqual([
      "1: Connect a document",
      "2: Members",
      "3: Sent to",
      "3: today",
      "4: Nothing here yet",
      "5: Close the menu",
      "6: Add a person",
      "7: and also",
    ]);
  });

  it("reads a lone lowercase word in a words module alone", () => {
    const source = 'export const I = counted(n, "member", "members");';

    expect(readIn(source, "apps/web/src/features/people/member-words.ts")).toEqual([
      "1: member",
      "1: members",
    ]);
    expect(readIn(source, "apps/web/src/shared/navigation.ts")).toEqual([]);
  });

  it("fails on a file it cannot parse", () => {
    expect(() => readIn('export const A = "Unclosed;')).toThrow(
      /^planted-words\.tsx does not parse: /,
    );
  });

  it("reports each piece at the line its words start", () => {
    expect(
      readIn(
        [
          "export const H = () => (",
          "  <p>",
          "    Words on their own line",
          "  </p>",
          ");",
          "export const T = `First half ${x}",
          "second half`;",
          "export const L = [",
          '"A label at the start",',
          "];",
          "export const Z = () => <p>A",
          "note</p>;",
        ].join("\n"),
      ),
    ).toEqual([
      "3: Words on their own line",
      "6: First half",
      "7: second half",
      "9: A label at the start",
      "11: A\nnote",
    ]);
  });

  it("leaves identifiers, keys, imports, errors and log lines unread", () => {
    expect(
      readIn(
        [
          'import { x } from "./sources api.ts";',
          'export const KEYS = { "a key with spaces": "kebab-value" };',
          'type Role = "an editor";',
          "type Path = `/sources ${string} here`;",
          'export const P = "ListedBinding";',
          'export const K = ["camelCase", "kebab-case", "snake_case", "dotted.name"];',
          'export const E = () => <p className="flex items-center">{x}</p>;',
          "export const Q = () => <p> </p>;",
          'throw new Error("the screen declares no detail address");',
          'throw new TypeError("a type went wrong here");',
          'log.warn(facts, "the name flag did not go");',
          'ctx.log.warn(facts, "the notice did not go");',
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("the ratchet on pending words", () => {
  const NAVIGATION = "apps/web/src/shared/navigation.ts";
  const counted = (text: string, navigation = 'export const N = "Members and groups";'): Counts =>
    ratchetCounts(
      plantedTree({
        [WORDS]: text,
        [NAVIGATION]: navigation,
        "apps/web/src/features/sources/table.tsx": `const T = "${BOUND} ${BOUND}";`,
      }),
      [pendingNow(rowOf(BOUND)), rowOf("route"), landedNow(rowOf("screen"))],
    );

  it("counts a pending word in a page's words alone", () => {
    expect(counted(`export const A = "Each ${BOUND} and its ${BOUND}s";`)).toEqual({
      [WORDS]: { [BOUND]: 2 },
    });
  });

  it("counts a pending word standing alone in lowercase", () => {
    expect(counted(`export const B = "${BOUND}";`)).toEqual({ [WORDS]: { [BOUND]: 1 } });
  });

  it("counts in the navigation as in a words module", () => {
    expect(counted('export const A = "Nothing pending";', 'const name = "Bindings";')).toEqual({
      [NAVIGATION]: { [BOUND]: 1 },
    });
  });

  it("refuses one more than the baseline, and passes one fewer", () => {
    const baselineOf: Counts = { [WORDS]: { [BOUND]: 2 } };

    expect(ratchetRises({ [WORDS]: { [BOUND]: 3 } }, baselineOf)).toEqual([
      `${WORDS}: "${BOUND}" 3 times, against 2`,
    ]);
    expect(ratchetRises({ [WORDS]: { [BOUND]: 1 } }, baselineOf)).toEqual([]);
  });

  it("starts a word new to a file at none", () => {
    expect(ratchetRises({ [WORDS]: { route: 1 } }, {})).toEqual([
      `${WORDS}: "route" 1 times, against 0`,
    ]);
  });
});

describe("faults in a planted list", () => {
  const avoidedRow = (word: string, entry = "watermark"): OldWord => ({
    word,
    use: entry,
    entry,
    sweep: null,
  });
  const PENDING_ROW: Renamed = {
    word: BOUND,
    use: "connected source",
    entry: "connected source",
    sweep: "connected source",
    state: "pending",
    reach: "everywhere",
  };
  const UNNAMED = `"connected source" is marked pending, but no pending row names its code's word`;

  it("passes a sorted list whose rows sit under heads", () => {
    expect(
      listFaults([PENDING_ROW, avoidedRow("checkpoint"), avoidedRow("cursor")], PLANTED_GLOSSARY, [
        { head: "job" },
      ]),
    ).toEqual([]);
  });

  it.each([
    {
      fault: "a row out of order",
      rows: [avoidedRow("checkpoint"), PENDING_ROW],
      found: `"checkpoint" is listed before "${BOUND}", out of order or twice`,
    },
    {
      fault: "a word listed twice",
      rows: [PENDING_ROW, avoidedRow("cursor"), avoidedRow("Cursor")],
      found: `"cursor" is listed before "Cursor", out of order or twice`,
    },
    {
      fault: "a row under no head",
      rows: [PENDING_ROW, avoidedRow("cursor", "tracker")],
      found: `"cursor" sits under "tracker", which heads no glossary entry`,
    },
    { fault: "a pending entry with no row", rows: [avoidedRow("cursor")], found: UNNAMED },
    {
      fault: "a pending entry named by an avoided row alone",
      rows: [avoidedRow("connection", "connected source")],
      found: UNNAMED,
    },
    {
      fault: "a pending entry named by a landed row alone",
      rows: [{ ...PENDING_ROW, state: "landed" as const }],
      found: UNNAMED,
    },
  ])("finds $fault", ({ rows, found }) => {
    expect(listFaults(rows, PLANTED_GLOSSARY, [])).toContain(found);
  });

  it("finds an unwatched head the glossary does not mark internal", () => {
    expect(listFaults([PENDING_ROW], PLANTED_GLOSSARY, [{ head: "Unverified" }])).toEqual([
      `"Unverified" is left unwatched on pages, but it heads no internal entry`,
    ]);
  });
});

describe("a pending row past its day", () => {
  const TODAY = "2026-10-08";
  const UNDATED: Renamed = {
    word: "actor id",
    use: "the person's name",
    entry: "actor id",
    sweep: "Audit log",
    state: "pending",
    reach: "reader text",
  };
  const STALE: Renamed = { ...UNDATED, landsBy: "2026-10-07" };

  it("refuses a stale pending row, naming it and its sweep", () => {
    expect(overduePending([STALE], TODAY)).toEqual([
      `"actor id" is still pending, but the Audit log sweep was due to land by 2026-10-07`,
    ]);
  });

  it.each([
    { due: "a pending row due today", landsBy: TODAY },
    { due: "a pending row due after today", landsBy: "2026-10-09" },
  ])("passes $due", ({ landsBy }) => {
    expect(overduePending([{ ...STALE, landsBy }], TODAY)).toEqual([]);
  });

  it.each([
    { fault: "no day", row: UNDATED },
    {
      fault: "a day not written YYYY-MM-DD",
      row: { ...STALE, landsBy: "2026-10-4" },
    },
    { fault: "its month and day swapped", row: { ...STALE, landsBy: "2026-20-10" } },
    { fault: "a day its month lacks", row: { ...STALE, landsBy: "2026-02-30" } },
  ])("refuses a pending row with $fault", ({ row }) => {
    expect(overduePending([row], TODAY)).toEqual([
      `"actor id" is pending for the Audit log sweep, but names no day it lands by, as YYYY-MM-DD`,
    ]);
  });

  it("reads no landed or avoided row", () => {
    expect(
      overduePending(
        [
          { ...STALE, state: "landed" },
          { word: "cursor", use: "watermark", entry: "watermark", sweep: null },
        ],
        TODAY,
      ),
    ).toEqual([]);
  });
});
