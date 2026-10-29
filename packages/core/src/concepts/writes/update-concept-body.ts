import { z } from "zod";

import { boundarySchemas, ids, type ConceptIri } from "@better-answers/schema";

import { authorOf } from "../../bundle/index.ts";
import {
  admit,
  ANY_ROLE,
  declareAction,
  err,
  ok,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";
import type { CommitAuthor } from "../../store/git/index.ts";
import { contentHashOf, normalisedBody } from "../file.ts";
import { heldByIri, type Held } from "../import/landing.ts";
import { ownerAdmits } from "../owners.ts";
import {
  inMember,
  rendersAlike,
  bodyLocatorRefusalOf,
  citedLocatorsOf,
  committed,
} from "./save-concept.ts";
import {
  storedFileOf,
  type ConceptFile,
  type ConceptWritten,
  type WriteConceptRefusal,
  type WriteDoors,
} from "./write.ts";

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
