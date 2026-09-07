import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, primaryKey, text } from "drizzle-orm/pg-core";

import { ACTOR_ID_PATTERN, PLATFORM_ACTOR_PREFIX } from "./actor-id.ts";
import { listed, stamp } from "./column-helpers.ts";
import { CONCEPT_FRONTMATTER_MAX, conceptIdentity } from "./concept-tables.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

/**
 * The **inbox**'s two tables (ADRs 0005, 0011, 0012): the *suggestion* that waits for a
 * decision, and the *concept write request* that is its payload.
 *
 * Both are ordinary tenant tables (`withRLS()`, ADR 0032) and both are the concepts
 * slice's. **Neither is a knowledge layer**: a payload is platform state in no layer at
 * all (ADR 0012's 2026-09-01 amendment), which is why nothing reads one but the
 * acceptance path — a rule the migration makes the database's by taking `SELECT` on the
 * payload away from both runtime roles and serving it through one definer function.
 *
 * The split between the two tables is the ticket's own sentence: **a payload carries the
 * merge key, never a pre-resolved IRI**, and the suggestion carries a `target_iri` that is
 * NULL until an acceptance resolves it. So identity is resolved at acceptance and nowhere
 * else, and a concept whose identity moved between proposal and decision refuses the
 * acceptance rather than landing on the wrong concept (`CONTEXT.md`, *merge key*).
 */

/**
 * The kinds a suggestion comes in (`CONTEXT.md`, *suggestion*): a person's *edit* — a
 * concept's text, a Brief, a missing fact — a run's *candidate* concept, an answer offered
 * as an `Answer` (*promotion*, ADR 0017's gate), and the platform's own citation *repair*,
 * whose acceptance re-hashes the checks it moved (ADR 0019).
 *
 * A wide text column narrowed at the boundary to this closed set, exactly as *sensitivity*
 * is. Only *edit*, *candidate* and *repair* have a writer today; *promotion* is declared
 * here so the gate that writes it needs no migration, as `VERIFICATION_ORIGINS`' two
 * routine origins are.
 */
export const SUGGESTION_KINDS = ["edit", "candidate", "promotion", "repair"] as const;

/**
 * A person's own suggestion over a concept that already exists — the one kind ADR 0012's
 * 2026-08-27 amendment gives its own rule: the proposer is the git author of the commit its
 * acceptance makes, because the change is theirs and the acceptance is only the decision.
 */
export const SUGGESTION_EDIT_KIND = "edit" satisfies (typeof SUGGESTION_KINDS)[number];

/**
 * The platform's citation repair (ADR 0019): the fix a *source moved on* request asks for,
 * proposed like anything else the platform prepares. Its acceptance is the **repair
 * commit**, and it re-points every standing check at the content it moved, so repairing a
 * locator never turns *Checked* into *Changed since checked*.
 */
export const SUGGESTION_REPAIR_KIND = "repair" satisfies (typeof SUGGESTION_KINDS)[number];

/**
 * What has become of a suggestion. It **waits** until somebody decides it; it is
 * *accepted* by the governed write that commits it, *declined* with the reason a producer's
 * rejected work deserves to be a fact rather than a silence, or **returned** — refused and
 * handed back to whoever prepared it, because what it was written against moved (ADR 0012's
 * 2026-08-27 amendment: an acceptance over a body that moved "fails loudly and returns to
 * the proposer").
 */
export const SUGGESTION_STATUSES = ["waiting", "accepted", "declined", "returned"] as const;

/** What a suggestion is born at: waiting for the person who decides it. */
export const SUGGESTION_WAITING_STATUS = "waiting" satisfies (typeof SUGGESTION_STATUSES)[number];

/** What an acceptance leaves behind — the one status that carries a resolved target. */
export const SUGGESTION_ACCEPTED_STATUS = "accepted" satisfies (typeof SUGGESTION_STATUSES)[number];

/** A decision against: recorded with its reason, never a deletion. */
export const SUGGESTION_DECLINED_STATUS = "declined" satisfies (typeof SUGGESTION_STATUSES)[number];

