import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  boundarySchemas,
  CONCEPT_STABLE_STATUS,
  conceptIriOf,
  type ConceptIri,
} from "@better-answers/schema";

import { widens, type Visibility } from "../../access/index.ts";
import { action, declareActions, record } from "../../audit/index.ts";
import { commitAndLandAsMember, foldKind, withBundleWrite } from "../../bundle/index.ts";
import {
  actorIdOf,
  admit,
  ANY_ROLE,
  attempt,
  declareAction,
  err,
  ok,
  refusalFor,
  ulid,
  type AdmittedOf,
  type Clock,
  type PrincipalRefusal,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";
import {
  ANY_HEAD,
  fileAtHead,
  type CommitAuthor,
  type Committed,
  type GitDoor,
} from "../../store/git/index.ts";
import { withMember, type PostgresDoor, type Tx } from "../../store/postgres/index.ts";
import { contentHashOf, parseConceptFile, renderConceptFile, type Frontmatter } from "../file.ts";
import {
  evidenceOfSources,
  heldByIri,
  heldVisibilityOf,
  holderOfPath,
  holdsEveryDocument,
  indexRowOf,
  type IndexRow,
  landRows,
  placesUsingReadableOrNot,
  WRITE_CONSTRAINTS,
  type EvidenceRow,
  type Held,
} from "../import/landing.ts";
import { IMPORT_SENSITIVITY_DEFAULT } from "../import/loader.ts";
import { deciderAdmits, ownerAdmits, standingConcept } from "../owners.ts";
import { conceptVisibilityFrom } from "../visibility.ts";
import type { PassedOnCommitRefusal } from "../vocabulary.ts";
import { mergeKeyMovedBy } from "./merge-key.ts";
import {
  conceptOfSuggestion,
  payloadFor,
  suggestionIsWaiting,
  targetOfMergeKey,
  type SuggestionKind,
  type SuggestionPayload,
} from "./suggestions.ts";

const CONCEPT_ACTIONS = declareActions("knowledge", {
  committed: action("knowledge.concept.committed", {
    iri: "iri",
    commitSha: "gitSha",
    contentHash: "contentHash",
    fromContentHash: "contentHash?",
    evidenceCount: "count",
  }),
  accepted: action("knowledge.suggestion.accepted", {
    iri: "iri",
    commitSha: "gitSha",
    contentHash: "contentHash",
    setId: "id",
  }),
});

type WritePrecondition = { readonly head: string | null } | { readonly base: string | null };

export type Acceptance = {
  readonly suggestionId: string;
  readonly setId: string;
  readonly kind: SuggestionKind;

  readonly batchId?: string | undefined;
};

export type WriteConceptInput = {
  readonly iri?: string | undefined;

  readonly mergeKey: string;

  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;

  readonly message: string;

  readonly author: CommitAuthor;

  readonly expects: WritePrecondition;

  readonly acceptance?: Acceptance | undefined;

  readonly sensitivity?: string;
  readonly status?: string;

  readonly reuse?: "confirmed" | undefined;
};

export type ConceptWritten = {
  readonly iri: ConceptIri;

  readonly sha: string;

  readonly auditEventId: string;
  readonly contentHash: string;
};

export const writeConceptAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<WriteConceptInput>(),
  refuses: [
    "role-forbids",
    "owner-forbids",
    "malformed",
    "no-such-concept",
    "no-such-document",
    "already-decided",
    "merge-key-taken",
    "resolution-moved",
    "stale-precondition",
    "rename-refused",
    "path-taken",
    "reclassification-refused",
    "unchanged",
    "widening-refused",
    "reuse-unconfirmed",
  ],
});

export type WriteConceptRefusal =
  | RefusalOf<typeof writeConceptAction>
  | PassedOnCommitRefusal
  | PrincipalRefusal;

const fileFrontmatterOf = (input: WriteConceptInput, iri: string) => {
  const named = { ...input.frontmatter };
  if (typeof named["type"] !== "string") named["type"] = input.kind;
  if (typeof named["title"] !== "string") named["title"] = input.title;
  if (input.status !== undefined) named["status"] = input.status;
  named["iri"] = iri;
  return named;
};

export type WriteDoors = {
  readonly git: GitDoor;
  readonly postgres: PostgresDoor;
  readonly clock: Clock;
};

