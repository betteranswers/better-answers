import { z } from "zod";

import { COLLECTION, ids, parsedPassageLocator, type ConceptIri } from "@better-answers/schema";

import { readableClause, readableParameters } from "../../access/index.ts";
import {
  admit,
  ANY_ROLE,
  attempt,
  declareAction,
  err,
  ok,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";
import type { Tx } from "../../store/postgres/index.ts";
import type { Frontmatter, FrontmatterSource, FrontmatterValue } from "../file.ts";
import { heldByIri, placesUsingReadableOrNot, type Held } from "../import/landing.ts";
import { ownerOf, standingConcept, type OwnedConcept } from "../owners.ts";
import { resolvedSourcesOf, type PassageReader } from "../reading/read.ts";

export type SourceEntry = string | FrontmatterSource;

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

export const routeOf = async (
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

export type Opened = {
  readonly entry: SourceEntry;
  readonly label: string;
  readonly withheld: boolean;
};

export const openedSourcesOf = async (
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

export const withheldOf = (opened: readonly Opened[]): readonly WithheldSource[] =>
  opened.flatMap((source, at) => (source.withheld ? [{ at, label: source.label }] : []));
