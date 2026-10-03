import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { FAMILIES } from "@better-answers/schema";

import { executableOf } from "../throwaway-tree.ts";
import { OUTSIDE_ALLOWLIST, RENAMED, isSwept, relativeTo } from "./edits.ts";
import type { Edit, Occurrence, PassOutcome } from "./edits.ts";
import { STORED_HISTORY, inAllowlist, keptReason, senseOf } from "./map.ts";
import type { RenameMap } from "./map.ts";
import { hasLoneWord, renamedText, wordSource } from "./words.ts";
import type { Words } from "./words.ts";

const AST_GREP = { package: "@ast-grep/cli", path: ["ast-grep"] } as const;

const MODULE_PATH = "module path";

const LONE_WORD = "lone word, joiner unknown";

/** A lone word outside a script string is a name: a Python identifier, a dict key or a JSON key. */
const NAME_JOINER = "_";

/** `family.subject.verb`: a stored act name, which events keep writing after any sweep. */
const STORED_ACT = new RegExp(`^(?:${FAMILIES.join("|")})\\.[a-z_]+\\.[a-z_]+$`);

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

type Role = "module" | "text";

/** A match names only its rule, so the id carries the role a verdict reads back. */
const ruleId = (language: string, role: Role): string => `${language}-${role}`;

const isRole = (id: string, role: Role): boolean => id.endsWith(ruleId("", role));

const rulesFor = (regex: string): string =>
  [
    ...SCRIPT_LANGUAGES.flatMap((language) => [
      {
        id: ruleId(language, "module"),
        language,
        rule: { kind: "string_fragment", regex, inside: SCRIPT_MODULE },
      },
      {
        id: ruleId(language, "text"),
        language,
        rule: { kind: "string_fragment", regex, not: { inside: SCRIPT_MODULE } },
      },
    ]),
    {
      id: ruleId("Python", "module"),
      language: "Python",
      rule: { kind: "identifier", regex, inside: PYTHON_MODULE },
    },
    {
      id: ruleId("Python", "text"),
      language: "Python",
      rule: {
        any: [{ kind: "identifier" }, { kind: "string_content" }],
        regex,
        not: { inside: PYTHON_MODULE },
      },
    },
    { id: ruleId("Json", "text"), language: "Json", rule: { kind: "string_content", regex } },
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
      rulesFor(`(?i)${wordSource(words)}`),
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
  if (isRole(match.ruleId, "module")) return MODULE_PATH;
  return STORED_ACT.test(match.text) ? STORED_HISTORY : undefined;
};

/** A script string can be reader text, such as a tab label, which camel case would turn into code. */
const isScriptText = (id: string): boolean =>
  SCRIPT_LANGUAGES.some((language) => id === ruleId(language, "text"));

const allowedVerdict = (map: RenameMap, words: Words, file: string, match: ScanMatch): string => {
  if (!inAllowlist(map.text.paths, file)) return OUTSIDE_ALLOWLIST;
  return isScriptText(match.ruleId) && hasLoneWord(match.text, words) ? LONE_WORD : RENAMED;
};

const verdictOf = (map: RenameMap, words: Words, file: string, match: ScanMatch): string =>
  keptReason(file) ??
  fixedVerdict(match) ??
  senseOf(map, file, match.text) ??
  allowedVerdict(map, words, file, match);

/** ast-grep counts UTF-8 bytes, and an edit counts UTF-16 code units. */
const offsetIn = (source: Buffer, byte: number): number =>
  source.subarray(0, byte).toString("utf8").length;

type ToUnit = (byte: number) => number;

/** Each character's first byte against its code unit, read once per file rather than once per match. */
const unitsAt = (source: Buffer, text: string): ToUnit => {
  const units = new Int32Array(source.length + 1).fill(-1);
  let byte = 0;
  let unit = 0;
  for (const character of text) {
    units[byte] = unit;
    byte += Buffer.byteLength(character);
    unit += character.length;
  }
  units[byte] = unit;
  return (at) => {
    const found = units[at] ?? -1;
    return found < 0 ? offsetIn(source, at) : found;
  };
};

/** Decoding clamps an offset past the end, as a file edited since the scan could give. */
const isInside = (source: Buffer, byte: number): boolean =>
  Number.isInteger(byte) && byte >= 0 && byte <= source.length;

/** One byte per unit means ASCII, or each stray byte as one replacement; only valid UTF-8 re-encodes byte for byte. */
const offsetsIn = (source: Buffer): ToUnit => {
  const text = source.toString("utf8");
  if (text.length === source.length) {
    return (byte) => (isInside(source, byte) ? byte : offsetIn(source, byte));
  }
  if (!Buffer.from(text, "utf8").equals(source)) return (byte) => offsetIn(source, byte);
  return unitsAt(source, text);
};

/** Inventories every string, Python name and JSON key holding an old word, and the edits for those the allowlist names. */
export const textPass = (root: string, map: RenameMap, words: Words): PassOutcome => {
  const sources = new Map<string, ToUnit>();
  const occurrences: Occurrence[] = [];
  const edits: Edit[] = [];
  for (const match of scanned(root, words)) {
    const file = relativeTo(root, match.file);
    const to = renamedText(match.text, words, NAME_JOINER);
    if (!isSwept(file) || to === match.text) continue;
    const verdict = verdictOf(map, words, file, match);
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
    const unitOf = sources.get(file) ?? offsetsIn(readFileSync(path.join(root, file)));
    sources.set(file, unitOf);
    edits.push({
      file,
      start: unitOf(match.range.byteOffset.start),
      end: unitOf(match.range.byteOffset.end),
      text: to,
    });
  }
  return { occurrences, edits };
};
