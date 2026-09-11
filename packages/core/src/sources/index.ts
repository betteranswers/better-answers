import { boundarySchemas } from "@better-answers/schema";

import { visibilityFrom, visibilityOf, widens, type Visibility } from "../access/index.ts";
import { act, declareActs, record } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  requireAdmin,
  ulid,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import {
  openingACascadeOverHeldGroups,
  recomputeVisibilitySourcedFrom,
} from "../concepts/index.ts";
import { recomputeCompositionsIncluding } from "../guides/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/**
 * Slice: **sources** — bindings, the source catalogue, the publish and sensitivity gates,
 * retention classes (ADR 0013).
 *
 * A slice is the capability that owns a set of tables and the invariants over them — the
 * write path, not a screen (ADR 0029). What lands here is the one act the visibility
 * cascade needs (T-055): **narrowing a binding**, an Admin's, recorded on the ledger, which
 * recomputes every concept citing that binding's documents and then every composition
 * including those concepts — synchronously, inside this act's own transaction, two levels
 * (ADR 0023, ADR 0039). Binding a source, publishing it and widening its class are B7's
 * management surfaces and are not here.
 *
 * Beside it, S0's two: the **finding** restore (`findings.ts`), an Admin letting one span of
 * the always set back into a document with a reason, and the **DPIA input** (`dpia.ts`), a
 * binding's contribution to a data protection impact assessment as a typed document and its
 * hash. Both are the sources slice's because the finding and the binding are its records.
 *
 * Beside the act, the slice's address arithmetic: a chunk's derived id, the wire locator's
 * parse and the span it cuts, all pure and all held to the document-chunk agreement. And over
 * that arithmetic the read it exists for (`passages.ts`): **`passageAt`** resolves a wire
 * locator to the chunk rows covering its span, under the reader's predicate applied once in
 * the same statement, and answers the passage — or the one word *not found*, whether the
 * address was wrong, the text does not run that far or a covering row is withheld. Beside it
 * **`findPassages`** searches those same rows for a reader's words, ranked, leaving out any
 * document a concept they may see already cites (ADR 0016) and answering a list and only a
 * list: an address per hit, no text, and no total. And beside those two **`previewChunks`**,
 * the Admin's review list for a binding not yet published — the one read here or anywhere that
 * leaves the published arm out of its predicate, keeping the class and the audience arms, so
 * the person deciding whether to publish a binding has its chunks in front of them and nobody
 * else reaches them by any road at all.
 */

export {
  restoreFinding,
  type FindingRestored,
  type FindingRestoreRefusal,
  type RestoreFindingInput,
} from "./findings.ts";
export {
  dpiaInputFor,
  NOT_RECORDED,
  PLATFORM_HELD_CATEGORIES,
  REDACTION_CATEGORIES,
  SPECIAL_CATEGORY_CONDITION,
  type DpiaInput,
  type DpiaInputRead,
  type DpiaInputRefusal,
  type DpiaRoute,
  type RedactionCategory,
} from "./dpia.ts";

export {
  chunkIdOf,
  parseLocator,
  spanText,
  type Locator,
  type LocatorRefusal,
} from "./chunk-address.ts";
export {
  findPassages,
  MAX_PASSAGE_HITS,
  passageAt,
  previewChunks,
  type Passage,
  type PassageHit,
  type PreviewedChunk,
} from "./passages.ts";

/**
 * The narrowing act. Its subject is the binding and its detail what the Admin decided, in
 * the glossary's words for a class and an audience; the groups named are on the row.
 */
const SOURCE_ACTS = declareActs("sources", {
  narrowed: act("sources.binding.narrowed", {
    bindingId: "id",
    sensitivity: "sensitivity",
    audience: "audience",
  }),
});

export type NarrowBindingInput = {
  readonly bindingId: string;
  readonly sensitivity: string;
  readonly audience: string;
  /** The named groups when the audience is *groups*; `null` or absent for *everyone*. */
  readonly audienceGroups?: readonly string[] | null | undefined;
};

/**
 * Why a narrowing was refused. `widening-refused` is the one this act exists to say: a
 * looser class, *everyone* where groups were named, or a group the old list did not hold
 * would let a reader in that the binding kept out, and widening is a gated act of its own
 * (ADR 0013), B7's. `no-such-group` is an audience naming a group this workspace does not
 * hold — a list the predicate would read as *nobody*, which is a mistake to be told about
 * rather than a narrowing to land.
 */