export const writeConcept = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  input: WriteConceptInput,
): Promise<Result<ConceptWritten, WriteConceptRefusal | Error>> => {
  const admitted = admit(writeConceptAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  if (input.acceptance !== undefined && !acceptsAsProposed(input)) return err("malformed");
  return commitConcept(admitted.value, doors, input);
};

const acceptsAsProposed = (input: WriteConceptInput): boolean =>
  "base" in input.expects && input.status === undefined && input.sensitivity === undefined;

export const SAVED_NEW = {
  status: CONCEPT_STABLE_STATUS,
  sensitivity: IMPORT_SENSITIVITY_DEFAULT,
};

const landingStateOf = (input: WriteConceptInput): WriteConceptInput =>
  input.acceptance !== undefined && input.iri === undefined ? { ...input, ...SAVED_NEW } : input;

const commitConcept = async (
  principal: AdmittedOf<typeof writeConceptAction>,
  doors: WriteDoors,
  proposed: WriteConceptInput,
): Promise<Result<ConceptWritten, WriteConceptRefusal | Error>> => {
  const input = landingStateOf(proposed);
  const iri = input.iri ?? conceptIriOf(ulid());
  const frontmatter = fileFrontmatterOf(input, iri);
  const body = boundarySchemas.conceptIndex.insert.shape.body.safeParse(input.body);
  if (!body.success) return err("malformed");
  const contentHash = contentHashOf(frontmatter, input.body, input.path);
  const mergeKey = boundarySchemas.conceptIdentity.insert.shape.mergeKey.safeParse(input.mergeKey);
  const evidence = boundarySchemas.evidence.insert
    .array()
    .safeParse(evidenceOfSources(principal.workspaceId, frontmatter));
  if (!mergeKey.success || !evidence.success) return err("malformed");

  const auditEventId = ulid();

  return withBundleWrite(principal, doors, () =>
    writeUnderLock(principal, doors, {
      input,
      iri,
      frontmatter,
      contentHash,
      mergeKey: mergeKey.data,
      evidence: evidence.data,
      auditEventId,
    }),
  );
};

type ParsedWrite = {
  readonly input: WriteConceptInput;
  readonly iri: string;
  readonly frontmatter: Frontmatter;
  readonly contentHash: string;
  readonly mergeKey: string;
  readonly evidence: readonly EvidenceRow[];
  readonly auditEventId: string;
};

type Facts = {
  readonly held: Held | undefined;
  readonly derived: Visibility | undefined;
  readonly catalogued: boolean;
  readonly resolved: string | undefined;
  readonly landsAt: string;
  readonly landsOnto: string | undefined;
  readonly holder: string | undefined;
  readonly waiting: boolean;
  readonly places: number;
  readonly admission: WriteConceptRefusal | undefined;
};

type Existing = Facts & { readonly stored: string | undefined };

const writeUnderLock = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  write: ParsedWrite,
): Promise<Result<ConceptWritten, WriteConceptRefusal | Error>> => {
  const facts = await existingOf(principal, doors.postgres, write);
  if (!facts.ok) return err(facts.error);
  if (!facts.value.ok) return err(facts.value.error);
  const stored = await directEditStoredRender(principal, doors.git, write, facts.value.value.held);
  const existing = { ...facts.value.value, stored };
  const refusal = existing.admission ?? writeRefusalOf(write, existing);
  if (refusal !== undefined) return err(refusal);

  const now = doors.clock.now();
  const parsed = indexRowOf(
    {
      workspaceId: principal.workspaceId,
      iri: write.iri,
      path: write.input.path,
      kind: write.input.kind,
      title: write.input.title,
      frontmatter: write.frontmatter,
      body: write.input.body,
      contentHash: write.contentHash,
      status: write.input.status,
      sensitivity: write.input.sensitivity,
    },
    existing.held,
    now,
  );
  if (!parsed.success) return err("malformed");
  const row = parsed.data;

  const landed = await commitAndLandWrite(principal, doors, write, row, {
    at: now,
    fromContentHash: existing.held?.contentHash,
    landsAt: existing.landsAt,
  });
  if (!landed.ok) return err(landed.error);

  return ok({
    iri: row.iri,
    sha: landed.value.sha,
    auditEventId: write.auditEventId,
    contentHash: write.contentHash,
  });
};

