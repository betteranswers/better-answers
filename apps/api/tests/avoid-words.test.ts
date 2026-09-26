import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { throwawayRepository, writeUnder } from "@better-answers/devtools/throwaway-tree";

import { readUnder, repositoryRoot, treeFilesUnder } from "./tree-walk.ts";

const GLOSSARY = "CONTEXT.md";

const ENTRY_HEAD = /^- \*\*(?<term>.+?)\*\* — /;

type Entry = { readonly term: string; readonly text: string };

const entriesOf = (glossary: string): readonly Entry[] => {
  const entries: Entry[] = [];
  let open: Entry | undefined;
  for (const line of glossary.split("\n")) {
    const term = ENTRY_HEAD.exec(line)?.groups?.["term"];
    if (term !== undefined) {
      open = { term, text: line };
      entries.push(open);
    } else if (open !== undefined && line.startsWith("  ")) {
      const grown: Entry = { term: open.term, text: `${open.text} ${line.trim()}` };
      entries[entries.length - 1] = grown;
      open = grown;
    } else {
      open = undefined;
    }
  }
  return entries;
};

/** Split at the top level only, so a qualifier's own comma stays inside its item. */
const itemsOf = (clause: string): readonly string[] => {
  const items: string[] = [];
  let depth = 0;
  let item = "";
  for (const character of clause) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && (character === "," || character === ";")) {
      items.push(item);
      item = "";
    } else {
      item += character;
    }
  }
  return [...items, item];
};

type Avoided = { readonly word: string; readonly retired: boolean };

