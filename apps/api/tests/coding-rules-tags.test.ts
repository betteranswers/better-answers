import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const RULE_TAG = /\[(?<tag>[A-Z][A-Z0-9]*[A-Z][0-9]+)\]/g;
const RULE_HEADING = /^#{2,3}\s+\[(?<tag>[A-Z][A-Z0-9]*[A-Z][0-9]+)\]/gm;

const NOT_TEXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz|sqlite)$/i;
const OUTSIDE = [".scratch/", ".cubic/"];

// Reading a tracked symlink would follow it to a directory and throw; whatever it points at
// is walked on its own account.
const isLink = (file: string): boolean =>
  lstatSync(path.join(repositoryRoot, file)).isSymbolicLink();

// `--others --exclude-standard` sees a new file before it is added, so the walk reads the
// tree a commit would carry.
const treeFiles = (): readonly string[] =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => file.length > 0)
    .filter((file) => !OUTSIDE.some((prefix) => file.startsWith(prefix)))
    .filter((file) => !NOT_TEXT.test(file))
    .filter((file) => !isLink(file));

const read = (file: string): string => readFileSync(path.join(repositoryRoot, file), "utf8");

const isRulesFile = (file: string): boolean => path.basename(file) === "CODING_RULES.md";

// Exempt only inside the string the gate prints, so a tag in a comment or a name in the
// same file still fails.
const QUOTES = new Set(['"', "'", "`"]);

// Only a closed pair is a string, so an apostrophe in prose opens nothing — though two
// bracketing a tag still read as one.
const quotedSpansOf = (text: string): readonly (readonly [number, number])[] => {
  const spans: [number, number][] = [];
  let open: string | undefined;
  let from = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (open !== undefined && character === "\\") {
      index += 1;
      continue;
    }
    if (character === undefined || !QUOTES.has(character)) continue;
    if (open === undefined) {
      open = character;
      from = index;
    } else if (character === open) {
      spans.push([from, index]);
      open = undefined;
    }
  }
  return spans;
};

const insideAString = (text: string, at: number): boolean =>
  quotedSpansOf(text).some(([from, to]) => from < at && at < to);

// Each of these prints the rule it holds in the message a reader hits, so the reader reaches
// the rule without asking.
const GATES_PRINTING_A_TAG: readonly string[] = [
  "apps/worker/tests/conftest.py",
  "packages/devtools/lint-rules/rules/act-admits-before-await.ts",
  "packages/devtools/lint-rules/rules/comment-only-the-why.ts",
  "packages/devtools/lint-rules/rules/import-direction.ts",
  "packages/devtools/lint-rules/rules/mcp-entry-no-workspace-argument.ts",
  "packages/devtools/python/comment_gate.py",
  "packages/devtools/src/comment-density.ts",
  "packages/devtools/src/insert-scan.ts",
];

type Citation = {
  readonly file: string;
  readonly line: number;
  readonly tag: string;
  readonly text: string;
  readonly at: number;
};

const citationsIn = (file: string): readonly Citation[] =>
  read(file)
    .split("\n")
    .flatMap((text, index) =>
      [...text.matchAll(RULE_TAG)].flatMap((match) => {
        const tag = match.groups?.["tag"];
        return tag === undefined ? [] : [{ file, line: index + 1, tag, text, at: match.index }];
      }),
    );

const definedTags = (): ReadonlyMap<string, string> =>
  new Map(
    treeFiles()
      .filter(isRulesFile)
      .flatMap((file) =>
        [...read(file).matchAll(RULE_HEADING)].flatMap((match) => {
          const tag = match.groups?.["tag"];
          return tag === undefined ? [] : [[tag, file] as const];
        }),
      ),
  );

const cite = ({ file, line, tag }: Citation): string => `${file}:${line} cites [${tag}]`;

const isAllowedCitation = ({ file, text, at }: Citation): boolean =>
  isRulesFile(file) || (GATES_PRINTING_A_TAG.includes(file) && insideAString(text, at));

// The walk reads `git ls-files --others`, so a written file is seen as a committed one; the
// `finally` keeps the next suite from reading it.
const whileAFileNamed = <T>(relative: string, contents: string, taken: () => T): T => {
  const written = path.join(repositoryRoot, relative);
  writeFileSync(written, contents);
  try {
    return taken();
  } finally {
    rmSync(written, { force: true });
  }
};

const whileARulesFileHolds = <T>(contents: string, taken: () => T): T =>
  whileAFileNamed("apps/api/tests/CODING_RULES.md", contents, taken);

const whileADocumentHolds = <T>(contents: string, taken: () => T): T =>
  whileAFileNamed("apps/api/tests/tag-definition-proof.md", contents, taken);

const strayFiles = (): ReadonlySet<string> =>
  new Set(
    treeFiles()
      .flatMap(citationsIn)
      .filter((citation) => !isAllowedCitation(citation))
      .map(({ file }) => file),
  );

const filesGoingStrayWhile = (relative: string, contents: string): readonly string[] => {
  const before = strayFiles();
  const after = whileAFileNamed(relative, contents, strayFiles);
  return [...after].filter((file) => !before.has(file));
};

const aCitingLine = (tag: string): string =>
  `A sentence that cites [${tag}] rather than the rule.\n`;