const existingOf = (principal: UserPrincipal, postgres: PostgresDoor, write: ParsedWrite) =>
  attempt(() =>
    withMember(principal, postgres, async (fresh, tx): Promise<Facts> => {
      const { input, iri } = write;
      const admission = await writersRefusal(fresh, tx, write, input.path);
      const held = await heldByIri(fresh, tx, iri);
      const landsAt = landingKeyOf(write, held);
      return {
        admission,
        held,

        derived:
          held === undefined
            ? undefined
            : await conceptVisibilityFrom(fresh, tx, {
                iri,
                kind: foldKind(input.kind),
                fallback: heldVisibilityOf(held),
                citing: write.evidence.map((piece) => piece.sourceDocumentId),
              }),

        catalogued: await holdsEveryDocument(
          fresh,
          tx,
          write.evidence.map((piece) => piece.sourceDocumentId),
        ),

        resolved: await targetOfMergeKey(fresh, tx, input.mergeKey),
        landsAt,
        landsOnto:
          landsAt === write.mergeKey ? undefined : await targetOfMergeKey(fresh, tx, landsAt),
        holder: await holderOfPath(fresh, tx, input.path),
        waiting:
          input.acceptance === undefined ||
          (await suggestionIsWaiting(fresh, tx, input.acceptance.suggestionId)),
        places: asksReuse(write, held) ? await placesUsingReadableOrNot(fresh, tx, iri) : 0,
      };
    }),
  );

const landingKeyOf = ({ input, mergeKey }: ParsedWrite, held: Held | undefined): string => {
  if (input.acceptance === undefined || held === undefined) return mergeKey;
  return mergeKeyMovedBy(held, input) ?? mergeKey;
};

const WRITE_REFUSALS: readonly (readonly [
  WriteConceptRefusal,
  (write: ParsedWrite, existing: Existing) => boolean,
])[] = [
  ["no-such-concept", ({ input }, { held }) => input.iri !== undefined && held === undefined],
  ["no-such-document", (_, { catalogued }) => !catalogued],
  ["already-decided", (_, { waiting }) => !waiting],
  [
    "merge-key-taken",
    ({ iri }, { resolved, landsOnto }) =>
      (resolved !== undefined && resolved !== iri) ||
      (landsOnto !== undefined && landsOnto !== iri),
  ],
  [
    "resolution-moved",
    ({ input, iri }, { resolved }) =>
      input.acceptance !== undefined && input.iri !== undefined && resolved !== iri,
  ],
  [
    "stale-precondition",
    ({ input }, { held }) =>
      "base" in input.expects && (held?.contentHash ?? null) !== input.expects.base,
  ],
  ["rename-refused", ({ input }, { held }) => held !== undefined && held.path !== input.path],
  ["path-taken", ({ iri }, { holder }) => holder !== undefined && holder !== iri],
  [
    "reclassification-refused",
    ({ input }, { held }) =>
      held !== undefined &&
      input.sensitivity !== undefined &&
      input.sensitivity !== held.sensitivity,
  ],
  [
    "unchanged",
    (write, { stored, held }) => stored === renderedOf(write) && rowsAsHeld(write, held),
  ],
  [
    "widening-refused",
    (_, { held, derived }) =>
      held !== undefined && derived !== undefined && widens(heldVisibilityOf(held), derived),
  ],
  ["reuse-unconfirmed", (_, { places }) => places > 1],
];

const renderedOf = (write: ParsedWrite): string =>
  renderConceptFile(write.frontmatter, write.input.body);

const rowsAsHeld = ({ input, mergeKey }: ParsedWrite, held: Held | undefined): boolean =>
  held?.mergeKey === mergeKey && held.title === input.title && held.kind === foldKind(input.kind);

const isDirectEdit = ({ input }: ParsedWrite, held: Held | undefined): held is Held =>
  held !== undefined && input.acceptance === undefined;

const asksReuse = (write: ParsedWrite, held: Held | undefined): boolean =>
  isDirectEdit(write, held) && write.input.reuse !== "confirmed";

const directEditStoredRender = async (
  principal: UserPrincipal,
  door: GitDoor,
  write: ParsedWrite,
  held: Held | undefined,
): Promise<string | undefined> => {
  if (!isDirectEdit(write, held) || write.contentHash !== held.contentHash) return undefined;
  const stored = await storedFileOf(principal, door, held);
  return stored.ok ? renderConceptFile(stored.value.frontmatter, stored.value.body) : undefined;
};

export type ConceptFile = { readonly frontmatter: Frontmatter; readonly body: string };

const disagreement = (path: string, why: string): Error =>
  new Error(`the bundle and the index disagree: ${path} ${why}`);

export const storedFileOf = async (
  principal: UserPrincipal,
  door: GitDoor,
  held: Held,
): Promise<Result<ConceptFile, "stale-precondition" | Error>> => {
  const content = await attempt(() => fileAtHead(principal, door, held.path));
  if (!content.ok) return err(content.error);
  if (content.value === null) return err(disagreement(held.path, "is not in the bundle's head"));
  const parsed = parseConceptFile(content.value);
  if (!parsed.ok) return err(disagreement(held.path, "does not parse at the bundle's head"));
  const { frontmatter, body } = parsed.value;
  return contentHashOf(frontmatter, body, held.path) === held.contentHash
    ? ok(parsed.value)
    : err("stale-precondition");
};