const avoidedItemsIn = ({ text }: Entry): readonly Avoided[] => {
  const clause = text.split("_Avoid_:")[1];
  if (clause === undefined) return [];
  return itemsOf(clause)
    .map((item) => ({
      word: (item.split(/\(| — /)[0] ?? "").trim().replace(/\.$/, ""),
      retired: /\(retired\b/.test(item),
    }))
    .filter(({ word }) => word.length > 0);
};

const avoidedIn = (entry: Entry): readonly string[] =>
  avoidedItemsIn(entry).map(({ word }) => word);

const retiredIn = (entry: Entry): readonly string[] =>
  avoidedItemsIn(entry)
    .filter(({ retired }) => retired)
    .map(({ word }) => word);

/**
 * A sense one directory's code alone writes is read there alone, so its shapes pass
 * nowhere else.
 */
type Sense = { readonly sense: string; readonly written: RegExp; readonly within?: string };

/**
 * Only a pattern tells the senses apart, so a use no permitted pattern explains is the avoided
 * sense, and an unwatched word goes unscanned.
 */
type Watched = {
  readonly entry: string;
  readonly word: string;
  readonly permitted: readonly Sense[];
};

const WATCHED: readonly Watched[] = [
  {
    entry: "api",
    word: "app",
    permitted: [
      { sense: "the whole product", written: /\b(?:an app|Better Answers app)\b/gi },
      { sense: "the SPA", written: /\b(?:single-page|web) app\b/gi },
      {
        sense: "the SPA's top layer, the directory it composes in",
        written: /\bapp (?:layer\b|→)/gi,
      },
      {
        sense: "the hostname role",
        written:
          /(?<!\bthe )\bapp\.(?!\w)|\bapp (?:hostname\b|·)|\*\*app\*\* hostname|\| `app` \||`app` is a hostname role/gi,
      },
      {
        sense: "a third-party app, the consent page's client among them",
        written:
          /\b(?:GitHub(?: Actions')?|OAuth|MCP|Renovate|chat) app\b|\bThis app calls itself\b|"This app"/gi,
      },
      {
        sense: "an identifier: a path, a hyphenated name, a property or setting, a Hono app",
        written:
          /(?<![/:])\/app\b|\bapp\/|-app\b|\bapp-|\bapp\.\w|\b(?:const|let) app\b|\bHono app\b/gi,
      },
      {
        sense: "cocoindex's App: the class, a local or a memo's key holding one, one by its name",
        written:
          /\bcoco\.App\b|\bapp(?:: coco\.App)? = coco\.App\b|["']app["']: (?:\w+_APP\b|["'](?:landed|chunks)["'])|\b(?:landed|chunks) app\b/gi,
      },
      {
        sense:
          "the api's own names: the harness's app() getter, a TestApp held as app and passed on, the app hostname's key",
        within: "apps/api/",
        written:
          /"app"(?!:)|(?<!\.)\bapp\(|\b(?:readonly )?app: (?:TestApp\b|APP_HOSTNAME\b|string\b|hostnameOfUrl\(|"[^"]*")|\bapp = await startApp\(|(?<=\w\((?:\w+, )*)app(?=[,)])|^\s*(?:(?:const \w+ = )?await )?app,?$|\bhostnames\.app\b/gi,
      },
      {
        sense: "the glossary naming the word it avoids",
        written: /"the app" (?:is|reads)\b|_Avoid_: app\b/gi,
      },
    ],
  },
  {
    entry: "audit log",
    word: "ledger",
    permitted: [
      {
        sense: "spend's cost ledger, by its name or the llm_call row it holds",
        written: /cost[-_ ]?ledger|`?llm_call`? ledger\b/gi,
      },
      {
        sense: "the cost ledger's own agreement, whose every edit moves the contract's digest",
        within: "contracts/cost-ledger/",
        written: /\bledger\b/gi,
      },
      {
        sense: "a migration's tag, naming the dated file it was generated as",
        within: "packages/schema/migrations/meta/",
        written: /"tag": "\d{4}_[\w-]+"/g,
      },
      {
        sense: "a company's own books, in the source documents the worker's fixtures stand in for",
        within: "apps/worker/tests/fixtures/",
        written: /\bledger\b/gi,
      },
      {
        sense: "the glossary naming the word it avoids",
        written: /_Avoid_: ledger(?: act)?\b/gi,
      },
    ],
  },
  {
    entry: "audit act",
    word: "ledger act",
    permitted: [
      { sense: "the glossary naming the word it avoids", written: /_Avoid_: ledger act\b/gi },
    ],
  },
];

type CarveOut = { readonly holds: (file: string) => boolean; readonly why: string };

const under =
  (prefix: string) =>
  (file: string): boolean =>
    file.startsWith(prefix);

const CARVED_OUT: readonly CarveOut[] = [
  { holds: under("docs/adr/"), why: "an ADR is a dated record, kept in the words of its day" },
  {
    holds: (file) => file.startsWith("docs/specs/") && file !== "docs/specs/v01-route.md",
    why: "a ticket's spec is a dated record; the route beside them is live and is read",
  },
  {
    holds: (file) => /^packages\/schema\/migrations\/.*\.sql$/.test(file),
    why: "a migration is a dated record, never edited once it has run",
  },
  { holds: under(".cubic/"), why: "Cubic generates it and rewrites it" },
  { holds: under("apps/web/"), why: "no tier-sense use: the word there is the SPA's own zone" },
  {
    holds: under("packages/design-system/"),
    why: "no tier-sense use: the word there is the SPA's own zone",
  },
  {
    holds: (file) => file === "apps/api/tests/avoid-words.test.ts",
    why: "this scan: its patterns spell the word they permit",
  },
];

/**
 * A rules file binds every directory, so its sweep is this suite's own and no carve-out
 * holds it.
 */
const isCarvedOut = (file: string): boolean =>
  path.basename(file) !== "CODING_RULES.md" && CARVED_OUT.some(({ holds }) => holds(file));

const escaped = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A watched word with the test its glossary entry sets for what the permitted senses leave. */
type Scan = { readonly watched: Watched; readonly finds: (unexplained: string) => boolean };

/** `auditRowsOf`, `AUDIT_ACT` and `an_audit_row` read as words, so a retired word is seen inside. */
const wordsOfCompounds = (text: string): string =>
  text.replace(/(?<=[a-z\d])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, " ").replaceAll("_", " ");

/** A word its entry retires outright is refused in every form, a merely avoided one whole alone. */
const findsIn = (word: string, retired: boolean): Scan["finds"] => {
  if (!retired) {
    const whole = new RegExp(`\\b${escaped(word)}\\b`, "i");
    return (unexplained) => whole.test(unexplained);
  }
  const anyForm = new RegExp(`\\b${word.split(" ").map(escaped).join("[\\s-]+")}s?\\b`, "i");
  return (unexplained) => anyForm.test(wordsOfCompounds(unexplained));
};

const usesInAvoidedSense = ({ watched, finds }: Scan, file: string, text: string): boolean =>
  finds(
    watched.permitted
      .filter(({ within }) => within === undefined || file.startsWith(within))
      .reduce(
        (left, { written }) => left.replace(written, (found) => " ".repeat(found.length)),
        text,
      ),
  );

const watchedIn = (root: string): readonly Scan[] => {
  const entries = entriesOf(readUnder(root, GLOSSARY));
  return WATCHED.flatMap((watched) => {
    const entry = entries.find(
      (one) => one.term === watched.entry && avoidedIn(one).includes(watched.word),
    );
    return entry === undefined
      ? []
      : [{ watched, finds: findsIn(watched.word, retiredIn(entry).includes(watched.word)) }];
  });
};

const avoidedSenseLines = (root: string): readonly string[] => {
  const watched = watchedIn(root);
  return treeFilesUnder(root)
    .filter((file) => !isCarvedOut(file))
    .flatMap((file) =>
      readUnder(root, file)
        .split("\n")
        .flatMap((text, index) =>
          watched.some((one) => usesInAvoidedSense(one, file, text))
            ? [`${file}:${String(index + 1)}: ${text.trim()}`]
            : [],
        ),
    );
};

describe("the words the glossary avoids, read from the glossary", () => {
  it("reads the api entry's avoided words across a wrapped line", () => {
    const api = entriesOf(readUnder(repositoryRoot, GLOSSARY)).find(({ term }) => term === "api");

    expect(api === undefined ? [] : avoidedIn(api)).toEqual(["app", "the backend", "the server"]);
  });

  it("reads which avoided words an entry retires outright", () => {
    const retired = entriesOf(readUnder(repositoryRoot, GLOSSARY)).flatMap(retiredIn);

    expect(retired).toEqual(["member id", "ledger act", "ledger"]);
  });

  it("watches only words the glossary still avoids, under their entry", () => {
    const glossed = watchedIn(repositoryRoot).map(({ watched }) => watched);

    expect(
      WATCHED.filter((one) => !glossed.includes(one)).map(({ entry, word }) => `${entry}: ${word}`),
      "a watched word is no longer in its entry's _Avoid_ line, so the scan has stopped reading it. Take its patterns out with it, or put it back in the glossary.",
    ).toEqual([]);
  });
});

describe("where the tree uses a word in its avoided sense", () => {
  it("finds no line outside the carve-outs", () => {
    expect(
      avoidedSenseLines(repositoryRoot),
      "a line uses a word CONTEXT.md avoids, in the sense it avoids it. Write the glossary's word; where the use is a sense the glossary allows, write that sense's pattern beside the entry in WATCHED.",
    ).toEqual([]);
  });
});

const scratch = mkdtempSync(path.join(tmpdir(), "avoid-words-"));
afterAll(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/**
 * Spelled in two halves, so no fixture reads as a finding should the carve-out that holds this file
 * out for its patterns ever be lifted.
 */
const WORD = ["a", "pp"].join("");

/** A retired word, spelled in halves for the same reason, and capitalised as a type opens. */
const RETIRED = ["led", "ger"].join("");
const Retired = `L${RETIRED.slice(1)}`;

const THE_GLOSSARY = [
  "# Glossary",
  "",
  `- **api** — the TypeScript deployable. _Avoid_: ${WORD} (for`,
  "  the tier), the backend, the server.",
  "- **estate** — the running deployment. _Avoid_: environment.",
  `- **audit act** — the name an audit event is recorded under. _Avoid_: ${RETIRED} act (retired`,
  "  24/09/2026), event type.",
  `- **audit log** — the append-only record. _Avoid_: ${RETIRED} (retired 24/09/2026), log (alone).`,
  "",
].join("\n");

let trees = 0;

const findingsIn = (
  files: Readonly<Record<string, string>>,
  glossary = THE_GLOSSARY,
): readonly string[] => {
  trees += 1;
  const root = throwawayRepository(path.join(scratch, `tree-${String(trees)}`));
  writeUnder(root, GLOSSARY, glossary);
  for (const [file, text] of Object.entries(files)) writeUnder(root, file, text);
  return avoidedSenseLines(root);
};

const findingsOver = (planted: string, file = "docs/planted.md"): readonly string[] =>
  findingsIn({ [file]: `${planted}\n` });

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
    `Better Answers is an ${WORD} for a company's knowledge.`,
    `Vite React single-page ${WORD}; talks to the api over tRPC only.`,
    `The web ${WORD} shows the Sources screen.`,
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
    `# The binding's store: the chunks ${WORD} and its target-state tracking.`,
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

  it("passes the glossary's own entry naming the word it avoids", () => {
    expect(findingsOver("An ordinary line.")).toEqual([]);
  });

  it("reads nothing a carve-out holds but a rules file", () => {
    const findings = findingsIn({
      "docs/adr/0001-planted.md": `The ${WORD} claims the job.\n`,
      "docs/specs/T-001.md": `The ${WORD} claims the job.\n`,
      "docs/specs/v01-route.md": `The ${WORD} claims the job.\n`,
      "apps/web/src/planted.ts": `// The ${WORD} claims the job.\n`,
      "apps/web/CODING_RULES.md": `The ${WORD} claims the job.\n`,
    });

    expect(findings).toEqual([
      `apps/web/CODING_RULES.md:1: The ${WORD} claims the job.`,
      `docs/specs/v01-route.md:1: The ${WORD} claims the job.`,
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

  it("reads the api's source and tests, except this scan", () => {
    const findings = findingsIn({
      "apps/api/src/planted.ts": `// The ${WORD} claims the job.\n`,
      "apps/api/tests/planted.test.ts": `// The ${WORD} claims the job.\n`,
      "apps/api/tests/avoid-words.test.ts": `// The ${WORD} claims the job.\n`,
    });

    expect(findings).toEqual([
      `apps/api/src/planted.ts:1: // The ${WORD} claims the job.`,
      `apps/api/tests/planted.test.ts:1: // The ${WORD} claims the job.`,
    ]);
  });

  it("stops reading a word the glossary no longer avoids", () => {
    const findings = findingsIn(
      { "docs/planted.md": `The ${WORD} claims the job.\n` },
      "- **api** — the TypeScript deployable. _Avoid_: the backend.\n",
    );

    expect(findings).toEqual([]);
  });
});

describe("a word retired outright, beside one merely avoided", () => {
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

  it("passes a company's own books in the worker's fixtures alone", () => {
    const planted = `and the ${RETIRED} is the record the claim rests on`;

    expect(findingsOver(planted, "apps/worker/tests/fixtures/terms.txt")).toEqual([]);
    expect(findingsOver(planted)).toEqual([`docs/planted.md:1: ${planted}`]);
  });

  it("reads a word merely avoided whole, never inside a compound", () => {
    expect(findingsOver(`const my_${WORD}_name = ${WORD}Router;`)).toEqual([]);
  });

  it("refuses a retired two-word item inside a compound", () => {
    const findings = findingsIn(
      { "docs/planted.md": `type ${Retired}Act = string;\nThe ${RETIRED} holds it.\n` },
      `- **audit act** — the name. _Avoid_: ${RETIRED} act (retired).\n`,
    );

    expect(findings).toEqual([`docs/planted.md:1: type ${Retired}Act = string;`]);
  });

  it("reads the word whole once its entry stops retiring it", () => {
    const findings = findingsIn(
      { "docs/planted.md": `${RETIRED}RowsOf\nThe ${RETIRED} holds it.\n` },
      `- **audit log** — the record. _Avoid_: ${RETIRED}, log.\n`,
    );

    expect(findings).toEqual([`docs/planted.md:2: The ${RETIRED} holds it.`]);
  });
});
