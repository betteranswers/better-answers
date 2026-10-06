import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { repositoryRoot } from "@better-answers/devtools/paths";

const QUOTED = /`(?<token>[^`]+)`/g;

const withoutFences = (text: string): string => {
  const kept: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    else if (!inFence) kept.push(line);
  }
  return kept.join("\n");
};

const looksLikePath = (token: string): boolean =>
  !/[\s<>$*~]/.test(token) &&
  !token.startsWith("/") &&
  !token.startsWith("-") &&
  (token.includes("/") || /.\.[a-z]+$/.test(token));

export const ignored = (file: string): boolean =>
  spawnSync("git", ["-C", repositoryRoot, "check-ignore", "-q", "--no-index", file]).status === 0;

export const namedPaths = (skillDirectory: string, files: readonly string[]): readonly string[] => {
  const fromRoot = (token: string): string =>
    token.startsWith("references/") || token.startsWith("scripts/")
      ? path.join(skillDirectory, token)
      : token;
  return files.flatMap((file) =>
    [
      ...withoutFences(
        readFileSync(path.join(repositoryRoot, skillDirectory, file), "utf8"),
      ).matchAll(QUOTED),
    ]
      .map((match) => match.groups?.["token"] ?? "")
      .filter(looksLikePath)
      .map(fromRoot),
  );
};

export const missingPaths = (named: readonly string[]): readonly string[] =>
  [...new Set(named)].filter(
    (file) => !existsSync(path.join(repositoryRoot, file)) && !ignored(file),
  );
