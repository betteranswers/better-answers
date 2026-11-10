import { beforeAll, describe, expect, it } from "vitest";

import { pluginConfigFor } from "@better-answers/devtools/oxlint-config";
import { oxlintBatchOver } from "@better-answers/devtools/throwaway-tree";
import type { PlannedLint, Tree } from "@better-answers/devtools/throwaway-tree";

import { BANNED_PATTERNS } from "../../lint-rules/rules/ui-copy-plain.ts";
import { wordsOf } from "../support/fixture-text.ts";

const RULE = "better-answers/ui-copy-plain";
const FILE = "apps/web/src/words.ts";

const MESSAGE =
  "UI copy names the action or the fact and stops. Use sentence case ('Edit concept'), cut definitions and explanations of absence, and keep a description to one sentence. Put a definition in GLOSSARY.md, not on the page.";

const CONFIG = pluginConfigFor({ [RULE]: "error" });

const batch = oxlintBatchOver();

const lint = (tree: Tree): PlannedLint => batch.plan(tree, CONFIG);

const saying = (text: string): Tree => ({
  [FILE]: `export const words = ${JSON.stringify(text)};\n`,
});

const planned = (text: string): PlannedLint => lint(saying(text));

type Row = readonly [what: string, text: string];

const plan = (rows: readonly Row[]): readonly (readonly [string, PlannedLint])[] =>
  rows.map(([what, text]) => [what, planned(text)]);

const EXPORT_DESCRIPTION =
  "A document with a guide’s Briefs, dated and marked as not maintained. It won’t update when the guide changes. Each Brief in it is recorded as used.";

const TAILWIND =
  "flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] aria-invalid:border-destructive disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30 [&_svg]:size-4 [&_svg]:shrink-0 font-sans! leading-6! text-xs";

const NOT_COPY: readonly Row[] = [
  ["a long Tailwind class string", TAILWIND],
  ["a pair of CSS variables", "var(--color-ink) var(--color-paper-2)"],
  ["SVG path data", "M0 0 L10 10 Z"],
  ["a date format", "d MMMM yyyy 'at' HH:mm"],
  ["a keyboard shortcut list", "Meta+K Control+K"],
  ["a URL", "https://app.better-answers.com/knowledge/concepts"],
  ["a key", "verified-by"],
];

const SYNTAX: readonly (readonly [string, string, string])[] = [
  [
    "a Tailwind class in a className",
    "apps/web/src/chip.tsx",
    `export const Chip = () => <div className="${TAILWIND}" />;\n`,
  ],
  [
    "a Tailwind class in a cn call",
    "apps/web/src/chip.ts",
    `export const chip = cn("${TAILWIND}", active && "bg-accent");\n`,
  ],
  [
    "an import specifier",
    "apps/web/src/a.ts",
    'import { x } from "./Some Odd Name.ts";\nexport const y = x;\n',
  ],
  ["an export specifier", "apps/web/src/b.ts", 'export * from "./Some Odd Name.ts";\n'],
  [
    "a dynamic import specifier",
    "apps/web/src/c.ts",
    'export const load = () => import("./Some Odd Name.ts");\n',
  ],
  ["a property key", "apps/web/src/d.ts", 'export const keys = { "Some Odd Key": 1 };\n'],
  [
    "a computed property key",
    "apps/web/src/f.ts",
    'export const keys = { ["Some Odd Key"]: 1 };\n',
  ],
  [
    "a lower case fragment of a sentence",
    "apps/web/src/h.ts",
    'export const gone = "a former member";\n',
  ],
  [
    "the product name opening a label",
    "apps/web/src/i.tsx",
    "export const Help = () => <span>better-answers support</span>;\n",
  ],
  [
    "a developer error message",
    "apps/web/src/e.ts",
    'export const fail = () => new Error("useCarousel must be used within a <Carousel />");\n',
  ],
];

const EXEMPT_TESTS: readonly (readonly [string, string])[] = [
  ["a file in a test folder", "apps/web/test/words.ts"],
  ["a file named for a test", "apps/web/src/words.test.ts"],
  ["a file in an e2e folder", "apps/web/e2e/words.ts"],
];

const REFUSED: readonly Row[] = [
  ["the export description", EXPORT_DESCRIPTION],
  [
    "an explanation of an empty section",
    "No fact is missing from this section, so there is nothing to add.",
  ],
];

const REWRITES: readonly Row[] = [
  ["the export description", "A dated copy of a guide’s Briefs."],
  ["an area name", "Knowledge base"],
  ["a plain absence", "No missing facts"],
];

const BANNED: readonly Row[] = [
  ["a part-of definition", "The sector is one part of the company"],
  ["an explanation of nothing to add", "Nothing changed, so there is nothing to add"],
  ["an as-it-stands explanation", "This list is empty as it stands"],
  ["a bare Manage summary", "Manage people."],
  ["a definition sentence", "A guide is a set of pages"],
  ["a definition after a sentence", "Open a guide. A section is where facts go"],
];

