import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { trackedFiles } from "../paths.ts";

const NEVER_REWRITTEN: readonly RegExp[] = [
  /^contracts\//u,
  /^docs\/archive\//u,
  /^docs\/plans\/[^/]+\//u,
  /^\.cubic\//u,
  /pnpm-lock\.yaml$/u,
];

const CODE = /\.(?:[cm]?[jt]sx?)$/u;

const TEXT = /\.(?:[cm]?[jt]sx?|md|json|jsonc|ya?ml|toml|py|sh|txt|cfg|ini)$|(?:^|\/)Dockerfile$/u;

const SPECIFIER =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bnew URL\(\s*|\bimport\.meta\.dirname\s*,\s*|\b__dirname\s*,\s*)(["'])([^"'\n]+)\2/gu;

const PACKAGE_PATH_TOKEN = /(?<=^|[\s"'=])(\.\/)?([\w@.-]+(?:\/[\w@.-]+)+)(?=$|[\s"'])/gu;

const WORKSPACE_PREFIX = /^(?:apps|packages)\/[^/]+\//u;

const TSCONFIG = /^(?:apps|packages)\/[^/]+\/tsconfig\.json$/u;

const LEFTOVER_WIDTH = 220;

const GREP_OUTPUT_LIMIT_BYTES = 256 * 1024 * 1024;

const isNeverRewritten = (file: string): boolean => NEVER_REWRITTEN.some((skip) => skip.test(file));

const tsconfig = z.object({
  compilerOptions: z
    .object({ paths: z.record(z.string(), z.array(z.string())).optional() })
    .optional(),
});

const jsonValue = z.json();

type Json = z.infer<typeof jsonValue>;

type Alias = { readonly prefix: string; readonly base: string; readonly workspace: string };

type Mention = { readonly pattern: RegExp; readonly to: string };

type Plan = {
  readonly root: string;
  readonly moves: ReadonlyMap<string, string>;
  readonly known: ReadonlySet<string>;
  readonly aliases: readonly Alias[];
  readonly mentions: readonly Mention[];
};

type MoveReport = {
  readonly dryRun: boolean;
  readonly moved: number;
  readonly rewritten: readonly string[];
  readonly unresolved: readonly string[];
  readonly leftovers: readonly string[];
};

const rowOf = (line: string): readonly [string, string] => {
  const [from, to] = line.split("\t").map((cell) => cell.trim());
  if (from === undefined || to === undefined || from === "" || to === "") {
    throw new Error(`bad row: ${line}`);
  }
  return [from, to];
};

const isNormalised = (cell: string): boolean =>
  path.posix.normalize(cell) === cell &&
  !cell.startsWith("/") &&
  !cell.endsWith("/") &&
  cell !== ".." &&
  !cell.startsWith("../");

const refusalOf = (
  root: string,
  tracked: ReadonlySet<string>,
  moves: ReadonlyMap<string, string>,
  from: string,
  to: string,
): string | undefined => {
  const unnormalised = [from, to].find((cell) => !isNormalised(cell));
  if (unnormalised !== undefined) return `not a normalised repo-relative path: ${unnormalised}`;
  if (!existsSync(path.join(root, from))) return `not on disk: ${from}`;
  if (!tracked.has(from)) return `not a tracked file: ${from}`;
  if (existsSync(path.join(root, to))) return `already exists: ${to}`;
  if (moves.has(from)) return `moved twice: ${from}`;
  return undefined;
};

const readMoves = (
  root: string,
  tracked: ReadonlySet<string>,
  tablePath: string,
): ReadonlyMap<string, string> => {
  const moves = new Map<string, string>();
  for (const line of readFileSync(tablePath, "utf8").split("\n")) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const [from, to] = rowOf(line);
    const refusal = refusalOf(root, tracked, moves, from, to);
    if (refusal !== undefined) throw new Error(refusal);
    moves.set(from, to);
  }
  if (new Set(moves.values()).size !== moves.size) throw new Error("two files move to one path");
  return moves;
};

const aliasesIn = (root: string, config: string): readonly Alias[] => {
  // A tsconfig is JSONC, and JSON.parse refuses a line comment.
  const text = readFileSync(path.join(root, config), "utf8").replaceAll(/^\s*\/\/.*$/gmu, "");
  const parsed: unknown = JSON.parse(text);
  const workspace = path.posix.dirname(config);
  return Object.entries(tsconfig.parse(parsed).compilerOptions?.paths ?? {}).flatMap(
    ([key, [value]]) =>
      key.endsWith("/*") && value?.endsWith("/*") === true
        ? [
            {
              prefix: key.slice(0, -1),
              base: path.posix.join(workspace, value.slice(0, -2)),
              workspace: `${workspace}/`,
            },
          ]
        : [],
  );
};

const escaped = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const mentionOf = (from: string, to: string): Mention => ({
  pattern: new RegExp(`(?<![\\w./-])${escaped(from)}(?![\\w/-]|\\.\\w)`, "gu"),
  to,
});

const planOf = (
  root: string,
  moves: ReadonlyMap<string, string>,
  tracked: readonly string[],
): Plan => ({
  root,
  moves,
  known: new Set(tracked),
  aliases: tracked.filter((file) => TSCONFIG.test(file)).flatMap((file) => aliasesIn(root, file)),
  mentions: [...moves].map(([from, to]) => mentionOf(from, to)),
});

const existsIn = (plan: Plan, file: string): boolean =>
  plan.moves.has(file) || plan.known.has(file) || existsSync(path.join(plan.root, file));

const relativeSpecifier = (fromFile: string, toFile: string): string => {
  const relative = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return relative.startsWith(".") ? relative : `./${relative}`;
};

const isRelative = (specifier: string): boolean =>
  specifier.startsWith("./") || specifier.startsWith("../");

const targetOf = (
  file: string,
  specifier: string,
  alias: Alias | undefined,
): string | undefined => {
  if (alias !== undefined) return path.posix.join(alias.base, specifier.slice(alias.prefix.length));
  return isRelative(specifier) ? path.posix.join(path.posix.dirname(file), specifier) : undefined;
};

type Rewritten = { readonly specifier: string; readonly unresolved: boolean };

const respecified = (alias: Alias | undefined, newFile: string, newTarget: string): string =>
  alias !== undefined && newTarget.startsWith(`${alias.base}/`)
    ? alias.prefix + path.posix.relative(alias.base, newTarget)
    : relativeSpecifier(newFile, newTarget);

const rewrittenSpecifier = (plan: Plan, file: string, specifier: string): Rewritten => {
  const alias = plan.aliases.find(
    (one) => file.startsWith(one.workspace) && specifier.startsWith(one.prefix),
  );
  const target = targetOf(file, specifier, alias);
  if (target === undefined) return { specifier, unresolved: false };
  if (!existsIn(plan, target)) {
    return { specifier, unresolved: alias === undefined && plan.moves.has(file) };
  }
  const newTarget = plan.moves.get(target) ?? target;
  const newFile = plan.moves.get(file) ?? file;
  if (newTarget === target && newFile === file) return { specifier, unresolved: false };
  return { specifier: respecified(alias, newFile, newTarget), unresolved: false };
};

type Rewrite = { readonly text: string; readonly unresolved: readonly string[] };

const withSpecifiers = (plan: Plan, file: string, before: string): Rewrite => {
  const unresolved: string[] = [];
  const text = before.replaceAll(
    SPECIFIER,
    (whole: string, lead: string, quote: string, specifier: string) => {
      const next = rewrittenSpecifier(plan, file, specifier);
      if (next.unresolved) unresolved.push(`${file}: ${specifier}`);
      return next.specifier === specifier ? whole : `${lead}${quote}${next.specifier}${quote}`;
    },
  );
  return { text, unresolved };
};

const withMentions = (plan: Plan, text: string): string =>
  plan.mentions.reduce((current, { pattern, to }) => current.replaceAll(pattern, () => to), text);

const withPackagePaths = (plan: Plan, file: string, text: string): string => {
  const workspace = path.posix.dirname(file);
  const parsed: unknown = JSON.parse(text);
  const before = jsonValue.parse(parsed);
  const visit = (value: Json): Json => {
    if (typeof value === "string") {
      return value.replaceAll(
        PACKAGE_PATH_TOKEN,
        (whole: string, dot: string | undefined, rest: string) => {
          const moved = plan.moves.get(path.posix.join(workspace, rest));
          return moved === undefined ? whole : (dot ?? "") + path.posix.relative(workspace, moved);
        },
      );
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, one]) => [key, visit(one)]));
    }
    return value;
  };
  const serialize = (value: Json): string => `${JSON.stringify(value, null, 2)}\n`;
  const next = serialize(visit(before));
  return serialize(before) === next ? text : next;
};

