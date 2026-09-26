import {
  boundarySchemas,
  bundleManifest,
  CONCEPT_PATH,
  resolvedResource,
  VERIFICATION_IMPORTED_ORIGIN,
  type BundleManifest,
  type SENSITIVITIES,
} from "@better-answers/schema";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { act, declareActs, record } from "../audit/index.ts";
import {
  err,
  isPortablePath,
  normalizeError,
  ok,
  PERSON_PREFIX,
  ulid,
  type ActorId,
  type Principal,
  type Result,
  type UserId,
} from "../kernel/index.ts";
import type { CommitAuthor } from "../store/git/index.ts";
import { scopeClause, scopeParameter, type Tx } from "../store/postgres/index.ts";
import type { Frontmatter, FrontmatterSource } from "./file.ts";
import { foldKind, mergeKeyOf } from "./landing.ts";

const IMPORT_ACTS = declareActs("knowledge", {
  checkImported: act("knowledge.check.imported", { iri: "iri", verificationId: "id" }),
});

export const IMPORT_SENSITIVITY_DEFAULT = "Internal" satisfies (typeof SENSITIVITIES)[number];

export const ERASURE_REHEARSAL_PATH = "knowledge/erasure-rehearsal.md";

const RESERVED_PATHS: ReadonlySet<string> = new Set([ERASURE_REHEARSAL_PATH]);

const MANIFEST_FILE = "manifest.yaml";

const LISTING_FILES: ReadonlySet<string> = new Set(["index.md", "log.md"]);

const BUNDLE_ROOT = "knowledge";

const FENCE = "---";

export type BundleTree = ReadonlyMap<string, string>;

export type UnsoundReason =
  | "manifest-missing"
  | "manifest-malformed"
  | "does-not-parse"
  | "type-or-title-missing"
  | "reserved-path"
  | "path-refused"
  | "link-outside-tree"
  | "verifier-not-a-member"
  | "merge-key-clash";

export type Unsound = {
  readonly file: string;
  readonly reason: UnsoundReason;
  readonly about: string;
};

type VerifiedEvent = {
  readonly entry: FrontmatterSource;
  readonly email: string;
  readonly at: Date;
};

export type LoadedConcept = {
  readonly file: string;
  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly mergeKey: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly verified: readonly VerifiedEvent[];
  readonly entry: string;
};

export type LoadedBundle = {
  readonly manifest: BundleManifest;
  readonly concepts: readonly LoadedConcept[];
};

const unsound = (file: string, reason: UnsoundReason, about: string): Unsound => ({
  file,
  reason,
  about,
});

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const mapping = z.record(z.string(), scalar);
const yamlValue = z.union([scalar, z.array(z.string()), z.array(mapping), mapping]);
const yamlFrontmatter = z.record(z.string(), yamlValue);

type YamlFrontmatter = z.infer<typeof yamlFrontmatter>;

const isMapping = (value: YamlFrontmatter[string]): value is FrontmatterSource =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The platform's frontmatter holds scalars and lists, so a flow mapping such as OKF's
 * `generated {by, at}` is carried as a one-entry list.
 */
const frontmatterOf = (decoded: YamlFrontmatter): Frontmatter =>
  Object.fromEntries(
    Object.entries(decoded).map(([key, value]) => [key, isMapping(value) ? [value] : value]),
  );

const decodedYaml = <T>(text: string, schema: z.ZodType<T>, whole: string): Result<T, string> => {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (cause) {
    return err(normalizeError(cause).message.split("\n")[0] ?? "not YAML");
  }
  const decoded = schema.safeParse(parsed);
  if (decoded.success) return ok(decoded.data);
  const path = decoded.error.issues[0]?.path.map(String).join(".") ?? "";
  return err(path === "" ? whole : path);
};

const splitFile = (text: string): Result<{ head: string; body: string }, string> => {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== FENCE) return err("no frontmatter fence");
  const close = lines.indexOf(FENCE, 1);
  if (close === -1) return err("no closing frontmatter fence");
  const rest = lines.slice(close + 1);
  return ok({
    head: lines.slice(1, close).join("\n"),
    body: (rest[0] === "" ? rest.slice(1) : rest).join("\n"),
  });
};