// The rule names three places; a review finding is no file, so a walk of the tree sees two.
describe("where a rule tag may be written", () => {
  it("finds one only in a rules file or a gate's failure message", () => {
    const stray = treeFiles()
      .flatMap(citationsIn)
      .filter((citation) => !isAllowedCitation(citation));

    expect(
      stray.map(cite),
      "a rule tag is written outside the two places in the tree one belongs. Write the rule in words where the reader meets it, or delete the sentence; never swap the tag for a restatement of the rule's own wording.",
    ).toEqual([]);
  });

  it("passes a tag a rules file the tree has just gained writes", () => {
    const [aDefinedTag] = [...definedTags().keys()];
    expect(aDefinedTag).toBeDefined();

    expect(
      filesGoingStrayWhile("apps/api/tests/CODING_RULES.md", aCitingLine(aDefinedTag ?? "")),
    ).toEqual([]);
  });

  it("refuses a tag an architecture decision record the tree has just gained writes", () => {
    const [aDefinedTag] = [...definedTags().keys()];
    expect(aDefinedTag).toBeDefined();

    expect(
      filesGoingStrayWhile("docs/adr/tag-location-proof.md", aCitingLine(aDefinedTag ?? "")),
    ).toEqual(["docs/adr/tag-location-proof.md"]);
  });

  it("refuses a tag a spec the tree has just gained writes", () => {
    const [aDefinedTag] = [...definedTags().keys()];
    expect(aDefinedTag).toBeDefined();

    expect(
      filesGoingStrayWhile("docs/specs/tag-location-proof.md", aCitingLine(aDefinedTag ?? "")),
    ).toEqual(["docs/specs/tag-location-proof.md"]);
  });
});

describe("the tags a gate prints and the rules files that define them", () => {
  it("defines every tag a gate's failure message names", () => {
    const defined = definedTags();
    const printed = GATES_PRINTING_A_TAG.flatMap(citationsIn);

    expect(printed.length).toBeGreaterThan(0);
    expect(
      printed.filter(({ tag }) => !defined.has(tag)).map(cite),
      "a gate prints a tag no rules file defines. Either the rule was retired and the message is rewritten in words, or the heading in the rules file lost its tag.",
    ).toEqual([]);
  });

  it("defines every tag a rules file cites in another rule's body", () => {
    const defined = definedTags();
    const cited = treeFiles().filter(isRulesFile).flatMap(citationsIn);

    expect(
      cited.filter(({ tag }) => !defined.has(tag)).map(cite),
      "a rules file points at a rule no rules file defines. The rule was retired: say in words what the sentence needs, or delete the cross-reference with it.",
    ).toEqual([]);
  });

  it("exempts a gate only where the tag sits inside the string it prints", () => {
    const [aGate] = GATES_PRINTING_A_TAG;
    expect(aGate).toBeDefined();
    const spelled = `[${"TEST"}${"3"}]`;
    const at = (text: string): Citation => ({
      file: aGate ?? "",
      line: 1,
      tag: "TEST3",
      text,
      at: text.indexOf(spelled),
    });

    expect(isAllowedCitation(at(`raise AssertionError("${spelled}: our own code")`))).toBe(true);
    expect(isAllowedCitation(at(`const message = \`over the ceiling (${spelled}).\`;`))).toBe(true);
    expect(isAllowedCitation(at(`# the ${spelled} this file holds`))).toBe(false);
    expect(isAllowedCitation(at(`raise AssertionError("mocked")  # ${spelled} holds this`))).toBe(
      false,
    );
    expect(isAllowedCitation(at(`# the rule's message names ${spelled}`))).toBe(false);
    expect(isAllowedCitation(at(`"a face packages/core's map misses (${spelled})"`))).toBe(true);
  });

  it("reads tags from every rules file", () => {
    const files = new Set(definedTags().values());

    expect(files).toContain("CODING_RULES.md");
    expect(files).toContain("apps/api/CODING_RULES.md");
    expect(files).toContain("apps/web/CODING_RULES.md");
    expect(files).toContain("apps/worker/CODING_RULES.md");
    expect(files).toContain("deploy/CODING_RULES.md");
  });

  it("reads a well-formed heading outside a rules file as no definition at all", () => {
    const before = new Set(definedTags().keys());
    const after = whileADocumentHolds(
      `## [${"PROBE"}${"1"}] A heading in the right shape, in the wrong file\n\n`,
      () => new Set(definedTags().keys()),
    );

    expect([...after].filter((tag) => !before.has(tag))).toEqual([]);
  });

  it("reads a well-formed heading as a definition and a malformed one as none", () => {
    const heading = (tag: string, title: string): string => `## [${tag}] ${title}\n\n`;
    const before = new Set(definedTags().keys());
    const after = whileARulesFileHolds(
      heading("PROBE1", "A family of two capitals, then a number") +
        heading("Probe2", "Lower case inside the family") +
        heading("PROBE", "No number") +
        heading("P1", "One letter"),
      () => new Set(definedTags().keys()),
    );

    expect([...after].filter((tag) => !before.has(tag))).toEqual(["PROBE1"]);
  });
});

const PROOF = "apps/api/tests/tag-location-proof.txt";

const printingNothing = (list: readonly string[]): readonly string[] =>
  list.filter((file) => citationsIn(file).length === 0);

describe("the gates this walk reads a tag past", () => {
  it("names a file the tree still carries in every entry", () => {
    const tracked = new Set(treeFiles());

    expect(
      GATES_PRINTING_A_TAG.filter((file) => !tracked.has(file)),
      "a listed gate is gone from the tree. An entry leaves with the file it named; a stale one is an exemption with no gate behind it.",
    ).toEqual([]);
  });

  it("names a file that still prints a tag in every entry", () => {
    expect(
      printingNothing(GATES_PRINTING_A_TAG),
      "a listed gate prints no tag any more. Remove its entry in the commit that rewrote the message: an exemption no message needs is one a later citation hides behind.",
    ).toEqual([]);
  });

  it("refuses an entry whose gate has stopped printing one", () => {
    const quiet = whileAFileNamed(PROOF, "A message that names its rule in words.\n", () =>
      printingNothing([...GATES_PRINTING_A_TAG, PROOF]),
    );

    expect(quiet).toEqual([PROOF]);
  });
});
