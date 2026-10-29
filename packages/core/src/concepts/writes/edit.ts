import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  boundarySchemas,
  citedSourcesOf,
  COLLECTION,
  CONCEPT_PATH,
  ids,
  parsedPassageLocator,
  passageLocatorsIn,
  SUGGESTION_EDIT_KIND,
  type ConceptIri,
} from "@better-answers/schema";

import { readableClause, readableParameters } from "../../access/index.ts";
import { authorOf, foldKind } from "../../bundle/index.ts";
import {
  admit,
  ANY_ROLE,
  attempt,
  declareAction,
  err,
  isPortablePath,
  ok,
  type PrincipalRefusal,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";
import type { CommitAuthor } from "../../store/git/index.ts";
import { withMember, type PostgresDoor, type Tx } from "../../store/postgres/index.ts";
import {
  contentHashOf,
  normalisedBody,
  renderConceptFile,
  type Frontmatter,
  type FrontmatterSource,
  type FrontmatterValue,
} from "../file.ts";
import { heldByIri, mergeKeyOf, placesUsingReadableOrNot, type Held } from "../import/landing.ts";
import { ownerAdmits, ownerOf, standingConcept, type OwnedConcept } from "../owners.ts";
import { resolvedSourcesOf, type PassageReader } from "../reading/read.ts";
import { mergeKeyMovedBy } from "./merge-key.ts";
import { submitSuggestionSet, type SubmitSuggestionSetRefusal } from "./suggestions.ts";
import {
  SAVED_NEW,
  storedFileOf,
  writeConcept,
  type ConceptFile,
  type ConceptWritten,
  type WriteConceptInput,
  type WriteConceptRefusal,
  type WriteDoors,
} from "./write.ts";

type SourceEntry = string | FrontmatterSource;

export type ConceptParts = {
  readonly title: string;
  readonly kind: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly body: string;
};

export type Standing = "commits" | "suggests";

type WithheldSource = { readonly at: number; readonly label: string };

export type ConceptToEdit = {
  readonly parts: ConceptParts;
  readonly sources: readonly SourceEntry[];
  readonly withheld: readonly WithheldSource[];
  readonly base: string | null;
  readonly standing: Standing;
  readonly usedIn: number;
};

export type EditedConcept = { readonly iri: string } | { readonly collection: string };

const ownedInCollection = (collection: string): OwnedConcept => ({
  iri: null,
  path: `knowledge/${collection}/`,
});

const routeOf = async (
  principal: UserPrincipal,
  tx: Tx,
  concept: OwnedConcept,
): Promise<Standing> =>
  principal.role === "Admin" || (await ownerOf(principal, tx, concept)) === principal.userId
    ? "commits"
    : "suggests";

export const standingOnConcept = async (
  principal: UserPrincipal,
  tx: Tx,
  iri: string,
): Promise<Standing> => routeOf(principal, tx, await standingConcept(principal, tx, iri, ""));

const stringOf = (value: FrontmatterValue | undefined): string | null =>
  typeof value === "string" ? value : null;

const tagsOf = (value: FrontmatterValue | undefined): readonly string[] =>
  Array.isArray(value) ? value.filter((tag) => typeof tag === "string") : [];

const partsOf = (frontmatter: Frontmatter, body: string, held: Held): ConceptParts => ({
  title: stringOf(frontmatter["title"]) ?? held.title,
  kind: stringOf(frontmatter["type"]) ?? held.kind,
  description: stringOf(frontmatter["description"]),
  tags: tagsOf(frontmatter["tags"]),
  body,
});

const EMPTY_PARTS: ConceptParts = { title: "", kind: "", description: null, tags: [], body: "" };

type Opened = {
  readonly entry: SourceEntry;
  readonly label: string;
  readonly withheld: boolean;
};

const openedSourcesOf = async (
  principal: UserPrincipal,
  tx: Tx,
  frontmatter: Frontmatter,
  passageAt: PassageReader,
): Promise<Result<readonly Opened[]>> => {
  const resolved = await resolvedSourcesOf(
    {
      principal,
      tx,
      passageAt,
      namesPassage: (locator) => parsedPassageLocator(locator) !== undefined,
    },
    frontmatter,
  );
  if (!resolved.ok) return err(resolved.error);
  return ok(
    resolved.value.map(({ entry, item, points, opens }) => ({
      entry,
      label: item.source,
      withheld: points && !opens,
    })),
  );
};

type RowRead = { readonly frontmatter: Frontmatter; readonly body: string };

const ROW_TO_EDIT = `SELECT c.frontmatter, c.body FROM concept_index c
  WHERE c.workspace_id = $1 AND c.iri = $4 AND ${readableClause("c", 2)}`;

const rowToEdit = async (
  principal: UserPrincipal,
  tx: Tx,
  iri: ConceptIri,
): Promise<RowRead | undefined> => {
  const read = await tx.query<RowRead>(ROW_TO_EDIT, [
    principal.workspaceId,
    ...readableParameters(principal),
    iri,
  ]);
  return read.rows[0];
};

const conceptToEditAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<EditedConcept>(),
  refuses: ["role-forbids", "malformed", "no-such-concept"],
});

