import { z } from "zod";

import { boundarySchemas, SUGGESTION_EDIT_KIND, SUGGESTION_SET_MAX } from "@better-answers/schema";

import { batchIdFor } from "../../audit/index.ts";
import {
  admit,
  ANY_ROLE,
  attempt,
  declareAction,
  err,
  ok,
  personOfActor,
  type PrincipalRefusal,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";
import { type CommitAuthor } from "../../store/git/index.ts";
import { withMember, type PostgresDoor, type Tx } from "../../store/postgres/index.ts";
import {
  payloadFor,
  returnToProposer,
  targetOfMergeKey,
  type SuggestionPayload,
} from "./suggestions.ts";
import {
  writeConcept,
  type ConceptWritten,
  type WriteConceptRefusal,
  type WriteDoors,
} from "./write.ts";

export type AcceptanceDecision = {
  readonly suggestionId: string;
  readonly expectedTarget: string | null;
};

const ACCEPTANCE_DECISIONS = z
  .object({
    suggestionId: boundarySchemas.suggestion.select.shape.id,
    expectedTarget: boundarySchemas.suggestion.select.shape.targetIri,
  })
  .array()
  .nonempty()
  .max(SUGGESTION_SET_MAX);

export type AcceptSuggestionRefusal =
  | WriteConceptRefusal
  | "no-such-suggestion"
  | "already-decided"
  | "resolution-moved";

export type AcceptanceOutcome = {
  readonly suggestionId: string;
  readonly outcome: Result<ConceptWritten, AcceptSuggestionRefusal | Error>;
};

type AuthorRow = { readonly name: string; readonly email: string };

const authorFor = async (
  principal: UserPrincipal,
  tx: Tx,
  payload: SuggestionPayload,
): Promise<CommitAuthor | undefined> => {
  const proposer =
    payload.kind === SUGGESTION_EDIT_KIND ? personOfActor(payload.proposer) : undefined;
  for (const personId of proposer === undefined
    ? [principal.userId]
    : [proposer, principal.userId]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the principal is looked up only when the proposer was not found
    const found = await tx.query<AuthorRow>(
      `SELECT u.name, u.email FROM "user" u
         JOIN member m ON m.user_id = u.id AND m.workspace_id = $2
        WHERE u.id = $1`,
      [personId, principal.workspaceId],
    );
    const row = found.rows[0];
    if (row !== undefined) return { name: row.name, email: row.email };
  }
  return undefined;
};

type Prepared = {
  readonly payload: SuggestionPayload;
  readonly target: string | undefined;
  readonly author: CommitAuthor;
};

const acceptanceMessage = (title: string): string =>
  `Accept the suggested change to ${title.replaceAll(/\s+/gu, " ").trim()}`;

type AcceptSuggestionsInput = { readonly decisions: readonly AcceptanceDecision[] };

const acceptSuggestionsAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<AcceptSuggestionsInput>(),
  refuses: ["role-forbids", "malformed"],
});

export const acceptSuggestions = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  input: AcceptSuggestionsInput,
): Promise<
  Result<
    readonly AcceptanceOutcome[],
    RefusalOf<typeof acceptSuggestionsAction> | PrincipalRefusal | Error
  >
> => {
  const admitted = admit(acceptSuggestionsAction, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const decisions = ACCEPTANCE_DECISIONS.safeParse(input.decisions);
  if (!decisions.success) return err("malformed");

  const batchId = batchIdFor(decisions.data.length);
  const outcomes: AcceptanceOutcome[] = [];
  for (const decision of decisions.data) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each acceptance lands as its own commit, in the order the admin decided them
    outcomes.push(await acceptOne(admitted.value, doors, decision, batchId));
  }
  return ok(outcomes);
};

const preparedFor = async (
  principal: UserPrincipal,
  postgres: PostgresDoor,
  suggestionId: string,
): Promise<Result<Prepared, AcceptSuggestionRefusal | Error>> => {
  const prepared = await attempt(() =>
    withMember(principal, postgres, async (fresh, tx) => {
      const payload = await payloadFor(fresh, tx, suggestionId);
      if (payload === undefined) return undefined;
      const target = await targetOfMergeKey(fresh, tx, payload.mergeKey);
      const author = await authorFor(fresh, tx, payload);
      return author === undefined ? undefined : { payload, target, author };
    }),
  );
  if (!prepared.ok) return err(prepared.error);
  if (!prepared.value.ok) return err(prepared.value.error);
  const found: Prepared | undefined = prepared.value.value;
  return found === undefined ? err("no-such-suggestion") : ok(found);
};

const acceptanceOf = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  decision: AcceptanceDecision,
  found: Prepared,
  batchId: string | undefined,
): Promise<Result<ConceptWritten, AcceptSuggestionRefusal | Error>> => {
  if ((found.target ?? null) !== decision.expectedTarget) return err("resolution-moved");

  return writeConcept(principal, doors, {
    iri: found.target,
    mergeKey: found.payload.mergeKey,
    path: found.payload.path,
    kind: found.payload.conceptKind,
    title: found.payload.title,
    frontmatter: found.payload.frontmatter,
    body: found.payload.body,
    message: acceptanceMessage(found.payload.title),
    author: found.author,
    expects: { base: found.payload.baseContentHash },
    acceptance: {
      suggestionId: decision.suggestionId,
      setId: found.payload.setId,
      kind: found.payload.kind,
      batchId,
    },
  });
};

const returnedToProposerOn = (
  refusal: AcceptSuggestionRefusal | Error,
): readonly [word: AcceptSuggestionRefusal, reason: string] | undefined => {
  if (refusal === "merge-key-taken" || refusal === "resolution-moved") {
    return [
      "resolution-moved",
      "the concept this suggestion resolves to moved after the set was opened",
    ];
  }
  if (refusal === "stale-precondition") {
    return ["stale-precondition", "the concept moved after this suggestion was written"];
  }
  return undefined;
};

const acceptOne = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  decision: AcceptanceDecision,
  batchId: string | undefined,
): Promise<AcceptanceOutcome> => {
  const { suggestionId } = decision;
  const prepared = await preparedFor(principal, doors.postgres, suggestionId);
  if (!prepared.ok) return { suggestionId, outcome: err(prepared.error) };

  const accepted = await acceptanceOf(principal, doors, decision, prepared.value, batchId);
  const returning = accepted.ok ? undefined : returnedToProposerOn(accepted.error);
  if (returning === undefined) return { suggestionId, outcome: accepted };

  const [word, reason] = returning;
  const returned = await returnToProposer(principal, doors, { suggestionId, reason });
  const keptWaiting =
    returned.ok || returned.error === "owner-forbids" || returned.error === "role-forbids";
  return { suggestionId, outcome: err(keptWaiting ? word : returned.error) };
};