export type NarrowBindingRefusal =
  | RoleRefusal
  | "malformed"
  | "no-such-binding"
  | "no-such-group"
  | "widening-refused"
  | Error;

export type BindingNarrowed = {
  readonly bindingId: string;
  readonly auditEventId: string;
  readonly visibility: Visibility;
  /** The concepts the first level of the cascade rewrote, by IRI. */
  readonly concepts: readonly string[];
  /** The compositions the second level rewrote. */
  readonly compositions: readonly string[];
};

const BINDING_ID = boundarySchemas.sourceBinding.select.shape.id;

type BindingRow = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly audience_groups: readonly string[] | null;
};

/**
 * Narrow a binding's class or audience, and everything derived from it, in one
 * transaction — the act ADR 0023's synchronous two-level cascade is defined around.
 *
 * Every refusal is decided before a row is written: the role, the shape, the binding's
 * existence, the groups named, and — against the binding as it stands — whether the move
 * would widen on any term. The binding's row is rewritten, the ledger row is written after
 * it and **bare** (its rejection aborts the transaction, ADR 0014 rule 4), and then the
 * cascade runs: the concepts slice re-derives every concept citing this binding's
 * documents, and the guides slice every composition including one of them. A narrowing
 * that changes nothing is allowed and recomputes all the same; the derivation is
 * idempotent.
 *
 * The binding's row is read `FOR UPDATE`, so this act queues behind a governed write whose
 * derivation holds the row `FOR SHARE` (`concepts/visibility.ts`) and its cascade then sees
 * that write's citation — the other half of the lock that keeps a write landing beside a
 * narrowing from committing a class the narrowed binding no longer allows.
 *
 * **Before that, at the very head of the transaction, the workspace's cascade lock**
 * (`openingACascadeOverHeldGroups`, over `serialisingCascades`): two narrowings of two bindings one concept cites would otherwise
 * each hold its own binding and want the other `FOR SHARE` through that concept — a deadlock
 * Postgres ends by aborting one Admin's act with a store failure. Narrowings in one workspace
 * run one after the other instead, which is what "synchronous, in the act's own transaction"
 * has to mean when there are two of them.
 */
export const narrowBinding = async (
  principal: UserPrincipal,
  tx: Tx,
  input: NarrowBindingInput,
): Promise<Result<BindingNarrowed, NarrowBindingRefusal>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const bindingId = BINDING_ID.safeParse(input.bindingId);
  const next = visibilityFrom(input);
  if (!bindingId.success || next === undefined) return err("malformed");
  const { workspaceId } = admin.value;

  const groups = await openingACascadeOverHeldGroups(admin.value, tx, next.audienceGroups ?? []);
  if (!groups.ok) return err(groups.error);
  const known = await attempt(() =>
    tx.query<BindingRow>(
      "SELECT sensitivity, audience, audience_groups FROM source_binding WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
      [workspaceId, bindingId.data],
    ),
  );
  if (!known.ok) return err(known.error);
  const current = known.value.rows[0];
  if (current === undefined) return err("no-such-binding");
  if (!groups.value) return err("no-such-group");
  if (widens(visibilityOf(current), next)) return err("widening-refused");

  const auditEventId = ulid();
  const narrowed = await attempt(() =>
    tx.query(
      `UPDATE source_binding SET sensitivity = $3, audience = $4, audience_groups = $5
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, bindingId.data, next.sensitivity, next.audience, next.audienceGroups],
    ),
  );
  if (!narrowed.ok) return err(narrowed.error);
  // Bare, after the row: the door's rejection aborts the transaction the row landed in.
  await record(admin.value, tx, {
    id: auditEventId,
    act: SOURCE_ACTS.narrowed,
    subjectId: bindingId.data,
    detail: { bindingId: bindingId.data, sensitivity: next.sensitivity, audience: next.audience },
  });
  const cascaded = await attempt(async () => {
    const concepts = await recomputeVisibilitySourcedFrom(admin.value, tx, {
      bindingId: bindingId.data,
    });
    const compositions = await recomputeCompositionsIncluding(admin.value, tx, {
      iris: concepts,
    });
    return { concepts, compositions };
  });
  if (!cascaded.ok) return err(cascaded.error);
  return ok({ bindingId: bindingId.data, auditEventId, visibility: next, ...cascaded.value });
};