const LIMITS_REFUSED: readonly Row[] = [
  ["three sentences", "Save the concept. Check the sources. Publish when ready."],
  ["twenty-six words", `Start ${wordsOf(25)}`],
];

const LIMITS_ACCEPTED: readonly Row[] = [
  ["two sentences", "Save the concept. Publish when ready."],
  ["twenty-five words", `Start ${wordsOf(24)}`],
  ["a statement with a noun and a verb", "A suggestion is waiting"],
  ["a short sentence with a full stop", "Manage people and groups."],
];

batch.control(saying("Manage people."), CONFIG, [FILE]);

const flaggedManage = planned("Manage people.");

const refusals = plan(REFUSED);
const rewrites = plan(REWRITES);
const banned = plan(BANNED);
const limitsRefused = plan(LIMITS_REFUSED);
const limitsAccepted = plan(LIMITS_ACCEPTED);
const notCopy = plan(NOT_COPY);

const syntax = SYNTAX.map(([what, file, code]) => [what, lint({ [file]: code })] as const);

const inTests = EXEMPT_TESTS.map(
  ([what, file]) => [what, lint({ [file]: 'export const words = "Manage people.";\n' })] as const,
);

const jsx = lint({
  "apps/web/src/button.tsx": "export const Button = () => <button>Manage people.</button>;\n",
});
const jsxPlain = lint({
  "apps/web/src/button.tsx":
    "export const Button = () => <button>Manage people and groups.</button>;\n",
});
const jsxLowerCase = lint({
  "apps/web/src/button.tsx": "export const Button = () => <button>edit concept</button>;\n",
});
const attributeLowerCase = lint({
  "apps/web/src/field.tsx": 'export const Field = () => <input aria-label="edit concept" />;\n',
});
const jsxAttribute = lint({
  "apps/web/src/field.tsx": 'export const Field = () => <input title="Manage people." />;\n',
});
const template = lint({
  [FILE]: "export const words = (device: string): string => `Manage ${device}.`;\n",
});
const templatePlain = lint({
  [FILE]: "export const words = (device: string): string => `Manage ${device} and groups.`;\n",
});
const templatePlaceholder = lint({
  [FILE]: "export const words = (title: string): string => `Edit ${title} now`;\n",
});

beforeAll(batch.run);

describe("the plain copy rule refuses over-written copy", () => {
  it("names the fix and the rule in its error", () => {
    const output = flaggedManage.output();

    expect(output).toContain(MESSAGE);
    expect(output).toContain("better-answers(ui-copy-plain)");
  });

  it.each(refusals)("refuses %s", (_what, found) => {
    expect(found.flagged()).toEqual([FILE]);
  });

  it.each(rewrites)("accepts the rewrite: %s", (_what, found) => {
    expect(found.flagged()).toEqual([]);
  });
});

describe("the plain copy rule refuses the banned patterns", () => {
  it.each(banned)("refuses %s", (_what, found) => {
    expect(found.flagged()).toEqual([FILE]);
  });

  it("keeps every banned pattern stateless and Unicode aware", () => {
    for (const pattern of BANNED_PATTERNS) {
      expect(pattern.unicode).toBe(true);
      expect(pattern.global).toBe(false);
      expect(pattern.sticky).toBe(false);
    }
  });
});

describe("the plain copy rule limits a string", () => {
  it.each(limitsRefused)("refuses %s", (_what, found) => {
    expect(found.flagged()).toEqual([FILE]);
  });

  it.each(limitsAccepted)("accepts %s", (_what, found) => {
    expect(found.flagged()).toEqual([]);
  });
});

describe("the plain copy rule reads every kind of text", () => {
  it("reads the text of a JSX element", () => {
    expect(jsx.flagged()).toEqual(["apps/web/src/button.tsx"]);
    expect(jsxPlain.flagged()).toEqual([]);
  });

  it("reads the text of a JSX attribute", () => {
    expect(jsxAttribute.flagged()).toEqual(["apps/web/src/field.tsx"]);
  });

  it("refuses a label shown in lower case", () => {
    expect(jsxLowerCase.flagged()).toEqual(["apps/web/src/button.tsx"]);
    expect(attributeLowerCase.flagged()).toEqual(["apps/web/src/field.tsx"]);
  });

  it("reads a template literal around its placeholders", () => {
    expect(template.flagged()).toEqual([FILE]);
    expect(templatePlain.flagged()).toEqual([]);
    expect(templatePlaceholder.flagged()).toEqual([]);
  });
});

describe("the plain copy rule leaves non-copy alone", () => {
  it.each(notCopy)("accepts %s", (_what, found) => {
    expect(found.flagged()).toEqual([]);
  });

  it.each(syntax)("accepts %s", (_what, found) => {
    expect(found.flagged()).toEqual([]);
  });

  it.each(inTests)("exempts %s", (_what, found) => {
    expect(found.flagged()).toEqual([]);
  });
});
