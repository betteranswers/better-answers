import {
  type CallExpression,
  type TSLiteralType,
  type TSType,
  type TSTypeReference,
  Visitor,
} from "oxc-parser";

import { parsedSource } from "../parsed-source.ts";

const REFUSAL_TYPE = /Refusal$/u;

const TAKES_CLASSES = /OfClass$/u;

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

const wordsOf = (type: TSType): readonly Found[] => {
  if (type.type === "TSLiteralType") return wordOf(type);
  if (type.type === "TSUnionType" || type.type === "TSIntersectionType") {
    return type.types.flatMap(wordsOf);
  }
  if (type.type === "TSParenthesizedType") return wordsOf(type.typeAnnotation);
  if (type.type === "TSTypeReference") return argumentWords(type);
  return [];
};

const refusesWords = ({ callee, arguments: [declaration] }: CallExpression): readonly Found[] => {
  if (callee.type !== "Identifier" || callee.name !== "declareAction") return [];
  if (declaration?.type !== "ObjectExpression") return [];
  const refuses = declaration.properties.find(
    (property) =>
      property.type === "Property" &&
      property.key.type === "Identifier" &&
      property.key.name === "refuses",
  );
  if (refuses?.type !== "Property" || refuses.value.type !== "ArrayExpression") return [];
  return refuses.value.elements.flatMap((element) =>
    element?.type === "Literal" && typeof element.value === "string"
      ? [{ word: element.value, offset: element.start }]
      : [],
  );
};

const isVocabulary = ({ typeName }: TSTypeReference): boolean =>
  typeName.type === "Identifier" && REFUSAL_TYPE.test(typeName.name);

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
    CallExpression: (node) => {
      keep(refusesWords(node));
    },
  }).visit(program);
  return [...byOffset]
    .toSorted(([one], [other]) => one - other)
    .map(([offset, word]) => ({ word, line: lineOf(offset) }));
};
