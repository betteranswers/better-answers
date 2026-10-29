import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PERSON_PREFIX, type PlatformPrincipal } from "../../kernel/index.ts";
import { git, run, childEnvironment, repositoryPath, type GitDoor } from "./door.ts";
import { carries, historyNaming, allCommits } from "./history.ts";

export type Needles = {
  readonly addresses: readonly string[];

  readonly people: readonly string[];
};

export type Pseudonymisation = Needles & { readonly pseudonym: string };

export type HistoryRewritten = {
  readonly moved: readonly (readonly [string, string])[];

  readonly paths: readonly string[];
};

const NOTHING_MOVED: HistoryRewritten = { moved: [], paths: [] };

export const ERASED_DOMAIN = "erased.better-answers.invalid";

// oxlint-disable-next-line eslint/require-unicode-regexp -- Stryker negates \v to \V, which the u flag refuses at load
const PYTHON_SPECIAL = /[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g;

const escapedForPython = (literal: string): string =>
  literal.replace(PYTHON_SPECIAL, (character) => `\\${character}`);

const AFTER_AN_ADDRESS = String.raw`(?![A-Za-z0-9_%+-]|\.[A-Za-z0-9])`;

const replacementsFor = (
  addresses: readonly string[],
  people: readonly string[],
  pseudonym: string,
): string =>
  [
    ...addresses.map(
      (address) =>
        `regex:(?i)${escapedForPython(`${PERSON_PREFIX}${address}`)}${AFTER_AN_ADDRESS}==>${PERSON_PREFIX}${pseudonym}\n`,
    ),
    ...people.map((person) => `${PERSON_PREFIX}${person}==>${PERSON_PREFIX}${pseudonym}\n`),
  ].join("");

const messagesNaming = async (gitDir: string, needles: readonly string[]): Promise<boolean> => {
  const logged = await git(gitDir, ["log", "--all", "--format=%B%x00"]);
  return logged.split("\0").some((message) => carries(message, needles));
};

const identitiesOf = (line: string): readonly (readonly [string, string])[] => {
  const [author = "", authorAddress = "", committer = "", committerAddress = ""] = line.split("\0");
  return [
    [author, authorAddress],
    [committer, committerAddress],
  ];
};

const identitiesNaming = async (
  gitDir: string,
  needles: readonly string[],
): Promise<readonly string[]> => {
  const logged = await git(gitDir, ["log", "--all", "--format=%an%x00%ae%x00%cn%x00%ce"]);

  const found = new Map<string, string>();
  for (const line of logged.split("\n")) {
    for (const [name, address] of identitiesOf(line)) {
      if (address !== "" && carries(`${name} <${address}>`, needles)) {
        found.set(address.toLowerCase(), address);
      }
    }
  }
  return [...found.values()];
};

const mailmapFor = (addresses: readonly string[], pseudonym: string): string =>
  addresses
    .map((address) => `${PERSON_PREFIX}${pseudonym} <${pseudonym}@${ERASED_DOMAIN}> <${address}>\n`)
    .join("");

const filterRepo = async (gitDir: string, arguments_: readonly string[]): Promise<void> => {
  await run("git", ["filter-repo", ...arguments_], {
    cwd: gitDir,
    env: childEnvironment(),
    maxBuffer: 64 * 1024 * 1024,
  });
};

const DROPPED = "0".repeat(40);

const COMMIT_MAP_LINE = /^([0-9a-f]{40})\s+([0-9a-f]{40})$/u;

const commitMapPairs = (mapped: string): readonly (readonly [string, string])[] =>
  mapped.split("\n").flatMap((line) => {
    const match = COMMIT_MAP_LINE.exec(line.trim());
    const before = match?.[1];
    const after = match?.[2];
    return before === undefined || after === undefined ? [] : [[before, after] as const];
  });

const commitMapOf = async (
  gitDir: string,
  started: ReadonlySet<string>,
): Promise<readonly (readonly [string, string])[]> => {
  const mapped = await readFile(path.join(gitDir, "filter-repo", "commit-map"), "utf8");
  const moved: (readonly [string, string])[] = [];
  for (const [before, after] of commitMapPairs(mapped)) {
    if (!started.has(before)) continue;
    if (after === DROPPED) {
      throw new Error(`git: the history rewrite dropped commit ${before} rather than moving it`);
    }
    if (before !== after) moved.push([before, after]);
  }
  return moved;
};

const trimmed = (values: readonly string[]): readonly string[] =>
  values.map((value) => value.trim()).filter((value) => value !== "");

export const rewriteHistory = async (
  platform: PlatformPrincipal,
  door: GitDoor,
  workspaceId: string,
  who: Pseudonymisation,
): Promise<HistoryRewritten> => {
  const addresses = trimmed(who.addresses);
  const people = trimmed(who.people);
  const pseudonym = who.pseudonym.trim();
  if (addresses.length + people.length === 0 || pseudonym === "") return NOTHING_MOVED;

  const needles = [...addresses, ...people.map((person) => `${PERSON_PREFIX}${person}`)];
  const naming = await historyNaming(platform, door, workspaceId, needles);
  const gitDir = repositoryPath(door, workspaceId);
  const named =
    naming.blobs.length > 0 || naming.authors.length > 0 || (await messagesNaming(gitDir, needles));
  if (!named) return NOTHING_MOVED;

  const started = new Set(await allCommits(gitDir));
  const signed = await identitiesNaming(gitDir, addresses);
  const written = await mkdtemp(path.join(tmpdir(), "better-answers-rewrite-"));
  try {
    const text = path.join(written, "replacements");
    const mailmap = path.join(written, "mailmap");
    await writeFile(text, replacementsFor(addresses, people, pseudonym), "utf8");
    await writeFile(mailmap, mailmapFor(signed, pseudonym), "utf8");
    await filterRepo(gitDir, [
      "--force",
      "--replace-text",
      text,

      "--replace-message",
      text,

      ...(signed.length === 0 ? [] : ["--mailmap", mailmap]),
      "--prune-empty",
      "never",
      "--prune-degenerate",
      "never",
    ]);
    const moved = await commitMapOf(gitDir, started);

    await git(gitDir, ["reflog", "expire", "--expire=now", "--all"]);
    await git(gitDir, ["gc", "--prune=now", "--quiet"]);
    return { moved, paths: [...new Set(naming.blobs.map((blob) => blob.path))] };
  } finally {
    await rm(written, { recursive: true, force: true });
  }
};