const stringOf = (frontmatter: Frontmatter, key: string): string | undefined => {
  const value = frontmatter[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
};

const verifiedEventOf = (
  file: string,
  entry: string | FrontmatterSource,
  index: number,
): Result<VerifiedEvent, Unsound> => {
  if (typeof entry !== "object") return err(unsound(file, "does-not-parse", `verified[${index}]`));
  const by = entry["by"];
  if (typeof by !== "string") {
    return err(unsound(file, "does-not-parse", `verified[${index}].by`));
  }
  if (!by.startsWith(PERSON_PREFIX)) return err(unsound(file, "verifier-not-a-member", by));
  const at = typeof entry["at"] === "string" ? new Date(entry["at"]) : new Date(Number.NaN);
  if (Number.isNaN(at.getTime())) {
    return err(unsound(file, "does-not-parse", `verified[${index}].at`));
  }
  return ok({ entry, email: by.slice(PERSON_PREFIX.length), at });
};

const verifiedEventsOf = (
  file: string,
  frontmatter: Frontmatter,
): Result<readonly VerifiedEvent[], Unsound> => {
  const verified = frontmatter["verified"];
  if (verified === undefined) return ok([]);
  if (!Array.isArray(verified)) return err(unsound(file, "does-not-parse", "verified"));
  const events: VerifiedEvent[] = [];
  for (const [index, entry] of verified.entries()) {
    const event = verifiedEventOf(file, entry, index);
    if (!event.ok) return event;
    events.push(event.value);
  }
  return ok(events);
};

const INLINE_LINK = /\]\(\s*<?([^)\s>]+)/g;

type RelativeLink = {
  readonly at: number;
  readonly target: string;
  readonly file: string;
};

const relativeLinksOf = (body: string): readonly RelativeLink[] =>
  [...body.matchAll(INLINE_LINK)].flatMap((match) => {
    const target = match[1] ?? "";
    const file = target.split("#")[0] ?? "";
    if (file === "" || file.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(file)) return [];
    return file.endsWith(".md")
      ? [{ at: match.index + match[0].length - target.length, target, file }]
      : [];
  });

const relativeConceptLinksOf = (body: string): readonly string[] =>
  relativeLinksOf(body).map((link) => link.file);

export type RewrittenBody = {
  readonly body: string;
  readonly links: number;
};

/**
 * Swaps each relative `.md` link that `iriOf` knows for its IRI, keeping any `#fragment`;
 * `links` counts the swaps.
 */
export const rewriteLinks = (
  body: string,
  path: string,
  iriOf: (target: string) => string | undefined,
): RewrittenBody => {
  const pieces: string[] = [];
  let cursor = 0;
  let links = 0;
  for (const link of relativeLinksOf(body)) {
    const iri = iriOf(resolvedResource(link.file, path).slice(1));
    if (iri === undefined) continue;
    pieces.push(body.slice(cursor, link.at), iri, link.target.slice(link.file.length));
    cursor = link.at + link.target.length;
    links += 1;
  }
  pieces.push(body.slice(cursor));
  return { body: pieces.join(""), links };
};

const entryLabelOf = (frontmatter: Frontmatter): string => {
  const sources = frontmatter["sources"];
  const first = Array.isArray(sources) ? sources[0] : undefined;
  if (typeof first !== "object" || first === null) return "the bundle";
  const title = first["title"];
  if (typeof title === "string" && title.trim() !== "") return title;
  const id = first["id"];
  return typeof id === "string" && id.trim() !== "" ? id : "the bundle";
};

const pathOf = (file: string): string => `${BUNDLE_ROOT}/${file}`;

const isConceptFile = (file: string): boolean =>
  file.endsWith(".md") && !LISTING_FILES.has(file.split("/").at(-1) ?? "");

const conceptPathOf = (file: string): Result<string, Unsound> => {
  const path = pathOf(file);
  if (RESERVED_PATHS.has(path)) return err(unsound(file, "reserved-path", path));
  return CONCEPT_PATH.test(path) && isPortablePath(path)
    ? ok(path)
    : err(unsound(file, "path-refused", path));
};