/** Refused and handed back: the reason is what the proposer is shown. */
export const SUGGESTION_RETURNED_STATUS = "returned" satisfies (typeof SUGGESTION_STATUSES)[number];

/**
 * How long a decline's or a return's reason may be. The surface that writes one is open to
 * any member, so an unbounded column would be storage a caller chooses the size of — the
 * bound `access_request.reason` carries, for the same reason.
 */
export const SUGGESTION_REASON_MAX = 2000;

/**
 * How long a payload's body may be. A concept is a fact stated once and citable in one
 * sentence (`CONTEXT.md`), not a document, so a hundred thousand characters is generous by
 * a wide margin — and the bound exists because a producer writes this column: a compromised
 * one could otherwise fill a tenant's storage a suggestion at a time, and nothing decides
 * the size but the sender.
 */
export const SUGGESTION_BODY_MAX = 100_000;

/**
 * How many changes one submission may carry. A run yields one suggestion set (ADR 0012) and
 * an Admin reviews it, so a set is bounded by what a person could decide; the number is here
 * rather than in the function that enforces it, so both tiers read one fact.
 */
export const SUGGESTION_SET_MAX = 500;

/**
 * A **suggestion** (`CONTEXT.md`): a change prepared by the platform or by a person who may
 * not commit it, waiting until the target's owner or an Admin accepts or declines it.
 *
 * `target_iri` is **nullable and written only by an acceptance**. A suggestion names its
 * target by the merge key its payload carries; the IRI that merge key resolves to is read
 * from `concept_identity` at the moment of the decision, so nothing here can be stale by
 * the time it is acted on. The composite key to `concept_identity` is what makes the
 * written value a concept of *this* workspace — and a composite key with a NULL column is
 * not checked at all, which is exactly the shape a waiting suggestion needs.
 *
 * The proposer and the decider are `ActorId` strings — one column, one shape, whether a
 * person, a process or an agent prepared it (ADR 0035).
 */
export const suggestion = withRLS(
  "suggestion",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    /** The set this suggestion arrived in: one run yields one set (ADR 0012). */
    setId: text("set_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default(SUGGESTION_WAITING_STATUS),
    /** Who prepared it — a person, a run's agent, or a process. */
    proposer: text("proposer").notNull(),
    /** The concept this acceptance landed on; NULL until one does (ADR 0012). */
    targetIri: text("target_iri"),
    /** Who decided it; NULL while it waits. */
    decider: text("decider"),
    /** Why it was declined or returned; NULL on a suggestion nobody refused. */
    reason: text("reason"),
    proposedAt: stamp("proposed_at").notNull().defaultNow(),
    decidedAt: stamp("decided_at"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.targetIri],
      foreignColumns: [conceptIdentity.workspaceId, conceptIdentity.iri],
      name: "suggestion_target_fk",
    }),
    // The queue's read: one set's suggestions, in the order they were proposed.
    index("suggestion_workspace_id_set_id_idx").on(table.workspaceId, table.setId),
    check("suggestion_kind_check", sql.raw(`kind IN (${listed(SUGGESTION_KINDS)})`)),
    check("suggestion_status_check", sql.raw(`status IN (${listed(SUGGESTION_STATUSES)})`)),
    // The two actor columns hold the one shape an actor id has, at the row — because the
    // row is written by a definer function both tiers call, which is past every boundary
    // the app parses through. A producer that could write any string here could name a
    // person it had no business naming.
    check("suggestion_proposer_check", sql.raw(`proposer ~ '^${ACTOR_ID_PATTERN}$'`)),
    check(
      "suggestion_decider_check",
      sql.raw(`decider IS NULL OR decider ~ '^${ACTOR_ID_PATTERN}$'`),
    ),
    // **A repair is the platform's own act.** ADR 0019's citation repair is a routine the
    // platform runs, and accepting one re-points every standing check at the content it
    // wrote — so a member who could raise one could make *Checked by Ada* vouch for content
    // Ada never checked, with an Admin's click as the only thing between. Held at the row,
    // where no producer and no transport can argue with it.
    check(
      "suggestion_repair_proposer_check",
      sql.raw(`kind <> '${SUGGESTION_REPAIR_KIND}' OR proposer LIKE '${PLATFORM_ACTOR_PREFIX}%'`),
    ),
    check(
      "suggestion_reason_length_check",
      sql.raw(`reason IS NULL OR char_length(reason) BETWEEN 1 AND ${SUGGESTION_REASON_MAX}`),
    ),
    // The whole of what a decision is, made the database's sentence rather than the
    // slice's memory: a waiting suggestion carries none of a decision's four columns; a
    // decided one names who and when; only an acceptance carries a target, because the
    // target is what the acceptance resolved; and only a refusal carries a reason, because
    // a decline or a return that said nothing would be the silence the ADR refuses.
    check(
      "suggestion_decision_check",
      sql.raw(
        `(status = '${SUGGESTION_WAITING_STATUS}') = (decided_at IS NULL)
         AND (decided_at IS NULL) = (decider IS NULL)
         AND (target_iri IS NOT NULL) = (status = '${SUGGESTION_ACCEPTED_STATUS}')
         AND (reason IS NOT NULL) = (status IN ('${SUGGESTION_DECLINED_STATUS}', '${SUGGESTION_RETURNED_STATUS}'))`,
      ),
    ),
  ],
);

