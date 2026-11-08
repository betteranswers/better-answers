import { readFileSync } from "node:fs";
import path from "node:path";

import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { isTestPath, repositoryRoot } from "../../src/paths.ts";

type Text = ESTree.StringLiteral | ESTree.TemplateLiteral | ESTree.JSXText;

const SENTENCE_LIMIT = 2;

const WORD_LIMIT = 25;

const A_SPACES = /\s+/gu;

const A_WORD = /[\p{L}\p{N}]/u;

const A_LETTER = /\p{L}/u;

const A_EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

const A_POSSESSIVE = /[’']s$/u;

const A_ERROR_CLASS = /Error$/u;

const A_FULL_STOP = /\.(?:\s|$)/u;

const A_SENTENCE_BREAK = /(?<=[.!?])\s+/u;

const A_STARTS_UPPER = /^[^\p{L}]*\p{Lu}/u;

const A_PRODUCT_NAME = /^- Name: \*\*(?<name>[^*]+)\*\*/mu;

const A_STARTS_LOWER = /^\p{Ll}/u;

const A_PLAIN_WORD = /^[\p{L}’'-]+[,;:!?…]?$/u;

const PLACEHOLDER_WORD = "item";

const LOOKUPS: ReadonlySet<string> = new Set(["pageNamed"]);

const COPY_ATTRIBUTES: ReadonlySet<string> = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "label",
  "placeholder",
  "title",
]);

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
    `${file}: expected ${expected}, and found none. ui-copy-plain.ts reads the product name from this file, so fix the parser or restore the text.`,
  );

const productName = (): string => {
  const name = A_PRODUCT_NAME.exec(sourceText("PRODUCT.md"))?.groups?.["name"];
  if (name === undefined) throw unparsed("PRODUCT.md", 'a line that starts "- Name: **"');
  return name;
};

const isLowerCaseLabel = (text: string): boolean => {
  const words = wordsOf(text);
  return (
    A_STARTS_LOWER.test(text) &&
    !A_FULL_STOP.test(text) &&
    words.every((word) => A_PLAIN_WORD.test(word)) &&
    coreOf(words[0] ?? "") !== productName()
  );
};

const isBanned = (text: string): boolean => BANNED_PATTERNS.some((pattern) => pattern.test(text));

const runsLong = (text: string): boolean =>
  A_STARTS_UPPER.test(text) &&
  (wordsOf(text).length > WORD_LIMIT || text.split(A_SENTENCE_BREAK).length > SENTENCE_LIMIT);

const REFUSALS: readonly ((text: string) => boolean)[] = [isBanned, runsLong];

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
  return parent.type === "Property" && parent.key === node;
};

const isLookupKey = (node: Text): boolean => {
  const { parent } = node;
  return (
    parent.type === "CallExpression" &&
    parent.callee.type === "Identifier" &&
    LOOKUPS.has(parent.callee.name)
  );
};

const isErrorMessage = (node: Text): boolean => {
  const { parent } = node;
  return (
    parent.type === "NewExpression" &&
    parent.callee.type === "Identifier" &&
    A_ERROR_CLASS.test(parent.callee.name)
  );
};

const NOT_COPY: readonly ((node: Text) => boolean)[] = [
  isSpecifier,
  isPropertyKey,
  isLookupKey,
  isErrorMessage,
];

const isCopyAttribute = (node: Text): boolean => {
  const { parent } = node;
  return (
    parent.type === "JSXAttribute" &&
    parent.name.type === "JSXIdentifier" &&
    COPY_ATTRIBUTES.has(parent.name.name)
  );
};

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
    const check = (node: Text, written: string, opensWithText: boolean): void => {
      const text = written.replaceAll(A_SPACES, " ").trim();
      if (!isProse(text) || NOT_COPY.some((isNot) => isNot(node))) return;
      const refused =
        REFUSALS.some((refuses) => refuses(text)) || (opensWithText && isLowerCaseLabel(text));
      if (refused) context.report({ node, messageId: "plain" });
    };

    return {
      before(): boolean {
        return !isTestPath(path.relative(context.cwd, context.filename).split(path.sep).join("/"));
      },
      Literal(node): void {
        if (typeof node.value === "string") check(node, node.value, isCopyAttribute(node));
      },
      TemplateLiteral(node): void {
        check(node, templateText(node), false);
      },
      JSXText(node): void {
        const { parent } = node;
        const first =
          (parent.type === "JSXElement" || parent.type === "JSXFragment") &&
          parent.children[0] === node;
        check(node, node.value, first);
      },
    };
  },
});
