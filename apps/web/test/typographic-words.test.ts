import { describe, expect, it } from "vitest";

import { parsedSource } from "@better-answers/devtools/parsed-source";

import { sourceFiles } from "./source-files.ts";

type Tree = Readonly<Record<string, unknown>>;

const isTree = (value: unknown): value is Tree => typeof value === "object" && value !== null;

const nameOf = (value: unknown): string =>
  isTree(value) && typeof value["name"] === "string" ? value["name"] : "";

/** Tailwind reads a class name and a script a `data-` attribute; a person reads the rest. */
const CODE_ATTRIBUTE = /^(?:className|data-.+)$/;

/** An import's path, a key, a type and a code attribute are the code's own. */
const isCode = (parent: Tree, key: string): boolean =>
  key === "source" ||
  key === "key" ||
  parent["type"] === "TSLiteralType" ||
  (parent["type"] === "JSXAttribute" && CODE_ATTRIBUTE.test(nameOf(parent["name"])));

type Found = (node: Tree, declared: string) => void;

const walk = (value: unknown, declared: string, found: Found): void => {
  if (!isTree(value)) return;
  const within =
    value["type"] === "VariableDeclarator" ? nameOf(value["id"]) || declared : declared;
  found(value, within);
  for (const [key, child] of Object.entries(value)) {
    if (!isCode(value, key)) walk(child, within, found);
  }
};