/**
 * A **concept write request** (ADR 0005, refined by ADR 0012): a suggestion's payload —
 * the file it would write, and the **merge key** it means it for. Committed on acceptance,
 * never on validation.
 *
 * It carries no IRI. Identity is the acceptance's to resolve, from the merge key against
 * `concept_identity`, inside the act that commits — which is what makes a moved identity a
 * refusal rather than a write onto the wrong concept.
 *
 * `base_content_hash` is what the payload was written against: NULL when it proposes a
 * concept that does not exist yet, and otherwise the hash the acceptance holds the target
 * to, so an acceptance over a body that moved fails loudly (ADR 0012's 2026-08-27
 * amendment). It is the payload's precondition exactly as the ref's sha is a person's edit's.
 *
 * The key to `suggestion` is an ordinary immediate one, and the submit function is written
 * around it: two statements rather than one, so the payload's key is checked against a
 * suggestion row that already exists. Deferring it would buy nothing here — there is no
 * order these two have to be written in that the function cannot simply take.
 */
export const conceptWriteRequest = withRLS(
  "concept_write_request",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    suggestionId: text("suggestion_id").notNull(),
    /** What this payload means, before any IRI is known (`CONTEXT.md`, *merge key*). */
    mergeKey: text("merge_key").notNull(),
    /* jscpd:ignore-start */
    // The file's own five columns, declared here as `concept_index` declares them — a
    // deliberate copy, because a payload *is* the file the acceptance would commit, and
    // the day these two part company is the day an acceptance could not write what it
    // was shown. Folding them into a shared column set would hide that: the index row's
    // are derived from a commit and this one's are what a producer proposed, and the two
    // are equal by design rather than by construction.
    path: text("path").notNull(),
    /** The OKF `type` as the payload's producer spelled it; the write path folds it. */
    conceptKind: text("concept_kind").notNull(),
    title: text("title").notNull(),
    frontmatter: jsonb("frontmatter").notNull(),
    body: text("body").notNull(),
    /* jscpd:ignore-end */
    /** The content this was written against; NULL when it proposes a new concept. */
    baseContentHash: text("base_content_hash"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.suggestionId] }),
    foreignKey({
      columns: [table.workspaceId, table.suggestionId],
      foreignColumns: [suggestion.workspaceId, suggestion.id],
      name: "concept_write_request_suggestion_fk",
    }).onDelete("cascade"),
    check(
      "concept_write_request_body_length_check",
      sql.raw(`char_length(body) <= ${SUGGESTION_BODY_MAX}`),
    ),
    // The body's bound, over the other column a producer fills. Frontmatter is open by
    // design (ADR 0019), so its shape bounds nothing, and this row is written by a definer
    // function both tiers call — past every boundary the app parses through, which is why
    // the bound is stated here as well as at the boundary.
    check(
      "concept_write_request_frontmatter_length_check",
      sql.raw(`char_length(frontmatter::text) <= ${CONCEPT_FRONTMATTER_MAX}`),
    ),
  ],
);
