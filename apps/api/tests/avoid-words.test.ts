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

// A sense one directory's code alone writes is read there alone, so its shapes pass nowhere else.
type Sense = { readonly sense: string; readonly written: RegExp; readonly within?: string };

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

// A rules file binds every directory, so its sweep is this suite's own and no carve-out holds it.
const isCarvedOut = (file: string): boolean =>
  path.basename(file) !== "CODING_RULES.md" && CARVED_OUT.some(({ holds }) => holds(file));

const escaped = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const usesInAvoidedSense = ({ word, permitted }: Watched, file: string, text: string): boolean =>
  new RegExp(`\\b${escaped(word)}\\b`, "i").test(
    permitted
      .filter(({ within }) => within === undefined || file.startsWith(within))
      .reduce(
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
          watched.some((one) => usesInAvoidedSense(one, file, text))
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

// Spelled in two halves, so no fixture reads as a finding should the carve-out that holds this
// file out for its patterns ever be lifted.
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
    `const bootstrap = requireBootstrap("the ${WORD}");`,
    `logger.info({ port: address.port }, "${WORD} listening");`,
    `throw new Error("the browser suite's ${WORD} needs a port as its one argument");`,
    `It starts ${WORD}, worker and migrate in that order.`,
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
    `<p>This ${WORD} calls itself “Claude”. It is hosted at <strong>claude.ai</strong>.</p>`,
    `      : undefined) ?? "This ${WORD}",`,
  ])("passes a permitted sense: %s", (planted) => {
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
  ])("passes the api's own names in apps/api, and nowhere else: %s", (planted) => {
    expect(findingsOver(planted, "apps/api/src/planted.ts")).toEqual([]);
    expect(findingsOver(planted)).toEqual([`docs/planted.md:1: ${planted.trim()}`]);
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

  it("reads the api's source and tests, and holds out only this scan", () => {
    trees += 1;
    const root = throwawayRepository(path.join(scratch, `tree-${String(trees)}`));
    writeUnder(root, GLOSSARY, THE_GLOSSARY);
    writeUnder(root, "apps/api/src/planted.ts", `// The ${WORD} claims the job.\n`);
    writeUnder(root, "apps/api/tests/planted.test.ts", `// The ${WORD} claims the job.\n`);
    writeUnder(root, "apps/api/tests/avoid-words.test.ts", `// The ${WORD} claims the job.\n`);

    expect(avoidedSenseLines(root)).toEqual([
      `apps/api/src/planted.ts:1: // The ${WORD} claims the job.`,
      `apps/api/tests/planted.test.ts:1: // The ${WORD} claims the job.`,
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
