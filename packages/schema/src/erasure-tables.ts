import { sql } from "drizzle-orm";
import { check, foreignKey, jsonb, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";
import { user } from "./identity-tables.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

/**
 * The **erasure** slice's records (`CONTEXT.md`; ADR 0020): a person's access or erasure
 * request, what the routine did in every store, and what stays out of the derived stores
 * when a document is reprocessed. Ordinary tenant tables (`withRLS()`, ADR 0032), and the
 * one family in this package the worker holds no privilege on at all — every substrate here
 * revokes what migration 0000's default privileges would have granted and grants nothing
 * back, because a tier whose job is to run a detector over a document has no road to the
 * names and addresses a subject gave.
 */

/** The two kinds of *subject request* the platform answers, the one closed list. */
export const SUBJECT_REQUEST_KINDS = ["access", "erasure"] as const;

/**
 * The three kinds of identifier a subject gives, which is the shape of the **identifier
 * set**: the finders read one arm each — the identity set and the history match the emails
 * and the person id where one exists, the documents finder matches the whole set over the
 * normalised text (the S0 spec, the routine's step 2). All three are always present, so no
 * finder needs an existence check before it walks its own, and a fourth kind is a word added
 * here rather than a key that arrives unannounced in somebody's `jsonb`.
 */
export const SUBJECT_IDENTIFIER_KINDS = ["emails", "names", "other"] as const;

/**
 * How long one identifier may be — an email at its RFC maximum, and a name or a reference
 * well inside it — and how many of one kind a set may hold.
 *
 * Bounded because this is the one column of the slice a person's own words fill: an Admin
 * types what the subject gave, and the set is then copied onto the *replay copy*, into every
 * *suppression* and into every finder's argument. An unbounded one would be storage whose
 * size is chosen by whoever asks, which is the reasoning `ACCESS_REQUEST_REASON_MAX` and
 * `SUGGESTION_BODY_MAX` are written from.
 */
export const SUBJECT_IDENTIFIER_MAX = 320;
export const SUBJECT_IDENTIFIERS_MAX = 50;

/**
 * A **subject request** (`CONTEXT.md`; the S0 spec, *The record families*): a person's
 * access or erasure request as an Admin recorded it on their behalf, with who it is about
 * and the clock it runs on.
 *
 * **The subject is an identifier set, not only a person id** (the architecture pass of
 * 10/09/2026, candidate 2). `person_id` is set for a member and absent for a person the
 * company's files name who never signed in — the bid writer's client contact, the name in a
 * case study — and `identifiers` carries what the subject gave either way. A table that held
 * the person id alone could only answer the people who happen to hold a login, which is not
 * who the UK GDPR gives the right to. The set is restricted personal data of the same class
 * as a *suppression*: an Admin reads it, and no other role and no other tier does.
 *
 * **The clock**, in the order the ICO's guidance sets it: `received_at` is when the request
 * arrived, `clock_started_at` is that same instant or the later one at which identity was
 * confirmed when the Admin had to ask (the pause), `due_at` is one month from the start, and
 * `extended_to` carries Article 12's further two months where they were taken and notified.
 * The arithmetic is the slice's; what is written down here is the order, so a row can never
 * describe a month that ran backwards.
 *
 * The answer is unbounded text where the identifier set is bounded, and the difference is
 * who writes it: the answer is the platform's own — for an access request, the map read as
 * locations and categories, never a passage — and a document is what it is meant to be.
 */
export const subjectRequest = withRLS(
  "subject_request",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    /**
     * The person the request is about where they hold a login — the one person id (ADR
     * 0035), never an email. No cascade, as `access_request` names none: the platform does
     * not delete a `user` row, an erasure pseudonymises it and keeps its id, so a cascade
     * would be a promise about a path that does not exist.
     */
    personId: text("person_id").references(() => user.id),
    /** The identifier set: `emails`, `names` and `other`, each a list, bounded at the boundary. */
    identifiers: jsonb("identifiers").notNull(),
    receivedAt: stamp("received_at").notNull(),
    /** Receipt, or the instant identity was confirmed when the Admin had to ask. */
    clockStartedAt: stamp("clock_started_at").notNull(),
    dueAt: stamp("due_at").notNull(),
    /** Article 12's extension, where it was taken and notified inside the first month. */
    extendedTo: stamp("extended_to"),
    /** The two columns an answer writes, both null until one is given. */
    answeredAt: stamp("answered_at"),
    answer: text("answer"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    check("subject_request_kind_check", sql.raw(`kind IN (${listed(SUBJECT_REQUEST_KINDS)})`)),
    // The set's three kinds, held here as well as at the boundary, because this column is
    // what every finder walks and a `jsonb` the database does not hold to a shape is a
    // finder that discovers its argument is a string at the moment it runs. `jsonb NOT NULL`
    // refuses SQL NULL and not the JSON value, so the object test is the clause that refuses
    // a set written as `null`.
    //
    // Null-safe on purpose: `->` on a key that is not there is SQL NULL, `jsonb_typeof(NULL)`
    // is NULL, and a CHECK whose value is NULL **passes**. Written with `=`, a set missing
    // two of its three kinds would have been taken by the database and found by a finder.
    check(
      "subject_request_identifiers_check",
      sql.raw(
        [
          `jsonb_typeof(identifiers) = 'object'`,
          ...SUBJECT_IDENTIFIER_KINDS.map(
            (kind) => `jsonb_typeof(identifiers -> '${kind}') IS NOT DISTINCT FROM 'array'`,
          ),
        ].join("\n         AND "),
      ),
    ),
    // A request names somebody: a person id, or at least one identifier. A row with neither
    // is a request no finder could run, no suppression could be written from and no answer
    // could reach — and the erasure map it produced would be empty for a reason nobody could
    // see. The sentence the identifier set exists for, made the database's.
    //
    // The lengths need no null guard of their own: the check above has already refused any
    // row whose three kinds are not lists, and a row is stored only when no check on it is
    // false, so by the time this one's arithmetic matters the three lists are there.
    check(
      "subject_request_subject_check",
      sql.raw(
        `person_id IS NOT NULL OR ${SUBJECT_IDENTIFIER_KINDS.map(
          (kind) => `jsonb_array_length(identifiers -> '${kind}')`,
        ).join(" + ")} > 0`,
      ),
    ),
    // The month, in order: it starts at receipt or later, it runs forward, and an extension
    // moves the date out. A row that said otherwise would be a deadline the platform had
    // quietly brought forward on itself, which is the one direction a clock must not move.
    check(
      "subject_request_clock_check",
      sql.raw(
        `clock_started_at >= received_at
         AND due_at > clock_started_at
         AND (extended_to IS NULL OR extended_to > due_at)`,
      ),
    ),
    // An answer is an act, and an act has an instant: words with no instant would be an
    // answer the screen cannot date, and an instant with no words a request closed on
    // nothing.
    check("subject_request_answer_check", sql.raw("(answered_at IS NULL) = (answer IS NULL)")),
  ],
);

/**
 * An **erasure request** (`CONTEXT.md`; ADR 0020, amended 2026-09-05): what the routine did
 * in every store for one subject request of kind *erasure* — what was done, when, and when
 * the backups are beyond use.
 *
 * **Keyed to its subject request**, by the pair, and to exactly one: the replay re-runs the
 * routine over the same request and must find the same *erasure pseudonym* on the same row,
 * which is the whole of what makes the routine idempotent. Two rows would be two pseudonyms
 * for one person and a history rewritten twice to two opaque ids. The person id is not
 * copied here — it sits on the subject request the key names, so the pseudonym stands beside
 * it without a second column to keep in step.
 *
 * **The pseudonym** is the minter's own shape and never the person id (ADR 0035's rejected
 * fourth option): `human:<email>` becomes `human:<pseudonym>` across this workspace's files,
 * history and author lines, and because the id is per workspace two workspaces' rewritten
 * histories cannot be joined on one person. Unique within the workspace, so no two erasures
 * here ever rewrite to the same id.
 *
 * **The anchor and the four dates.** `anchored_at` is the instant the report's beyond-use
 * paragraph counts from — today the instant the routine took `pg_advisory_lock(41)`, since
 * the last dump precedes it and dates from it are therefore upper bounds on every copy's
 * expiry; when O1 lands `backup_run` it becomes the last dump's stamp, and the report says in
 * its own words which it used. The four are the four backup tiers the operations document
 * names — 48 hours, 30 days, 8 weeks, six months — and they are columns rather than
 * arithmetic over the anchor because the report has already promised them to a person.
 */
export const erasureRequest = withRLS(
  "erasure_request",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    subjectRequestId: text("subject_request_id").notNull(),
    /** The opaque id this workspace's `human:<email>` became. Never the person id. */
    pseudonym: text("pseudonym").notNull(),
    /** When `pg_advisory_lock(41)` was taken, so no dump was taken while the routine ran. */
    lockedAt: stamp("locked_at").notNull(),
    /**
     * What each store family did and how it went — one flat object per family. The family
     * names are the erasure map's, which is a typed union in the slice: a second copy of the
     * list here would be a second place to change when a store is added.
     */
    actions: jsonb("actions").notNull().default({}),
    anchoredAt: stamp("anchored_at").notNull(),
    beyondUseHourlyAt: stamp("beyond_use_hourly_at").notNull(),
    beyondUseDailyAt: stamp("beyond_use_daily_at").notNull(),
    beyondUseWeeklyAt: stamp("beyond_use_weekly_at").notNull(),
    beyondUseMonthlyAt: stamp("beyond_use_monthly_at").notNull(),
    /** The two columns the routine's last step writes, both null while it runs. */
    completedAt: stamp("completed_at"),
    report: text("report"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    // Keyed by the pair, as every cross-table key in this package is: a foreign-key check
    // runs outside row-level security, so a key on the request id alone would confirm that
    // some other tenant holds a given subject request.
    foreignKey({
      columns: [table.workspaceId, table.subjectRequestId],
      foreignColumns: [subjectRequest.workspaceId, subjectRequest.id],
      name: "erasure_request_subject_request_fk",
    }).onDelete("cascade"),
    // One routine per request, which is what the replay relies on.
    uniqueIndex("erasure_request_subject_request_uidx").on(
      table.workspaceId,
      table.subjectRequestId,
    ),
    // One pseudonym per workspace: the id a history was rewritten to, never reused.
    uniqueIndex("erasure_request_pseudonym_uidx").on(table.workspaceId, table.pseudonym),
    // The record of what was done is an object per store family. A `null` or a string would
    // be a routine whose report could not be written from its own row.
    check("erasure_request_actions_check", sql.raw("jsonb_typeof(actions) = 'object'")),
    // The four dates run out from the anchor in order, because that is what the report
    // promises about each backup tier: the hourly copies go first and every copy is gone by
    // the sixth month. A date inside the tier before it would be a promise the object-store
    // lifecycle rule cannot keep, and the report is the document a regulator reads.
    check(
      "erasure_request_beyond_use_check",
      sql.raw(
        `beyond_use_hourly_at > anchored_at
         AND beyond_use_daily_at > beyond_use_hourly_at
         AND beyond_use_weekly_at > beyond_use_daily_at
         AND beyond_use_monthly_at > beyond_use_weekly_at`,
      ),
    ),
    // A completion is the stamp and the report together: a stamp alone is a routine that
    // finished without saying what it did, and a report alone one that never finished.
    check("erasure_request_completion_check", sql.raw("(completed_at IS NULL) = (report IS NULL)")),
  ],
);