const rewrittenFile = (plan: Plan, file: string, before: string): Rewrite => {
  const specified = CODE.test(file)
    ? withSpecifiers(plan, file, before)
    : { text: before, unresolved: [] };
  const mentioned = withMentions(plan, specified.text);
  const text =
    path.posix.basename(file) === "package.json"
      ? withPackagePaths(plan, file, mentioned)
      : mentioned;
  return { text, unresolved: specified.unresolved };
};

const grepHits = (root: string, term: string): readonly string[] => {
  const found = spawnSync("git", ["-C", root, "grep", "-nF", "--", term], {
    encoding: "utf8",
    maxBuffer: GREP_OUTPUT_LIMIT_BYTES,
  });
  return found.status === 0 ? found.stdout.split("\n") : [];
};

const leftoversOf = (root: string, moves: ReadonlyMap<string, string>): readonly string[] => {
  const hits = [...moves.keys()].flatMap((from) => {
    const workspaceRelative = from.replace(WORKSPACE_PREFIX, "");
    return workspaceRelative === from ? [] : grepHits(root, workspaceRelative);
  });
  return [
    ...new Set(
      hits
        .filter((hit) => hit !== "" && !isNeverRewritten(hit.slice(0, hit.indexOf(":"))))
        .map((hit) => hit.slice(0, LEFTOVER_WIDTH)),
    ),
  ];
};

