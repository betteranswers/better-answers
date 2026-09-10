import { sql } from "drizzle-orm";
import { check, jsonb, primaryKey, text } from "drizzle-orm/pg-core";

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