export type ConceptToEditRefusal = RefusalOf<typeof conceptToEditAction>;

export const conceptToEditInput = z.union([
  z.strictObject({ iri: ids.conceptIri }),
  z.strictObject({ collection: z.string().regex(COLLECTION) }),
]);

export const conceptToEdit = async (
  principal: UserPrincipal,
  tx: Tx,
  asked: EditedConcept,
  passageAt: PassageReader,
): Promise<Result<ConceptToEdit, ConceptToEditRefusal | Error>> => {
  const admitted = admit(conceptToEditAction, principal, asked);
  if (!admitted.ok) return err(admitted.error);
  const target = conceptToEditInput.safeParse(asked);
  if (!target.success) return err("malformed");
  const reader = admitted.value;

  const { data } = target;
  if ("collection" in data) {
    const standing = await attempt(() => routeOf(reader, tx, ownedInCollection(data.collection)));
    if (!standing.ok) return err(standing.error);
    return ok({
      parts: EMPTY_PARTS,
      sources: [],
      withheld: [],
      base: null,
      standing: standing.value,
      usedIn: 0,
    });
  }
  return standingToEdit(reader, tx, data.iri, passageAt);
};

const standingToEdit = async (
  reader: UserPrincipal,
  tx: Tx,
  iri: ConceptIri,
  passageAt: PassageReader,
): Promise<Result<ConceptToEdit, ConceptToEditRefusal | Error>> => {
  const read = await attempt(async () => {
    const held = await heldByIri(reader, tx, iri);
    const row = await rowToEdit(reader, tx, iri);
    if (held === undefined || row === undefined) return undefined;
    return {
      held,
      row,
      standing: await routeOf(reader, tx, { iri, path: held.path }),
    };
  });
  if (!read.ok) return err(read.error);
  if (read.value === undefined) return err("no-such-concept");
  const { held, row, standing } = read.value;
  const usedIn = standing === "commits" ? await placesUsingReadableOrNot(reader, tx, iri) : 0;
  const opened = await openedSourcesOf(reader, tx, row.frontmatter, passageAt);
  if (!opened.ok) return err(opened.error);
  return ok({
    parts: partsOf(row.frontmatter, row.body, held),
    sources: opened.value.filter((source) => !source.withheld).map((source) => source.entry),
    withheld: withheldOf(opened.value),
    base: held.contentHash,
    standing,
    usedIn,
  });
};

const withheldOf = (opened: readonly Opened[]): readonly WithheldSource[] =>
  opened.flatMap((source, at) => (source.withheld ? [{ at, label: source.label }] : []));

const withWithheldInPlace = (
  stored: readonly Opened[],
  visible: readonly SourceEntry[],
): readonly SourceEntry[] => {
  const offered = visible[Symbol.iterator]();
  const merged: SourceEntry[] = [];
  for (const source of stored) {
    if (source.withheld) {
      merged.push(source.entry);
      continue;
    }
    const next = offered.next();
    if (next.done !== true) merged.push(next.value);
  }
  merged.push(...offered);
  return merged;
};

const isEmpty = (value: FrontmatterValue | null): boolean =>
  value === null || value === "" || (Array.isArray(value) && value.length === 0);