const gitMove = (root: string, from: string, to: string): void => {
  mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
  execFileSync("git", ["-C", root, "mv", from, to], { stdio: "pipe" });
};

const isRewritable = (file: string): boolean => TEXT.test(file) && !isNeverRewritten(file);

type Edit = { readonly file: string; readonly text: string };

const editsOf = (
  plan: Plan,
  tracked: readonly string[],
): { readonly edits: readonly Edit[]; readonly unresolved: readonly string[] } => {
  const edits: Edit[] = [];
  const unresolved: string[] = [];
  for (const file of tracked.filter(isRewritable)) {
    const before = readFileSync(path.join(plan.root, file), "utf8");
    const after = rewrittenFile(plan, file, before);
    unresolved.push(...after.unresolved);
    if (after.text !== before) edits.push({ file, text: after.text });
  }
  return { edits, unresolved };
};

export const moveFiles = (root: string, tablePath: string, dryRun: boolean): MoveReport => {
  const tracked = trackedFiles(root);
  const moves = readMoves(root, new Set(tracked), tablePath);
  const { edits, unresolved } = editsOf(planOf(root, moves, tracked), tracked);
  if (!dryRun) {
    for (const { file, text } of edits) writeFileSync(path.join(root, file), text);
    for (const [from, to] of moves) gitMove(root, from, to);
  }
  return {
    dryRun,
    moved: moves.size,
    rewritten: edits.map(({ file }) => file),
    unresolved,
    leftovers: leftoversOf(root, moves),
  };
};

const listed = (heading: string, lines: readonly string[]): string =>
  lines.length === 0 ? "" : `\n${heading}\n${lines.map((line) => `  ${line}`).join("\n")}\n`;

export const reportOf = (report: MoveReport): string =>
  [
    `${report.dryRun ? "would move" : "moved"} ${String(report.moved)} files; rewrote ${String(report.rewritten.length)} files\n`,
    listed(
      "relative specifiers in moved files that resolve to nothing (fixture text or a break):",
      report.unresolved,
    ),
    listed(
      "workspace-relative mentions of an old path still in the tree (check each by hand):",
      report.leftovers,
    ),
  ].join("");