const writeRefusalOf = (write: ParsedWrite, existing: Existing): WriteConceptRefusal | undefined =>
  WRITE_REFUSALS.find(([, refuses]) => refuses(write, existing))?.[0];

const writersRefusal = async (
  fresh: UserPrincipal,
  tx: Tx,
  write: ParsedWrite,
  path: string,
): Promise<WriteConceptRefusal | undefined> => {
  const { input } = write;
  if (input.acceptance === undefined) {
    return ownerAdmits(fresh, tx, await standingConcept(fresh, tx, write.iri, path));
  }
  const payload = await payloadFor(fresh, tx, input.acceptance.suggestionId);
  if (payload === undefined) return "already-decided";
  const concept = await conceptOfSuggestion(fresh, tx, payload);
  const refusal = await deciderAdmits(fresh, tx, concept, payload.kind);
  if (refusal !== undefined) return refusal;
  return writesItsSuggestion(write, payload) ? undefined : "malformed";
};

const writesItsSuggestion = (write: ParsedWrite, payload: SuggestionPayload) =>
  namesItsSuggestion(write, payload) && carriesItsProposal(write, payload);

const namesItsSuggestion = ({ input, mergeKey }: ParsedWrite, payload: SuggestionPayload) =>
  payload.kind === input.acceptance?.kind &&
  payload.mergeKey === mergeKey &&
  payload.path === input.path &&
  payload.conceptKind === input.kind;

const carriesItsProposal = ({ input }: ParsedWrite, payload: SuggestionPayload) =>
  payload.title === input.title &&
  payload.body === input.body &&
  isDeepStrictEqual(payload.frontmatter, input.frontmatter) &&
  "base" in input.expects &&
  payload.baseContentHash === input.expects.base;

type WriteLanding = {
  readonly at: Date;
  readonly fromContentHash: string | undefined;
  readonly landsAt: string;
};

const commitAndLandWrite = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  write: ParsedWrite,
  row: IndexRow,
  landing: WriteLanding,
): Promise<Result<Committed, WriteConceptRefusal | Error>> => {
  const { input } = write;
  const landed = await commitAndLandAsMember(
    principal,
    doors,
    {
      path: row.path,
      content: renderConceptFile(write.frontmatter, input.body),
      message: input.message,
      author: input.author,
      trailers: {
        actor: actorIdOf(principal),
        audit: write.auditEventId,
        suggestion: input.acceptance?.suggestionId,
      },
      expectedHead: "head" in input.expects ? input.expects.head : ANY_HEAD,
      at: landing.at,
    },
    (fresh, tx, committed) => landWrite(fresh, tx, write, row, committed, landing),
    (fresh, tx) => writersRefusal(fresh, tx, write, row.path),
  );
  if (!landed.ok && landed.error instanceof Error) {
    const named = refusalFor(landed.error, WRITE_CONSTRAINTS);
    return err(typeof named === "string" ? named : landed.error);
  }
  return landed;
};

const landWrite = async (
  fresh: UserPrincipal,
  tx: Tx,
  write: ParsedWrite,
  row: IndexRow,
  committed: Committed,
  { fromContentHash, landsAt }: WriteLanding,
): Promise<void> => {
  const acceptance = write.input.acceptance;
  if (acceptance === undefined) {
    const detail = {
      iri: row.iri,
      commitSha: committed.sha,
      contentHash: write.contentHash,
      evidenceCount: write.evidence.length,
    };
    await record(fresh, tx, {
      id: write.auditEventId,
      action: CONCEPT_ACTIONS.committed,
      subjectId: row.iri,
      detail: fromContentHash === undefined ? detail : { ...detail, fromContentHash },
    });
  } else {
    await record(fresh, tx, {
      id: write.auditEventId,
      action: CONCEPT_ACTIONS.accepted,
      subjectId: acceptance.suggestionId,
      batchId: acceptance.batchId,
      detail: {
        iri: row.iri,
        commitSha: committed.sha,
        contentHash: write.contentHash,
        setId: acceptance.setId,
      },
    });
  }
  await landRows(fresh, tx, {
    ...row,
    mergeKey: landsAt,
    commit: committed,
    actor: actorIdOf(fresh),
    auditEventId: write.auditEventId,
    evidence: write.evidence,
    restsAlsoOn: [],
    acceptance,
  });
};
