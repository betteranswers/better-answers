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
} from "./old-words.ts";
import { readUnder } from "./tree-walk.ts";
import {
  type Counts,
  type Finding,
  GLOSSARY,
  type InternalFinding,
  internalFindings,
  isRenamed,
  lineFindings,
  listFaults,
  ratchetCounts,
  ratchetRises,
  readerFindings,
  readerStringsIn,
} from "./words-scan.ts";

const under =
  (prefix: string) =>
  (file: string): boolean =>
    file.startsWith(prefix);

const CARVED_OUT: readonly CarveOut[] = [
  {
    holds: under("docs/archive/"),
    why: "the archive is frozen history, kept in the words of its day",
  },
  {
    holds: under("docs/plans/"),
    why: "a plan records what was built, in the words of its day",
  },
  {
    holds: (file) =>
      /^packages\/schema\/migrations\/(?:.*\.sql|meta\/\d{4}_snapshot\.json)$/.test(file),
    why: "a migration and its snapshot are a dated record, never edited once it has run",
  },
  { holds: under(".cubic/"), why: "Cubic generates it and rewrites it" },
  {
    holds: under("apps/api/.claude/skills/"),
    why: "third-party skills, kept as upstream wrote them so their skills-lock hashes hold",
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

const KEPT = await keptNamesUnder(repositoryRoot);

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
      "apps/api/tests/old-words.ts and CONTEXT.md disagree. Keep the list sorted, one row per word, each under an entry the glossary heads, and a pending row for every entry marked pending.",
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

  it("leaves the glossary no list of words to avoid", () => {
    expect(glossary).not.toMatch(/_Avoid_/);
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
      "a line writes a word the glossary has replaced. Write the word each line names, as CONTEXT.md and apps/web/CODING_STANDARDS.md say; where the use is a sense the word keeps, add that sense to its row in apps/api/tests/old-words.ts.",
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
      "a person would read a word CONTEXT.md marks internal. Write what each line names; where the head is ordinary English, add it to NOT_WATCHED_ON_PAGES in apps/api/tests/old-words.ts.",
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

const linesOver = (
  files: Readonly<Record<string, string>>,
  rows: readonly OldWord[],
  kept: readonly string[] = [],
): readonly string[] => [
  ...new Set(lineFindings(plantedTree(files), { rows, carvedOut: CARVED_OUT, kept }).map(at)),
];

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
      },
      [APP],
    );

    expect(findings).toEqual([
      `apps/web/CODING_STANDARDS.md:1: The ${WORD} claims the job.`,
      `docs/specs/v01-route.md:1: The ${WORD} claims the job.`,
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
    expect(linesOver(AT_SOURCE, [rowOf(BOUND)])).toEqual([]);
    expect(linesOver(AT_SOURCE, [BINDING])).toEqual([
      `packages/core/src/planted.ts:1: const ${BOUND} = await read(tx);`,
    ]);
  });

  it("names the reader's word and sweep for a new identifier", () => {
    const tree = plantedTree({ "packages/core/src/planted.ts": `const ${BOUND}Id = ulid();` });

    expect(lineFindings(tree, { rows: [BINDING], carvedOut: CARVED_OUT, kept: [] })).toEqual([
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
    const files = { "packages/core/src/planted.ts": `return err("${refusal}");` };

    expect(linesOver(files, [BINDING], [refusal])).toEqual([]);
    expect(linesOver(files, [BINDING])).toEqual([
      `packages/core/src/planted.ts:1: return err("${refusal}");`,
    ]);
  });

  it("passes named parameters, and refuses landed words, in MCP text", () => {
    const hit = ["h", "it"].join("");
    const files = {
      "apps/api/src/mcp/entries/index.ts": [
        `const find = defineEntry({`,
        `  description: "Preview what matches. Use \`open\` with a concept's \`iri\` to read it.",`,
        `  title: "One line per ${hit}",`,
        `});`,
      ].join("\n"),
    };
    const rows = [landedNow(rowOf("IRI")), landedNow(rowOf(hit))];
    const tree = plantedTree(files);

    expect(readerFindings(tree, { rows, carvedOut: CARVED_OUT, kept: ["iri"] })).toEqual([]);
    expect(lineFindings(tree, { rows, carvedOut: CARVED_OUT, kept: ["iri"] }).map(at)).toEqual([
      `apps/api/src/mcp/entries/index.ts:3: title: "One line per ${hit}",`,
    ]);
  });

  it("passes React's act in tests, and refuses it on pages", () => {
    const act = landedNow(rowOf("act"), {
      permitted: [{ sense: "React's and Testing Library's act", written: /\bact\(/g }],
    });
    const findings = linesOver(
      {
        "apps/web/test/planted.test.tsx": `await act(async () => render(<Members />));`,
        "apps/web/src/features/people/planted-words.ts": `export const TAKEN = "Each act lands at once.";`,
      },
      [act],
    );

    expect(findings).toEqual([
      `apps/web/src/features/people/planted-words.ts:1: export const TAKEN = "Each act lands at once.";`,
    ]);
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
  "- **watermark** — _Internal._ the last commit a workspace's rows know about.",
  "- **job** — _Internal._ one unit of background work.",
  "- **landed copy** — _Internal._ a document's bytes as the platform holds them. A page says",
  "  *Received*.",
  "- **connected source** — _Code rename pending._ an Admin's connection of one source.",
  "- **Unverified** — nobody has confirmed it.",
  "",
].join("\n");

describe("what a person reads, in a planted tree", () => {
  const WORDS = "apps/web/src/features/sources/words.ts";

  const internalsOver = (text: string, file = WORDS): readonly string[] =>
    internalFindings(
      plantedTree({ [file]: text }),
      PLANTED_GLOSSARY,
      { rows: [], carvedOut: CARVED_OUT, kept: [] },
      [{ head: "job" }],
    ).map((finding) => `${at(finding)} → ${finding.internal.pagesSay ?? "-"}`);

  it("refuses an internal page word and names what to write", () => {
    expect(internalsOver('export const READY = "The landed copy is ready.";')).toEqual([
      `${WORDS}:1: The landed copy is ready. → Received`,
    ]);
  });

  it("refuses an internal word in an email", () => {
    expect(
      internalsOver(
        "const line = `Behind the watermark: ${count}`;",
        "apps/api/src/trpc/invitation-email.ts",
      ),
    ).toEqual(["apps/api/src/trpc/invitation-email.ts:1: Behind the watermark: → -"]);
  });

  it("passes an internal head left unwatched as ordinary English", () => {
    expect(internalsOver('export const DONE = "The job is done.";')).toEqual([]);
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
    const checked = ["Un", "checked"].join("");
    const tree = plantedTree({
      [WORDS]: `export const TRUST = "${checked}";`,
      "packages/design-system/tokens.css": `--trust-${checked.toLowerCase()}-ink: #444;`,
    });

    expect(
      readerFindings(tree, { rows: [rowOf(checked)], carvedOut: CARVED_OUT, kept: [] }).map(at),
    ).toEqual([`${WORDS}:1: ${checked}`]);
  });
});

describe("the strings a person reads in a source file", () => {
  const readIn = (source: string, file = "planted-words.tsx"): readonly string[] =>
    readerStringsIn(file, source).map(({ line, text }) => `${String(line)}: ${text}`);

  it("reads sentences, capitalised labels, template text and JSX text", () => {
    expect(
      readIn(
        [
          'export const A = "Connect a document";',
          'export const B = "Members";',
          "export const C = `Sent to ${who} today`;",
          "export const D = () => <p>Nothing here yet</p>;",
        ].join("\n"),
      ),
    ).toEqual([
      "1: Connect a document",
      "2: Members",
      "3: Sent to",
      "3: today",
      "4: Nothing here yet",
    ]);
  });

  it("leaves identifiers, keys, imports, errors and log lines unread", () => {
    expect(
      readIn(
        [
          'import { x } from "./sources api.ts";',
          'export const KEYS = { "a key with spaces": "kebab-value" };',
          'type Role = "an editor";',
          'export const E = () => <p className="flex items-center">x</p>;',
          'throw new Error("the screen declares no detail address");',
          'log.warn(facts, "the name flag did not go");',
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("the ratchet on pending words", () => {
  const WORDS = "apps/web/src/features/sources/words.ts";
  const counted = (text: string): Counts =>
    ratchetCounts(
      plantedTree({
        [WORDS]: text,
        "apps/web/src/features/sources/table.tsx": `const T = "${BOUND} ${BOUND}";`,
      }),
      [rowOf(BOUND), landedNow(rowOf("screen"))],
    );

  it("counts a pending word in a page's words alone", () => {
    expect(counted(`export const A = "Each ${BOUND} and its ${BOUND}s";`)).toEqual({
      [WORDS]: { [BOUND]: 2 },
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
  const PENDING_ROW: OldWord = {
    word: BOUND,
    use: "connected source",
    entry: "connected source",
    sweep: "connected source",
    state: "pending",
    reach: "everywhere",
  };

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
    {
      fault: "a pending entry with no pending row",
      rows: [avoidedRow("cursor")],
      found: `"connected source" is marked pending, but no pending row names its code's word`,
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