const withPart = (
  frontmatter: Frontmatter,
  key: string,
  value: FrontmatterValue | null,
): Frontmatter => {
  if (isDeepStrictEqual(frontmatter[key], value) || (isEmpty(value) && !(key in frontmatter))) {
    return frontmatter;
  }
  if (value === null || isEmpty(value)) {
    return Object.fromEntries(Object.entries(frontmatter).filter(([named]) => named !== key));
  }
  return { ...frontmatter, [key]: value };
};

const sourcesValueOf = (
  sources: readonly SourceEntry[],
): readonly string[] | readonly FrontmatterSource[] | undefined => {
  const texts = sources.filter((entry) => typeof entry === "string");
  const records = sources.filter((entry) => typeof entry !== "string");
  if (texts.length > 0 && records.length > 0) return undefined;
  return texts.length > 0 ? texts : records;
};

type EditedFile = ConceptFile & { readonly title: string; readonly kind: string };

const rendersAlike = (one: ConceptFile, other: ConceptFile): boolean =>
  renderConceptFile(one.frontmatter, one.body) === renderConceptFile(other.frontmatter, other.body);

const editedFileOf = (
  stored: ConceptFile,
  parts: ConceptParts,
  sources: readonly SourceEntry[],
): EditedFile | undefined => {
  const listed = sourcesValueOf(sources);
  if (listed === undefined) return undefined;
  const edited: readonly (readonly [string, FrontmatterValue | null])[] = [
    ["title", parts.title],
    ["type", parts.kind],
    ["description", parts.description],
    ["tags", parts.tags],
    ["sources", listed],
  ];
  const frontmatter = edited.reduce(
    (file, [key, value]) => withPart(file, key, value),
    stored.frontmatter,
  );
  return { frontmatter, body: parts.body, title: parts.title, kind: parts.kind };
};

const sourceLabelRefusalOf = (
  offered: readonly SourceEntry[],
): "source-label-refused" | undefined =>
  offered.some(
    (entry) => typeof entry === "string" && parsedPassageLocator(entry.trim()) !== undefined,
  )
    ? "source-label-refused"
    : undefined;

const citedLocatorsOf = (sources: FrontmatterValue | undefined): readonly (string | null)[] =>
  citedSourcesOf(sources).map((source) => source.locator);

const bodyLocatorRefusalOf = (
  body: string,
  namable: readonly (string | null)[],
): "body-locator-refused" | undefined => {
  const named = new Set(namable);
  return passageLocatorsIn(body).some((locator) => !named.has(locator))
    ? "body-locator-refused"
    : undefined;
};

const slugOf = (title: string): string =>
  title
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

const newConceptPathOf = (collection: string, title: string): string | undefined => {
  const slug = slugOf(title);
  const path = `knowledge/${collection}/${slug}.md`;
  return COLLECTION.test(collection) &&
    slug !== "" &&
    CONCEPT_PATH.test(path) &&
    isPortablePath(path)
    ? path
    : undefined;
};

const SOURCE_ENTRY = z.union([
  z.string(),
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).readonly(),
]);

const SAVED_FIELDS = {
  parts: z.strictObject({
    title: boundarySchemas.conceptIndex.insert.shape.title,
    kind: boundarySchemas.conceptIndex.insert.shape.kind,
    description: z.string().nullable(),
    tags: z.array(z.string().trim().min(1)).readonly(),
    body: boundarySchemas.conceptIndex.insert.shape.body,
  }),
  sources: z.array(SOURCE_ENTRY).readonly(),
  base: boundarySchemas.conceptIndex.insert.shape.contentHash.nullable(),
  withheld: z.array(z.number().int().min(0)).readonly(),
  reuse: z.literal("confirmed").optional(),
};

export const saveConceptInput = z.union([
  z.strictObject({ ...SAVED_FIELDS, iri: ids.conceptIri }),
  z.strictObject({ ...SAVED_FIELDS, collection: z.string().regex(COLLECTION) }),
]);

export type SaveConceptInput = z.input<typeof saveConceptInput>;

