import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { executableOf } from "../throwaway-tree.ts";
import { OUTSIDE_ALLOWLIST, RENAMED, isSwept, relativeTo } from "./edits.ts";
import type { Edit, Occurrence, PassOutcome } from "./edits.ts";
import { STORED_HISTORY, inAllowlist, keptReason, senseOf } from "./map.ts";
import type { RenameMap } from "./map.ts";
import { renamedText, wordPattern } from "./words.ts";
import type { Words } from "./words.ts";

const AST_GREP = { package: "@ast-grep/cli", path: ["ast-grep"] } as const;

const MODULE_PATH = "module path";

/** `family.subject.verb`: a stored act name, which events keep writing after any sweep. */
const STORED_ACT = /^(?:people|knowledge|sources|platform)\.[a-z_]+\.[a-z_]+$/;

/** A whole repository's matches, each with its source line, outgrow the default megabyte. */
const SCAN_BUFFER_BYTES = 512 * 1024 * 1024;

const SCRIPT_LANGUAGES = ["TypeScript", "Tsx", "JavaScript"] as const;

/** A module path moves only with its file, which a sweep moves by hand. */
const SCRIPT_MODULE = {
  kind: "string",
  inside: { any: [{ kind: "import_statement" }, { kind: "export_statement" }], field: "source" },
};

const PYTHON_MODULE = {
  kind: "dotted_name",
  any: [
    { inside: { kind: "import_from_statement", field: "module_name" } },
    { inside: { kind: "relative_import" } },
    { inside: { kind: "import_statement", stopBy: "end" } },
  ],
};

const rulesFor = (regex: string): string =>
  [
    ...SCRIPT_LANGUAGES.flatMap((language) => [
      {
        id: `${language}-module`,
        language,
        rule: { kind: "string_fragment", regex, inside: SCRIPT_MODULE },
      },
      {
        id: `${language}-text`,
        language,
        rule: { kind: "string_fragment", regex, not: { inside: SCRIPT_MODULE } },
      },
    ]),
    {
      id: "Python-module",
      language: "Python",
      rule: { kind: "identifier", regex, inside: PYTHON_MODULE },
    },
    {
      id: "Python-text",
      language: "Python",
      rule: {
        any: [{ kind: "identifier" }, { kind: "string_content" }],
        regex,
        not: { inside: PYTHON_MODULE },
      },
    },
    { id: "Json-text", language: "Json", rule: { kind: "string_content", regex } },
  ]
    .map((rule) => JSON.stringify(rule))
    .join("\n---\n");

const scanMatch = z.object({
  text: z.string(),
  file: z.string(),
  ruleId: z.string(),
  range: z.object({
    byteOffset: z.object({ start: z.number(), end: z.number() }),
    start: z.object({ line: z.number(), column: z.number() }),
  }),
});

type ScanMatch = z.infer<typeof scanMatch>;

/** ast-grep's own stderr carries a warning on every run while its postinstall is declined, so only the exit is read. */
const scanned = (root: string, words: Words): readonly ScanMatch[] => {
  const run = spawnSync(
    executableOf(AST_GREP),
    [
      "scan",
      "--inline-rules",
      rulesFor(wordPattern(words)),
      "--json=stream",
      "--globs",
      "!**/node_modules/**",
      root,
    ],
    { encoding: "utf8", maxBuffer: SCAN_BUFFER_BYTES },
  );
  if (run.status !== 0) {
    throw new Error(
      `ast-grep did not run: exit ${String(run.status)}\n${run.stderr}\n${String(run.error ?? "")}`,
    );
  }
  return run.stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => scanMatch.parse(JSON.parse(line)));
};

const fixedVerdict = (match: ScanMatch): string | undefined => {
  if (match.ruleId.endsWith("-module")) return MODULE_PATH;
  return STORED_ACT.test(match.text) ? STORED_HISTORY : undefined;
};

const verdictOf = (map: RenameMap, file: string, match: ScanMatch): string =>
  keptReason(file) ??
  fixedVerdict(match) ??
  senseOf(map, file, match.text) ??
  (inAllowlist(map.text.paths, file) ? RENAMED : OUTSIDE_ALLOWLIST);

/** ast-grep counts UTF-8 bytes, and an edit counts UTF-16 code units. */
const offsetIn = (source: Buffer, byte: number): number =>
  source.subarray(0, byte).toString("utf8").length;

/** Inventories every string, Python name and JSON key holding an old word, and the edits for those the allowlist names. */
export const textPass = (root: string, map: RenameMap, words: Words): PassOutcome => {
  const sources = new Map<string, Buffer>();
  const occurrences: Occurrence[] = [];
  const edits: Edit[] = [];
  for (const match of scanned(root, words)) {
    const file = relativeTo(root, match.file);
    const to = renamedText(match.text, words);
    if (!isSwept(file) || to === match.text) continue;
    const verdict = verdictOf(map, file, match);
    const { line, column } = match.range.start;
    occurrences.push({
      pass: "text",
      file,
      line: line + 1,
      column: column + 1,
      found: match.text,
      to: verdict === RENAMED ? to : match.text,
      verdict,
    });
    if (verdict !== RENAMED) continue;
    const source = sources.get(file) ?? readFileSync(path.join(root, file));
    sources.set(file, source);
    edits.push({
      file,
      start: offsetIn(source, match.range.byteOffset.start),
      end: offsetIn(source, match.range.byteOffset.end),
      text: to,
    });
  }
  return { occurrences, edits };
};
