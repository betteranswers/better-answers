import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { Comment as GroupedComment } from "@oxlint/plugins";
import {
  type Comment,
  type Program,
  type PropertyKey,
  type VariableDeclaration,
  Visitor,
} from "oxc-parser";
import { z } from "zod";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import {
  blocksIn,
  isExempt,
  lastOf,
  proseOf,
  type Block,
} from "../../lint-rules/shared/comment-blocks.ts";
import { parsedSource } from "../parsed-source.ts";
import { filesUnderEach, repositoryRoot } from "../paths.ts";
import { executableOf } from "../throwaway-tree.ts";
import { KINDS, type Row, type Kind } from "./comment-rows.ts";

type Span = { readonly start: number; readonly end: number };

export type Cut = Span & { readonly replacement: string };

export type Found = { readonly row: Row; readonly cut: Cut };

export const lineStartOf = (source: string, offset: number): number =>
  source.lastIndexOf("\n", offset - 1) + 1;

const grouped = (
  source: string,
  lineOf: (offset: number) => number,
  comment: Comment,
): GroupedComment => {
  const at = (offset: number) => ({
    line: lineOf(offset),
    column: offset - lineStartOf(source, offset),
  });
  return {
    ...comment,
    range: [comment.start, comment.end],
    loc: { start: at(comment.start), end: at(comment.end) },
  };
};

const emptyContainersIn = (program: Program): readonly Span[] => {
  const found: Span[] = [];
  new Visitor({
    JSXExpressionContainer: (node) => {
      if (node.expression.type === "JSXEmptyExpression") found.push(node);
    },
  }).visit(program);
  return found;
};

const cutOf = (source: string, block: Block, containers: readonly Span[]): Cut => {
  const start = block[0].start;
  const { end } = lastOf(block);
  const holding = containers.find(
    (one) =>
      one.start < start &&
      end < one.end &&
      source.slice(one.start + 1, start).trim() === "" &&
      source.slice(end, one.end - 1).trim() === "",
  );
  const span = holding ?? { start, end };
  return { start: span.start, end: span.end, replacement: "" };
};

const BUNDLER_DIRECTIVE = /^@vite-ignore\b/u;

const kindOf = (source: string, block: Block, cut: Cut): Kind => {
  if (isExempt(block[0]) || BUNDLER_DIRECTIVE.test(proseOf(block[0]))) return "directive";
  if (source.slice(lineStartOf(source, cut.start), cut.start).trim() !== "") return "trailing";
  return block[0].type === "Line" ? "line" : "doc";
};

const keyName = (key: PropertyKey): string | undefined => {
  if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
  return key.type === "Literal" && typeof key.value === "string" ? key.value : undefined;
};

const bindingName = ({ declarations: [first] }: VariableDeclaration): string | undefined =>
  first?.id.type === "Identifier" ? first.id.name : undefined;

const declaredAt = (program: Program): ReadonlyMap<number, string> => {
  const names = new Map<number, string>();
  const exported: (readonly [number, number])[] = [];
  const name = (at: Span, value: string | undefined): void => {
    if (value !== undefined) names.set(at.start, value);
  };
  const byId = (node: Span & { readonly id: { readonly name: string } | null }): void => {
    name(node, node.id?.name);
  };
  const byKey = (node: Span & { readonly key: PropertyKey }): void => {
    name(node, keyName(node.key));
  };
  new Visitor({
    ExportNamedDeclaration: (node) => {
      if (node.declaration !== null) exported.push([node.start, node.declaration.start]);
    },
    ExportDefaultDeclaration: (node) => name(node, "default"),
    FunctionDeclaration: byId,
    ClassDeclaration: byId,
    TSTypeAliasDeclaration: byId,
    TSInterfaceDeclaration: byId,
    TSEnumDeclaration: byId,
    VariableDeclaration: (node) => name(node, bindingName(node)),
    MethodDefinition: byKey,
    PropertyDefinition: byKey,
    TSPropertySignature: byKey,
    TSMethodSignature: byKey,
    Property: byKey,
  }).visit(program);
  for (const [at, inner] of exported) name({ start: at, end: at }, names.get(inner));
  return names;
};

const attachedTo = (source: string, cut: Cut, declared: ReadonlyMap<number, string>): string => {
  const gap = /^[ \t]*(?:\r?\n)?[ \t]*/u.exec(source.slice(cut.end))?.[0].length ?? 0;
  return declared.get(cut.end + gap) ?? "";
};