const parsedConcept = (
  file: string,
  text: string,
): Result<{ readonly frontmatter: Frontmatter; readonly body: string }, Unsound> => {
  const split = splitFile(text);
  if (!split.ok) return err(unsound(file, "does-not-parse", split.error));
  const decoded = decodedYaml(split.value.head, yamlFrontmatter, "frontmatter");
  if (!decoded.ok) return err(unsound(file, "does-not-parse", decoded.error));
  return ok({ frontmatter: frontmatterOf(decoded.value), body: split.value.body });
};

const linkOutsideTree = (
  body: string,
  path: string,
  paths: ReadonlySet<string>,
): string | undefined =>
  relativeConceptLinksOf(body).find((link) => !paths.has(resolvedResource(link, path).slice(1)));

const readConcept = (
  file: string,
  text: string,
  paths: ReadonlySet<string>,
): Result<LoadedConcept, Unsound> => {
  const path = conceptPathOf(file);
  if (!path.ok) return path;
  const parsed = parsedConcept(file, text);
  if (!parsed.ok) return parsed;
  const { frontmatter, body } = parsed.value;
  const kind = stringOf(frontmatter, "type");
  if (kind === undefined) return err(unsound(file, "type-or-title-missing", "type"));
  const title = stringOf(frontmatter, "title");
  if (title === undefined) return err(unsound(file, "type-or-title-missing", "title"));
  const verified = verifiedEventsOf(file, frontmatter);
  if (!verified.ok) return verified;
  const outside = linkOutsideTree(body, path.value, paths);
  if (outside !== undefined) return err(unsound(file, "link-outside-tree", outside));
  return ok({
    file,
    path: path.value,
    kind,
    title,
    mergeKey: mergeKeyOf(foldKind(kind), title),
    frontmatter,
    body,
    verified: verified.value,
    entry: entryLabelOf(frontmatter),
  });
};

const manifestOf = (text: string): Result<BundleManifest, Unsound> => {
  const decoded = decodedYaml(text, bundleManifest, "manifest");
  return decoded.ok ? decoded : err(unsound(MANIFEST_FILE, "manifest-malformed", decoded.error));
};

/** Refuses the whole bundle at its first unsound file, taken in path order. */
export const readBundle = (tree: BundleTree): Result<LoadedBundle, Unsound> => {
  const manifestText = tree.get(MANIFEST_FILE);
  if (manifestText === undefined) {
    return err(unsound(MANIFEST_FILE, "manifest-missing", MANIFEST_FILE));
  }
  const manifest = manifestOf(manifestText);
  if (!manifest.ok) return manifest;
  const files = [...tree.keys()].filter(isConceptFile).toSorted();
  const paths = new Set(files.map(pathOf));
  const holders = new Map<string, string>();
  const concepts: LoadedConcept[] = [];
  for (const file of files) {
    const read = readConcept(file, tree.get(file) ?? "", paths);
    if (!read.ok) return read;
    const holder = holders.get(read.value.mergeKey);
    if (holder !== undefined) return err(unsound(file, "merge-key-clash", holder));
    holders.set(read.value.mergeKey, file);
    concepts.push(read.value);
  }
  return ok({ manifest: manifest.value, concepts });
};

/** Keyed by lower-cased email; an address with no member in the workspace is absent. */
export const memberIdsByEmail = async (
  principal: Principal,
  tx: Tx,
  emails: readonly string[],
): Promise<ReadonlyMap<string, UserId>> => {
  const distinct = [...new Set(emails.map((email) => email.toLowerCase()))];
  if (distinct.length === 0) return new Map();
  const found = await tx.query<{ email: string; id: string }>(
    `SELECT lower(u.email) AS email, u.id
       FROM "user" u
       JOIN member m ON m.user_id = u.id AND m.workspace_id = ${scopeClause(1)}
      WHERE lower(u.email) = ANY($2::text[])`,
    [scopeParameter(principal), distinct],
  );
  return new Map(
    found.rows.map((row) => [row.email, boundarySchemas.user.select.shape.id.parse(row.id)]),
  );
};

/** @throws when `personId` is no member of the workspace. */
export const authorOf = async (
  principal: Principal,
  tx: Tx,
  personId: UserId,
): Promise<CommitAuthor> => {
  const found = await tx.query<CommitAuthor>(
    `SELECT u.name, u.email FROM "user" u
       JOIN member m ON m.user_id = u.id AND m.workspace_id = ${scopeClause(1)}
      WHERE u.id = $2`,
    [scopeParameter(principal), personId],
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error("the running member has no user row to sign the commits with");
  }
  return row;
};