/** JSX draws `&apos;` and `&quot;` as the straight marks they name. */
const ANY_MARK = /['"]|&(?:apos|quot|#39|#34);/g;

/** A mark with no letter beside it delimits a format a program parses. */
const MARK_BESIDE_A_LETTER = /\p{L}['"]|['"]\p{L}|&(?:apos|quot|#39|#34);/gu;

/** `[role="dialog"]`, in a selector or a Tailwind variant, wherever the string is held. */
const ATTRIBUTE_SELECTOR = /\[[\w-]+[~|^$*]?=(["']).*?\1(?:\s[is])?\]/g;

const withoutSelectors = (text: string): string =>
  text.replace(ATTRIBUTE_SELECTOR, (selector) => " ".repeat(selector.length));

/** Each hole reads as a letter, so a mark beside a hole is a mark beside a word. */
const templateText = (template: Tree, source: string): string => {
  const start = Number(template["start"]);
  const holes = Array.isArray(template["expressions"]) ? template["expressions"] : [];
  return holes.filter(isTree).reduce(
    (text, hole) => {
      const from = text.lastIndexOf("${", Number(hole["start"]) - start);
      const to = text.indexOf("}", Number(hole["end"]) - start) + 1;
      return text.slice(0, from) + "x".repeat(to - from) + text.slice(to);
    },
    source.slice(start, Number(template["end"])),
  );
};

type Piece = { readonly offset: number; readonly text: string; readonly refused: RegExp };

const pieceOf = (node: Tree, source: string): Piece | undefined => {
  const offset = Number(node["start"]);
  if (node["type"] === "JSXText") {
    return { offset, text: source.slice(offset, Number(node["end"])), refused: ANY_MARK };
  }
  if (node["type"] === "TemplateLiteral") {
    const text = withoutSelectors(templateText(node, source));
    return { offset, text, refused: MARK_BESIDE_A_LETTER };
  }
  return node["type"] === "Literal" && typeof node["value"] === "string"
    ? { offset, text: withoutSelectors(node["value"]), refused: MARK_BESIDE_A_LETTER }
    : undefined;
};

type Refused = {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly declared: string;
};

/** Each line holding a straight mark in a string, a template or JSX text a person reads. */
const refusedIn = (file: string, source: string): readonly Refused[] => {
  const { program, lineOf } = parsedSource(file, source);
  const declaredAt = new Map<number, string>();
  walk(program, "", (node, declared) => {
    const piece = pieceOf(node, source);
    if (piece === undefined) return;
    for (const mark of piece.text.matchAll(piece.refused)) {
      declaredAt.set(lineOf(piece.offset + mark.index), declared);
    }
  });
  const lines = source.split("\n");
  return [...declaredAt]
    .map(([line, declared]) => ({ file, line, text: lines[line - 1]?.trim() ?? "", declared }))
    .toSorted((one, other) => one.line - other.line);
};

const named = ({ file, line, text }: Refused): string => `${file}:${String(line)} ${text}`;

type Allowance = { readonly file: string; readonly declared: string; readonly why: string };

/** Code no rule tells from words: a declaration, by its file and its name. */
const CODE_NO_RULE_TELLS: readonly Allowance[] = [];

const allows = (allowance: Allowance, refused: Refused): boolean =>
  allowance.file === refused.file && allowance.declared === refused.declared;

const files = sourceFiles(/\.tsx?$/);

const refused = files.flatMap(({ file, text }) => refusedIn(file, text));

describe("the words the SPA shows", () => {
  it("writes every apostrophe and quote typographically", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(
      refused.filter((one) => !CODE_NO_RULE_TELLS.some((kept) => allows(kept, one))).map(named),
    ).toEqual([]);
  });

  it("keeps no allowance the scan no longer needs", () => {
    expect(CODE_NO_RULE_TELLS.filter((kept) => !refused.some((one) => allows(kept, one)))).toEqual(
      [],
    );
  });
});

const namedIn = (file: string, lines: readonly string[]): readonly string[] =>
  refusedIn(file, lines.join("\n")).map(named);

describe("the scan for straight marks", () => {
  it("refuses a straight apostrophe in a word table", () => {
    const found = namedIn("words.ts", [
      "export const failedPageWords = {",
      `  heading: "This page didn't load",`,
      '  retry: "Try again",',
      "} as const;",
    ]);

    expect(found).toEqual([`words.ts:2 heading: "This page didn't load",`]);
  });

  it("refuses straight double quotes around words in JSX text", () => {
    const found = namedIn("page.tsx", [
      "export const Hint = () => (",
      "  <p>",
      `    Choose "Connect", then sign in.`,
      "  </p>",
      ");",
    ]);

    expect(found).toEqual([`page.tsx:3 Choose "Connect", then sign in.`]);
  });

  it("refuses a possessive a template builds with a straight apostrophe", () => {
    const found = namedIn("words.ts", [
      `export const possessiveOf = (name: string) => \`\${name}'s\`;`,
      `export const quoted = (name: string) => \`Passkey "\${name}" added.\`;`,
      `export const typographic = (name: string) => \`\${name}’s passkey “\${name}”\`;`,
    ]);

    expect(found).toEqual([
      `words.ts:1 export const possessiveOf = (name: string) => \`\${name}'s\`;`,
      `words.ts:2 export const quoted = (name: string) => \`Passkey "\${name}" added.\`;`,
    ]);
  });

  it("refuses a straight apostrophe in an attribute a person reads", () => {
    const found = namedIn("page.tsx", [
      `export const Groups = () => <table aria-label="A group's members" />;`,
    ]);

    expect(found).toEqual([
      `page.tsx:1 export const Groups = () => <table aria-label="A group's members" />;`,
    ]);
  });

  it("refuses a straight mark written as an entity", () => {
    const found = namedIn("page.tsx", [
      "export const Dismissed = () => <p>The seam&apos;s verdict</p>;",
      `export const Steps = () => <ol aria-label="Choose &quot;Connect&quot;" />;`,
    ]);

    expect(found).toEqual([
      "page.tsx:1 export const Dismissed = () => <p>The seam&apos;s verdict</p>;",
      `page.tsx:2 export const Steps = () => <ol aria-label="Choose &quot;Connect&quot;" />;`,
    ]);
  });

  it("passes a selector, an attribute value and an import path", () => {
    const found = namedIn("page.tsx", [
      `import { rows } from "./member's-rows.ts";`,
      `export type Said = "it's";`,
      `export const counts = { "it's": rows.length };`,
      `export const OWNED_ELSEWHERE = 'input, [role="dialog"], [lang|="en" i]';`,
      `export const rowOf = (cell: Element, id: string) => cell.closest(\`[data-row="\${id}"]\`);`,
      `export const Row = () => <tr className="font-['Inter']" data-said="it's" />;`,
      `export const csv = (cells: readonly string[]) => cells.join('","');`,
    ]);

    expect(found).toEqual([]);
  });
});
