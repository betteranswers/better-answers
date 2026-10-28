import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import { trackedFiles } from "../paths.ts";

const CONTRACT_FOLDER = "contracts";

export type ContractFiles = Readonly<Record<string, string>>;

export type Mention = { readonly file: string; readonly path: string };

export type TierContract = { readonly files: ContractFiles; readonly roots: readonly string[] };

const jsonValue = z.json();

type JsonValue = z.infer<typeof jsonValue>;

const SEGMENT = String.raw`[\w.@+-]+`;

const SENTENCE_END = /[.-]+$/u;

const escaped = (root: string): string => root.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

export const rootsOf = (tracked: readonly string[]): readonly string[] => [
  ...new Set(
    tracked.filter((file) => file.includes("/")).map((file) => file.slice(0, file.indexOf("/"))),
  ),
];

export const pathsNamedIn = (text: string, roots: readonly string[]): readonly string[] => {
  const pattern = new RegExp(
    String.raw`(?<![\w./-])(?:${roots.map(escaped).join("|")})(?:/${SEGMENT})+`,
    "gu",
  );
  return [...text.matchAll(pattern)].map(([found]) => found.replace(SENTENCE_END, ""));
};

const stringsOf = (value: JsonValue): readonly string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, one]) => [key, ...stringsOf(one)]);
  }
  return [];
};

const stringsIn = (file: string, text: string): readonly string[] => {
  if (!file.endsWith(".json")) return [text];
  try {
    return stringsOf(jsonValue.parse(JSON.parse(text)));
  } catch (cause) {
    throw new Error(`${file} is not valid JSON, so its strings cannot be read`, { cause });
  }
};

export const mentionsIn = (files: ContractFiles, roots: readonly string[]): readonly Mention[] =>
  Object.entries(files)
    .toSorted(([one], [other]) => byCodeUnit(one, other))
    .flatMap(([file, text]) => {
      const named = stringsIn(file, text).flatMap((one) => pathsNamedIn(one, roots));
      return [...new Set(named)].toSorted(byCodeUnit).map((one) => ({ file, path: one }));
    });

export const findingsFor = (
  mentions: readonly Mention[],
  exists: (repositoryPath: string) => boolean,
): readonly string[] =>
  mentions
    .filter((mention) => !exists(mention.path))
    .map(
      ({ file, path: missing }) =>
        `${file} names ${missing}, which the repository does not hold. Point it at the file's new path: \`git log -1 --format=%h -- ${missing}\` names the commit that moved it, and \`git show --name-status -M <commit>\` lists where it went.`,
    );

export const tierContractIn = (root: string): TierContract => {
  const tracked = trackedFiles(root);
  const held = tracked.filter((file) => file.startsWith(`${CONTRACT_FOLDER}/`));
  return {
    files: Object.fromEntries(
      held.map((file) => [file, readFileSync(path.join(root, file), "utf8")]),
    ),
    roots: rootsOf(tracked),
  };
};