export type StandingConcept = {
  readonly iri: string;
  readonly mergeKey: string;
  readonly status: string;
  readonly body: string;
  readonly contentHash: string;
};

type StandingRow = {
  readonly path: string;
  readonly iri: string;
  readonly merge_key: string;
  readonly status: string;
  readonly body: string;
  readonly content_hash: string;
};

/** Keyed by path; a path no concept holds is absent. */
export const standingAt = async (
  principal: Principal,
  tx: Tx,
  paths: readonly string[],
): Promise<ReadonlyMap<string, StandingConcept>> => {
  if (paths.length === 0) return new Map();
  const found = await tx.query<StandingRow>(
    `SELECT c.path, c.iri, i.merge_key, c.status, c.body, c.content_hash
       FROM concept_index c
       JOIN concept_identity i ON i.workspace_id = c.workspace_id AND i.iri = c.iri
      WHERE c.workspace_id = ${scopeClause(1)} AND c.path = ANY($2::text[])`,
    [scopeParameter(principal), [...paths]],
  );
  return new Map(
    found.rows.map((row) => [
      row.path,
      {
        iri: row.iri,
        mergeKey: row.merge_key,
        status: row.status,
        body: row.body,
        contentHash: row.content_hash,
      },
    ]),
  );
};

export type ImportedCheck = {
  readonly actor: ActorId;
  readonly at: Date;
};

const checkKey = (iri: string, check: ImportedCheck): string =>
  `${iri} ${check.actor} ${check.at.toISOString()}`;

/** The checks already recorded on `iris`, as opaque keys for `countChecks`. */
export const presentChecks = async (
  principal: Principal,
  tx: Tx,
  iris: readonly string[],
): Promise<ReadonlySet<string>> => {
  if (iris.length === 0) return new Set();
  const found = await tx.query<{ iri: string; actor: ActorId; checked_at: Date }>(
    `SELECT iri, actor, checked_at FROM concept_verification
      WHERE workspace_id = ${scopeClause(1)} AND iri = ANY($2::text[])`,
    [scopeParameter(principal), [...iris]],
  );
  return new Set(
    found.rows.map((row) => checkKey(row.iri, { actor: row.actor, at: row.checked_at })),
  );
};

export type ChecksRecorded = {
  readonly recorded: number;
  readonly present: number;
};

/** An `undefined` IRI is a concept not held yet, so every check counts as recorded. */
export const countChecks = (
  iri: string | undefined,
  checks: readonly ImportedCheck[],
  present: ReadonlySet<string>,
): ChecksRecorded => {
  const missing =
    iri === undefined ? checks : checks.filter((check) => !present.has(checkKey(iri, check)));
  return { recorded: missing.length, present: checks.length - missing.length };
};

/** Records each check not already there, with an audit event each; `present` counts the rest. */
export const recordImportedChecks = async (
  principal: Principal,
  tx: Tx,
  input: {
    readonly iri: string;
    readonly checks: readonly ImportedCheck[];
    readonly batchId: string;
  },
): Promise<ChecksRecorded> => {
  const present = new Set(await presentChecks(principal, tx, [input.iri]));
  let recorded = 0;
  for (const check of input.checks) {
    const key = checkKey(input.iri, check);
    if (present.has(key)) continue;
    present.add(key);
    const verificationId = ulid();
    await tx.query(
      `INSERT INTO concept_verification (id, workspace_id, iri, actor, checked_at, content_hash, origin)
       VALUES ($2, ${scopeClause(1)}, $3, $4, $5, NULL, $6)`,
      [
        scopeParameter(principal),
        verificationId,
        input.iri,
        check.actor,
        check.at,
        VERIFICATION_IMPORTED_ORIGIN,
      ],
    );
    await record(principal, tx, {
      id: ulid(),
      act: IMPORT_ACTS.checkImported,
      subjectId: verificationId,
      batchId: input.batchId,
      detail: { iri: input.iri, verificationId },
    });
    recorded += 1;
  }
  return { recorded, present: input.checks.length - recorded };
};