export type ConceptSaved =
  | { readonly outcome: "committed"; readonly iri: ConceptIri; readonly sha: string }
  | { readonly outcome: "unchanged"; readonly iri: string }
  | { readonly outcome: "suggested"; readonly suggestionId: string };

const saveConceptAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<SaveConceptInput>(),
  refuses: [
    "role-forbids",
    "malformed",
    "no-such-concept",
    "stale-precondition",
    "source-label-refused",
    "body-locator-refused",
  ],
});

export type SaveConceptRefusal =
  | RefusalOf<typeof saveConceptAction>
  | WriteConceptRefusal
  | SubmitSuggestionSetRefusal;

type Commit = {
  readonly iri: string | undefined;
  readonly path: string;
  readonly mergeKey: string;
  readonly base: string | null;
  readonly file: EditedFile;
  readonly author: CommitAuthor;
  readonly reuse: "confirmed" | undefined;
  readonly message: string;
};

type Saving = Commit & {
  readonly heldKey: string;
  readonly storedBody: string;
  readonly offered: readonly SourceEntry[];
  readonly standing: Standing;
  readonly unchanged: boolean;
};

type Parsed = z.output<typeof saveConceptInput>;

const inMember = async <Value, Refused>(
  principal: UserPrincipal,
  postgres: PostgresDoor,
  work: (fresh: UserPrincipal, tx: Tx) => Promise<Result<Value, Refused>>,
): Promise<Result<Value, Refused | PrincipalRefusal | Error>> => {
  const read = await attempt(() => withMember(principal, postgres, work));
  if (!read.ok) return err(read.error);
  return read.value.ok ? read.value.value : err(read.value.error);
};

type SaveDoors = WriteDoors & {
  readonly passages: (principal: UserPrincipal, tx: Tx) => PassageReader;
};

