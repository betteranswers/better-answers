import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { throwawayRepository, writeUnder } from "@better-answers/devtools/throwaway-tree";
import { afterAll, describe, expect, it } from "vitest";

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

// Split at the top level only, so a qualifier's own comma stays inside its item.
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

const avoidedIn = ({ text }: Entry): readonly string[] => {
  const clause = text.split("_Avoid_:")[1];
  if (clause === undefined) return [];
  return itemsOf(clause)
    .map((item) => (item.split(/\(| — /)[0] ?? "").trim().replace(/\.$/, ""))
    .filter((word) => word.length > 0);
};

type Sense = { readonly sense: string; readonly written: RegExp };

// Only a pattern tells the senses apart, so a use no permitted pattern explains is the avoided
// sense, and an unwatched word goes unscanned.
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
        sense: "a third-party app",
        written: /\b(?:GitHub(?: Actions')?|OAuth|MCP|Renovate|chat) app\b/gi,
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
      { sense: "the glossary naming the word it avoids", written: /"the app"|_Avoid_: app\b/gi },
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
  {
    holds: under("contracts/"),
    why: "both tiers' suites assert a fixture's values, so an edit there risks a version bump",
  },
  { holds: under(".cubic/"), why: "Cubic generates it and rewrites it" },
  { holds: under("apps/web/"), why: "no tier-sense use: the word there is the SPA's own zone" },
  {
    holds: under("packages/design-system/"),
    why: "no tier-sense use: the word there is the SPA's own zone",
  },
  { holds: under("packages/schema/"), why: "for now: T-215 sweeps it and removes this line" },
  { holds: under("packages/core/"), why: "for now: T-215 sweeps it and removes this line" },
  { holds: under("apps/api/"), why: "for now: T-216 sweeps it and removes this line" },
];

// A rules file binds every directory, so its sweep is this suite's own and no carve-out holds it.
const isCarvedOut = (file: string): boolean =>
  path.basename(file) !== "CODING_RULES.md" && CARVED_OUT.some(({ holds }) => holds(file));

const escaped = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const usesInAvoidedSense = ({ word, permitted }: Watched, text: string): boolean =>
  new RegExp(`\\b${escaped(word)}\\b`, "i").test(
    permitted.reduce(
      (left, { written }) => left.replace(written, (found) => " ".repeat(found.length)),
      text,
    ),
  );

const watchedIn = (root: string): readonly Watched[] => {
  const entries = entriesOf(readUnder(root, GLOSSARY));
  return WATCHED.filter(({ entry, word }) =>
    entries.some((one) => one.term === entry && avoidedIn(one).includes(word)),
  );
};

const avoidedSenseLines = (root: string): readonly string[] => {
  const watched = watchedIn(root);
  return treeFilesUnder(root)
    .filter((file) => !isCarvedOut(file))
    .flatMap((file) =>
      readUnder(root, file)
        .split("\n")
        .flatMap((text, index) =>
          watched.some((one) => usesInAvoidedSense(one, text))
            ? [`${file}:${String(index + 1)}: ${text.trim()}`]
            : [],
        ),
    );
};

describe("the words the glossary avoids, read from the glossary", () => {
  it("reads the api entry's avoided words, across the line its clause wraps onto", () => {
    const api = entriesOf(readUnder(repositoryRoot, GLOSSARY)).find(({ term }) => term === "api");

    expect(api === undefined ? [] : avoidedIn(api)).toEqual(["app", "the backend", "the server"]);
  });

  it("watches only a word the glossary still avoids, under the entry that avoids it", () => {
    const glossed = watchedIn(repositoryRoot);

    expect(
      WATCHED.filter((one) => !glossed.includes(one)).map(({ entry, word }) => `${entry}: ${word}`),
      "a watched word is no longer in its entry's _Avoid_ line, so the scan has stopped reading it. Take its patterns out with it, or put it back in the glossary.",
    ).toEqual([]);
  });
});

describe("where the tree uses an avoided word in its avoided sense", () => {
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

// Spelled in two halves, so the day this suite's own directory is scanned it does not read its
// fixtures as findings.
const WORD = ["a", "pp"].join("");

const THE_GLOSSARY = [
  "# Glossary",
  "",
  `- **api** — the TypeScript deployable. _Avoid_: ${WORD} (for`,
  "  the tier), the backend, the server.",
  "- **estate** — the running deployment. _Avoid_: environment.",
  "",
].join("\n");

let trees = 0;

const findingsOver = (planted: string, file = "docs/planted.md"): readonly string[] => {
  trees += 1;
  const root = throwawayRepository(path.join(scratch, `tree-${String(trees)}`));
  writeUnder(root, GLOSSARY, THE_GLOSSARY);
  writeUnder(root, file, `${planted}\n`);
  return avoidedSenseLines(root);
};

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
  ])("refuses the tier: %s", (planted) => {
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
  ])("passes a permitted sense: %s", (planted) => {
    expect(findingsOver(planted)).toEqual([]);
  });

  it("passes the glossary's own entry, which names the word it avoids", () => {
    expect(findingsOver("An ordinary line.")).toEqual([]);
  });

  it("reads nothing a carve-out holds but a rules file", () => {
    trees += 1;
    const root = throwawayRepository(path.join(scratch, `tree-${String(trees)}`));
    writeUnder(root, GLOSSARY, THE_GLOSSARY);
    writeUnder(root, "docs/adr/0001-planted.md", `The ${WORD} claims the job.\n`);
    writeUnder(root, "docs/specs/T-001.md", `The ${WORD} claims the job.\n`);
    writeUnder(root, "docs/specs/v01-route.md", `The ${WORD} claims the job.\n`);
    writeUnder(root, "apps/web/src/planted.ts", `// The ${WORD} claims the job.\n`);
    writeUnder(root, "apps/web/CODING_RULES.md", `The ${WORD} claims the job.\n`);

    expect(avoidedSenseLines(root)).toEqual([
      `apps/web/CODING_RULES.md:1: The ${WORD} claims the job.`,
      `docs/specs/v01-route.md:1: The ${WORD} claims the job.`,
    ]);
  });

  it("reads the worker's source, which no carve-out holds", () => {
    expect(findingsOver(`# The ${WORD} claims the job.`, "apps/worker/src/planted.py")).toEqual([
      `apps/worker/src/planted.py:1: # The ${WORD} claims the job.`,
    ]);
  });

  it("stops reading a word the glossary no longer avoids", () => {
    trees += 1;
    const root = throwawayRepository(path.join(scratch, `tree-${String(trees)}`));
    writeUnder(root, GLOSSARY, "- **api** — the TypeScript deployable. _Avoid_: the backend.\n");
    writeUnder(root, "docs/planted.md", `The ${WORD} claims the job.\n`);

    expect(avoidedSenseLines(root)).toEqual([]);
  });
});
