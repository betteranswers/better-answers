import { readFileSync } from "node:fs";
import path from "node:path";

import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { ROLES } from "@better-answers/schema/roles";

import { isTestPath, repositoryRoot } from "../../src/paths.ts";

type Phrase = readonly string[];

type Text = ESTree.StringLiteral | ESTree.TemplateLiteral | ESTree.JSXText;

type Word = {
  readonly core: string;
  readonly opensSentence: boolean;
  readonly joinsBefore: boolean;
  readonly joinsAfter: boolean;
};

const SENTENCE_LIMIT = 2;

const WORD_LIMIT = 25;

const A_SPACES = /\s+/gu;

const A_WORD = /[\p{L}\p{N}]/u;

const A_LETTER = /\p{L}/u;

const A_EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

const A_POSSESSIVE = /[’']s$/u;

const A_TITLE_WORD = /^\p{Lu}\p{Ll}+(?:[-’']\p{L}+)*$/u;

const A_CAPITAL = /^\p{Lu}/u;

const A_SENTENCE_END = /[.!?][)"”’'\]]*$/u;

const A_LEADING_MARK = /^[^\p{L}\p{N}]/u;

const A_TRAILING_MARK = /[^\p{L}\p{N}]$/u;

const A_TERM_LINE = /^\*\*[^*]+\*\*:$/u;

const A_TRUST_LINE = /^- Trust words are a closed set[^:\n]*: (?<words>.+)\.$/mu;

const A_PLACEHOLDER = /\s*<[^>]*>/gu;

const A_ERROR_CLASS = /Error$/u;

const A_FULL_STOP = /\.(?:\s|$)/u;

const A_SEGMENT_BREAK = / · |: | — | – | \| |(?<=[?!])\s+/u;

const A_SENTENCE_BREAK = /(?<=[.!?])\s+/u;

const A_STARTS_UPPER = /^[^\p{L}]*\p{Lu}/u;

const PLACEHOLDER_WORD = "item";

export const BANNED_PATTERNS: readonly RegExp[] = [
  /\bis one part of\b/iu,
  /\bso there is nothing\b/iu,
  /\bas it stands\b/iu,
  /^Manage \p{L}+\.$/u,
  /(?:^|[.!?] )An? \p{Ll}+ is (?:a|an|the|one|what|where|when|how)\b/u,
];

const coreOf = (token: string): string => token.replaceAll(A_EDGE, "").replace(A_POSSESSIVE, "");

const wordsOf = (text: string): readonly string[] =>
  text.split(A_SPACES).filter((token) => A_WORD.test(token));

const sourceText = (file: string): string => readFileSync(path.join(repositoryRoot, file), "utf8");

const unparsed = (file: string, expected: string): Error =>
  new Error(
    `${file}: expected ${expected}, and found none. The UI copy allow-list in ui-copy-plain.ts is built from this file, so fix the parser or restore the text.`,
  );

const wordsIn = (paragraph: string): readonly Word[] => {
  const tokens = paragraph.split(A_SPACES).filter((token) => token !== "");
  return tokens.map((token, at) => ({
    core: coreOf(token),
    opensSentence: at === 0 || A_SENTENCE_END.test(tokens[at - 1] ?? ""),
    joinsBefore: !A_LEADING_MARK.test(token),
    joinsAfter: !A_TRAILING_MARK.test(token),
  }));
};

type Run = { readonly words: string[]; readonly keep: boolean };

const runsIn = (words: readonly Word[]): readonly Phrase[] => {
  const phrases: Phrase[] = [];
  let open: Run | undefined;
  const close = (): void => {
    if (open?.keep === true) phrases.push(open.words);
    open = undefined;
  };
  for (const word of words) {
    if (!A_CAPITAL.test(word.core)) {
      close();
      continue;
    }
    if (open === undefined || !word.joinsBefore) {
      close();
      open = { words: [], keep: !word.opensSentence };
    }
    open.words.push(word.core);
    if (!word.joinsAfter) close();
  }
  close();
  return phrases;
};

const definitionParagraphs = (text: string): readonly string[] =>
  text.split(/\n[ \t]*\n/u).map((block) =>
    block
      .split("\n")
      .filter((line) => !line.startsWith("#") && !A_TERM_LINE.test(line))
      .join(" "),
  );

const glossaryPhrases = (): readonly Phrase[] =>
  definitionParagraphs(sourceText("GLOSSARY.md")).flatMap((paragraph) =>
    runsIn(wordsIn(paragraph)),
  );

const trustPhrases = (): readonly Phrase[] => {
  const line = A_TRUST_LINE.exec(sourceText("PRODUCT.md"))?.groups?.["words"];
  if (line === undefined) {
    throw unparsed("PRODUCT.md", 'a line that starts "- Trust words are a closed set"');
  }
  return line
    .split(" · ")
    .map((words) => words.replaceAll(A_PLACEHOLDER, "").trim().split(A_SPACES));
};

const nonEmpty = (
  file: string,
  expected: string,
  phrases: readonly Phrase[],
): readonly Phrase[] => {
  if (phrases.length === 0) throw unparsed(file, expected);
  return phrases;
};

const longestFirst = (phrases: readonly Phrase[]): readonly Phrase[] =>
  [...new Map(phrases.map((phrase) => [phrase.join(" "), phrase])).values()].toSorted(
    (left, right) => right.length - left.length,
  );

export const ALLOWED_PHRASES: readonly Phrase[] = longestFirst([
  ...nonEmpty("GLOSSARY.md", "capitalised words inside its definitions", glossaryPhrases()),
  ...ROLES.map((role): Phrase => [role]),
  ...nonEmpty("PRODUCT.md", "a list of trust words", trustPhrases()),
]);

const phraseAt = (cores: readonly string[], at: number): Phrase | undefined =>
  ALLOWED_PHRASES.find((phrase) => phrase.every((word, offset) => cores[at + offset] === word));

const hasStrayCapital = (cores: readonly string[]): boolean => {
  let at = 0;
  while (at < cores.length) {
    const phrase = phraseAt(cores, at);
    if (phrase !== undefined) at += phrase.length;
    else if (at > 0 && A_TITLE_WORD.test(cores[at] ?? "")) return true;
    else at += 1;
  }
  return false;
};

const isTitleCasedLabel = (text: string): boolean =>
  !A_FULL_STOP.test(text) &&
  text.split(A_SEGMENT_BREAK).some((segment) => hasStrayCapital(wordsOf(segment).map(coreOf)));

const isBanned = (text: string): boolean => BANNED_PATTERNS.some((pattern) => pattern.test(text));

const runsLong = (text: string): boolean =>
  A_STARTS_UPPER.test(text) &&
  (wordsOf(text).length > WORD_LIMIT || text.split(A_SENTENCE_BREAK).length > SENTENCE_LIMIT);

const REFUSALS: readonly ((text: string) => boolean)[] = [isTitleCasedLabel, isBanned, runsLong];

const isProse = (text: string): boolean => text.includes(" ") && A_LETTER.test(text);

const isSpecifier = (node: Text): boolean => {
  const { parent } = node;
  return (
    parent.type === "ImportDeclaration" ||
    parent.type === "ExportAllDeclaration" ||
    parent.type === "ExportNamedDeclaration" ||
    parent.type === "ImportExpression"
  );
};

const isPropertyKey = (node: Text): boolean => {
  const { parent } = node;
  return parent.type === "Property" && parent.key === node && !parent.computed;
};

const isErrorMessage = (node: Text): boolean => {
  const { parent } = node;
  return (
    parent.type === "NewExpression" &&
    parent.callee.type === "Identifier" &&
    A_ERROR_CLASS.test(parent.callee.name)
  );
};

const NOT_COPY: readonly ((node: Text) => boolean)[] = [isSpecifier, isPropertyKey, isErrorMessage];

const templateText = (node: ESTree.TemplateLiteral): string =>
  node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(PLACEHOLDER_WORD);

export const uiCopyPlainRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "UI copy names the action or the fact and stops: sentence case, no definitions, no explanations of absence, and one sentence of description. Tests are exempt.",
    },
    messages: {
      plain:
        "UI copy names the action or the fact and stops. Use sentence case ('Edit concept'), cut definitions and explanations of absence, and keep a description to one sentence. Put a definition in GLOSSARY.md, not on the page.",
    },
  },
  createOnce(context) {
    const check = (node: Text, written: string): void => {
      const text = written.replaceAll(A_SPACES, " ").trim();
      if (!isProse(text) || NOT_COPY.some((isNot) => isNot(node))) return;
      if (REFUSALS.some((refuses) => refuses(text))) context.report({ node, messageId: "plain" });
    };

    return {
      before(): boolean {
        return !isTestPath(path.relative(context.cwd, context.filename).split(path.sep).join("/"));
      },
      Literal(node): void {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateLiteral(node): void {
        check(node, templateText(node));
      },
      JSXText(node): void {
        check(node, node.value);
      },
    };
  },
});