export const saveConcept = async (
  principal: UserPrincipal,
  doors: SaveDoors,
  input: SaveConceptInput,
): Promise<Result<ConceptSaved, SaveConceptRefusal | Error>> => {
  const admitted = admit(saveConceptAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const parsed = saveConceptInput.safeParse(input);
  if (!parsed.success) return err("malformed");
  const saving =
    "iri" in parsed.data
      ? await savingOver(admitted.value, doors, parsed.data, parsed.data.iri)
      : await savingNew(admitted.value, doors, parsed.data, parsed.data.collection);
  if (!saving.ok) return err(saving.error);
  const refusal =
    sourceLabelRefusalOf(saving.value.offered) ??
    bodyLocatorRefusalOf(saving.value.file.body, namableBy(saving.value));
  return refusal === undefined ? routed(admitted.value, doors, saving.value) : err(refusal);
};

const namableBy = (saving: Saving): readonly (string | null)[] =>
  saving.standing === "commits"
    ? citedLocatorsOf(saving.file.frontmatter["sources"])
    : [...citedLocatorsOf(sourcesValueOf(saving.offered)), ...passageLocatorsIn(saving.storedBody)];

type StoredToSave = {
  readonly held: Held;
  readonly stored: ConceptFile;
  readonly opened: readonly Opened[];
  readonly standing: Standing;
  readonly author: CommitAuthor;
};

const savingOver = async (
  principal: UserPrincipal,
  doors: SaveDoors,
  input: Parsed,
  iri: ConceptIri,
): Promise<Result<Saving, SaveConceptRefusal | Error>> => {
  const read = await inMember(
    principal,
    doors.postgres,
    async (fresh, tx): Promise<Result<StoredToSave, SaveConceptRefusal | Error>> => {
      const held = await heldByIri(fresh, tx, iri);
      if (held === undefined) return err("no-such-concept" as const);
      if (held.contentHash !== input.base) return err("stale-precondition" as const);
      const stored = await storedFileOf(fresh, doors.git, held);
      if (!stored.ok) return stored;
      const opened = await openedSourcesOf(
        fresh,
        tx,
        stored.value.frontmatter,
        doors.passages(fresh, tx),
      );
      if (!opened.ok) return opened;
      const withheld = withheldOf(opened.value).map((source) => source.at);
      if (!isDeepStrictEqual(withheld, input.withheld)) return err("stale-precondition" as const);
      return ok({
        held,
        stored: stored.value,
        opened: opened.value,
        standing: await routeOf(fresh, tx, { iri, path: held.path }),
        author: await authorOf(fresh, tx, fresh.userId),
      });
    },
  );
  if (!read.ok) return err(read.error);
  const { held, stored, opened, standing, author } = read.value;
  const file = editedFileOf(stored, input.parts, withWithheldInPlace(opened, input.sources));
  if (file === undefined) return err("malformed");
  return ok({
    iri,
    path: held.path,
    mergeKey: mergeKeyMovedBy(held, input.parts) ?? held.mergeKey,
    heldKey: held.mergeKey,
    storedBody: stored.body,
    base: held.contentHash,
    file,
    offered: input.sources,
    standing,
    unchanged: rendersAlike(stored, file),
    author,
    reuse: input.reuse,
    message: `Edit ${held.path}`,
  });
};

const savingNew = async (
  principal: UserPrincipal,
  doors: SaveDoors,
  input: Parsed,
  collection: string,
): Promise<Result<Saving, SaveConceptRefusal | Error>> => {
  const path = newConceptPathOf(collection, input.parts.title);
  const file = editedFileOf({ frontmatter: {}, body: "" }, input.parts, input.sources);
  const fresh = input.base === null && input.withheld.length === 0;
  if (path === undefined || file === undefined || !fresh) return err("malformed");
  const read = await attempt(() =>
    withMember(principal, doors.postgres, async (member, tx) => ({
      standing: await routeOf(member, tx, { iri: null, path }),
      author: await authorOf(member, tx, member.userId),
    })),
  );
  if (!read.ok) return err(read.error);
  if (!read.value.ok) return err(read.value.error);
  const mergeKey = mergeKeyOf(foldKind(input.parts.kind), input.parts.title);
  return ok({
    iri: undefined,
    path,
    mergeKey,
    heldKey: mergeKey,
    storedBody: "",
    base: null,
    file,
    offered: input.sources,
    unchanged: false,
    ...read.value.value,
    reuse: input.reuse,
    message: `Add ${path}`,
  });
};

const routed = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  saving: Saving,
): Promise<Result<ConceptSaved, SaveConceptRefusal | Error>> => {
  const unchanged = ok({ outcome: "unchanged" as const, iri: saving.iri ?? saving.path });
  if (saving.standing === "suggests") {
    return saving.unchanged ? unchanged : suggested(principal, doors, saving);
  }
  const written = await committed(principal, doors, saving);
  if (written.ok)
    return ok({ outcome: "committed", iri: written.value.iri, sha: written.value.sha });
  if (written.error === "unchanged") return unchanged;
  return written.error === "owner-forbids"
    ? suggested(principal, doors, saving)
    : err(written.error);
};

const committed = (
  principal: UserPrincipal,
  doors: WriteDoors,
  edit: Commit,
): Promise<Result<ConceptWritten, WriteConceptRefusal | Error>> => {
  const write: WriteConceptInput = {
    iri: edit.iri,
    mergeKey: edit.mergeKey,
    path: edit.path,
    kind: edit.file.kind,
    title: edit.file.title,
    frontmatter: edit.file.frontmatter,
    body: edit.file.body,
    message: edit.message,
    author: edit.author,
    expects: { base: edit.base },
    reuse: edit.reuse,
  };
  return writeConcept(
    principal,
    doors,
    edit.iri === undefined ? { ...write, ...SAVED_NEW } : write,
  );
};

const suggested = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  saving: Saving,
): Promise<Result<ConceptSaved, SaveConceptRefusal | Error>> => {
  const submitted = await submitSuggestionSet(principal, doors, {
    kind: SUGGESTION_EDIT_KIND,
    requests: [
      {
        mergeKey: saving.heldKey,
        path: saving.path,
        conceptKind: saving.file.kind,
        title: saving.file.title,
        frontmatter: saving.file.frontmatter,
        body: saving.file.body,
        ...(saving.base === null ? {} : { baseContentHash: saving.base }),
      },
    ],
  });
  if (!submitted.ok) return err(submitted.error);
  const [suggestionId] = submitted.value.suggestionIds;
  return suggestionId === undefined
    ? err(new Error("a suggestion set of one answered no suggestion"))
    : ok({ outcome: "suggested", suggestionId });
};