const wordsIn = (prose: string): number => prose.match(/\S+/gu)?.length ?? 0;

const foundIn = (file: string, source: string): readonly Found[] => {
  const { program, comments, lineOf } = parsedSource(file, source);
  const all = comments.map((comment) => grouped(source, lineOf, comment));
  const blocks = [
    ...all.filter(isExempt).map((comment): Block => [comment]),
    ...blocksIn(source, all),
  ].sort((left, right) => left[0].start - right[0].start);
  const containers = emptyContainersIn(program);
  const declared = declaredAt(program);
  return blocks.map((block) => {
    const cut = cutOf(source, block, containers);
    const kind = kindOf(source, block, cut);
    const row: Row = {
      path: file,
      start: lineOf(block[0].start),
      end: lineOf(lastOf(block).end),
      kind,
      attached: kind === "trailing" ? "" : attachedTo(source, cut, declared),
      words: wordsIn(block.map(proseOf).join("\n")),
      text: source.slice(block[0].start, lastOf(block).end),
      class: "",
      holder: "",
      structure: "",
      unit: "",
    };
    return { row, cut };
  });
};

const LOCATOR = path.join(import.meta.dirname, "../../python/comment_locator.py");

const locatedBlocks = z.array(
  z.object({
    start: z.number().int().min(1),
    end: z.number().int().min(1),
    kind: z.enum(KINDS),
    attached: z.string(),
    words: z.number().int().min(0),
    text: z.string().min(1),
    cut: z.object({
      start: z.number().int().min(0),
      end: z.number().int().min(0),
      replacement: z.string(),
    }),
  }),
);

const pythonFoundIn = (file: string, source: string): readonly Found[] => {
  const ran = spawnSync("python3", [LOCATOR, file], {
    input: source,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (ran.status !== 0)
    throw new Error(
      ran.stderr || `${file}: python3 did not run: ${String(ran.error ?? ran.signal)}`,
    );
  return locatedBlocks.parse(JSON.parse(ran.stdout)).map(({ cut, ...block }) => {
    if (source.slice(cut.start, cut.end) !== block.text) {
      throw new Error(`${file}:${block.start}: the locator's offsets do not hold the block's text`);
    }
    const row: Row = { path: file, ...block, class: "", holder: "", structure: "", unit: "" };
    return { row, cut };
  });
};

export type Language = {
  readonly source: RegExp;
  readonly generated: string;
  readonly foundIn: (file: string, source: string) => readonly Found[];
  readonly formatter: string;
  readonly formatterCommand: () => readonly [string, ...string[]];
};

export const LANGUAGES: readonly Language[] = [
  {
    source: /\.[cm]?tsx?$/u,
    generated: "// Generated, never edited",
    foundIn,
    formatter: "oxfmt",
    formatterCommand: () => [
      executableOf({ package: "oxfmt", path: ["bin", "oxfmt"] }),
      "--no-error-on-unmatched-pattern",
    ],
  },
  {
    source: /\.py$/u,
    generated: "# Generated, never edited",
    foundIn: pythonFoundIn,
    formatter: "ruff format",
    formatterCommand: () => [
      "uv",
      "run",
      "--frozen",
      "--project",
      path.join(repositoryRoot, "apps/worker"),
      "ruff",
      "format",
    ],
  },
];

export const languageOf = (file: string): Language | undefined =>
  LANGUAGES.find((language) => language.source.test(file));

type SourceFile = { readonly file: string; readonly language: Language };

export const sourceFilesUnder = (root: string, paths: readonly string[]): readonly SourceFile[] =>
  [
    ...new Set(
      paths.flatMap((one) =>
        statSync(path.resolve(root, one)).isDirectory()
          ? filesUnderEach(root, [one])
          : [path.normalize(one)],
      ),
    ),
  ]
    .filter((file) => !file.split(path.sep).includes("skills"))
    .sort(byCodeUnit)
    .flatMap((file) => {
      const language = languageOf(file);
      return language === undefined ? [] : [{ file, language }];
    });

export const sourceAt = (root: string, file: string): string | undefined => {
  const at = path.resolve(root, file);
  return existsSync(at) && statSync(at).isFile() ? readFileSync(at, "utf8") : undefined;
};
