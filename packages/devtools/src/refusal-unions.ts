import { type TSLiteralType, type TSType, type TSTypeReference, Visitor } from "oxc-parser";

import { parsedSource } from "./parsed-source.ts";

const REFUSAL_TYPE = /Refusal$/;

/** A `…OfClass` type takes refusal classes, and a class is no word. */
const TAKES_CLASSES = /OfClass$/;

export type UnionWord = { readonly word: string; readonly line: number };

type Found = { readonly word: string; readonly offset: number };

const wordOf = ({ literal, start }: TSLiteralType): readonly Found[] =>
  literal.type === "Literal" && typeof literal.value === "string"
    ? [{ word: literal.value, offset: start }]
    : [];

const argumentWords = ({ typeName, typeArguments }: TSTypeReference): readonly Found[] =>
  typeName.type === "Identifier" && TAKES_CLASSES.test(typeName.name)
    ? []
    : (typeArguments?.params ?? []).flatMap(wordsOf);

/** Never an object type's properties, which hold its shape: a `kind`, an `address`. */
const wordsOf = (type: TSType): readonly Found[] => {
  switch (type.type) {
    case "TSLiteralType":
      return wordOf(type);
    case "TSUnionType":
    case "TSIntersectionType":
      return type.types.flatMap(wordsOf);
    case "TSParenthesizedType":
      return wordsOf(type.typeAnnotation);
    case "TSTypeReference":
      return argumentWords(type);
    default:
      return [];
  }
};

const isVocabulary = ({ typeName }: TSTypeReference): boolean =>
  typeName.type === "Identifier" && REFUSAL_TYPE.test(typeName.name);

/**
 * Reads unexported aliases, and vocabulary arguments inside an object's `word`.
 *
 * @throws when the file does not parse, which would otherwise read as naming no word.
 */
export const refusalWordsIn = (file: string, source: string): readonly UnionWord[] => {
  const { program, lineOf } = parsedSource(file, source);
  const byOffset = new Map<number, string>();
  const keep = (found: readonly Found[]): void => {
    for (const { word, offset } of found) byOffset.set(offset, word);
  };
  new Visitor({
    TSTypeAliasDeclaration: (node) => {
      if (REFUSAL_TYPE.test(node.id.name)) keep(wordsOf(node.typeAnnotation));
    },
    TSTypeReference: (node) => {
      if (isVocabulary(node)) keep(argumentWords(node));
    },
  }).visit(program);
  return [...byOffset]
    .toSorted(([one], [other]) => one - other)
    .map(([offset, word]) => ({ word, line: lineOf(offset) }));
};