export type ConceptBodyRun =
  | { readonly dryRun: true; readonly base?: string | undefined }
  | { readonly dryRun: false; readonly base: string };

export type UpdateConceptBodyInput = {
  readonly iri: string;
  readonly body: string;
} & ConceptBodyRun;

type BodyAt = { readonly contentHash: string; readonly body: string };

export type ConceptBodyUpdate = {
  readonly iri: ConceptIri;
  readonly path: string;
  readonly from: BodyAt;
  readonly to: BodyAt;

  readonly written: ConceptWritten | undefined;
};

const updateConceptBodyAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<UpdateConceptBodyInput>(),
  refuses: [
    "role-forbids",
    "owner-forbids",
    "malformed",
    "no-such-concept",
    "unchanged",
    "stale-precondition",
    "body-locator-refused",
  ],
});

export type UpdateConceptBodyRefusal =
  | RefusalOf<typeof updateConceptBodyAction>
  | WriteConceptRefusal;

type StandingBody = {
  readonly held: Held;
  readonly author: CommitAuthor;
  readonly file: ConceptFile;
};

const standingBodyOf = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  iri: ConceptIri,
): Promise<Result<StandingBody, UpdateConceptBodyRefusal | Error>> => {
  const read = await inMember(principal, doors.postgres, async (fresh, tx) => {
    const held = await heldByIri(fresh, tx, iri);
    if (held === undefined) return err("no-such-concept" as const);
    const refusal = await ownerAdmits(fresh, tx, { iri, path: held.path });
    if (refusal !== undefined) return err(refusal);
    return ok({ held, author: await authorOf(fresh, tx, fresh.userId) });
  });
  if (!read.ok) return err(read.error);
  const { held, author } = read.value;
  const file = await storedFileOf(principal, doors.git, held);
  return file.ok ? ok({ held, author, file: file.value }) : err(file.error);
};

const wellFormedOf = (asked: string, body: string): ConceptIri | undefined => {
  const iri = ids.conceptIri.safeParse(asked);
  const fits = boundarySchemas.conceptIndex.insert.shape.body.safeParse(body);
  return iri.success && fits.success && body.trim() !== "" ? iri.data : undefined;
};

const bodyRefusalOf = (
  { held, file }: StandingBody,
  to: ConceptFile,
  base: string | undefined,
): UpdateConceptBodyRefusal | undefined => {
  if (rendersAlike(file, to)) return "unchanged";
  if (base !== undefined && base !== held.contentHash) return "stale-precondition";
  return bodyLocatorRefusalOf(to.body, citedLocatorsOf(to.frontmatter["sources"]));
};

/**
 * Replaces a standing concept's body. Its frontmatter, status, verifications and citations stay.
 */
export const updateConceptBody = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  input: UpdateConceptBodyInput,
): Promise<Result<ConceptBodyUpdate, UpdateConceptBodyRefusal | Error>> => {
  const admitted = admit(updateConceptBodyAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const body = normalisedBody(input.body);
  const iri = wellFormedOf(input.iri, body);
  if (iri === undefined) return err("malformed");

  const standing = await standingBodyOf(admitted.value, doors, iri);
  if (!standing.ok) return err(standing.error);
  const { held, author, file } = standing.value;
  const to = { frontmatter: file.frontmatter, body };
  const refusal = bodyRefusalOf(standing.value, to, input.base);
  if (refusal !== undefined) return err(refusal);

  const update = {
    iri,
    path: held.path,
    from: { contentHash: held.contentHash, body: file.body },
    to: { contentHash: contentHashOf(to.frontmatter, body, held.path), body },
  };
  if (input.dryRun) return ok({ ...update, written: undefined });

  const written = await committed(admitted.value, doors, {
    iri,
    path: held.path,
    mergeKey: held.mergeKey,
    base: input.base,
    file: { ...to, title: held.title, kind: held.kind },
    author,
    reuse: "confirmed",
    message: `Update the body of ${held.path} in place`,
  });
  if (!written.ok) return err(written.error);
  return ok({ ...update, written: written.value });
};
