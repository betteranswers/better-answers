import { sql } from "drizzle-orm";
import { check, index, jsonb, text, timestamp } from "drizzle-orm/pg-core";

import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

/**
 * The one append-only *ledger* (`CONTEXT.md`; ADR 0014 rule 4; ADR 0038): one row per act
 * and target, written by the audit slice inside the same transaction as the rows the act
 * describes, and never updated or deleted — the migration that creates it revokes both
 * from the app's role, and the worker's role has nothing on it at all.
 *
 * **An ordinary tenant table** (ADR 0038): `withRLS()` like every other, so a ledger row
 * always belongs to a workspace and an act with no workspace — a sign-in, a token issued or
 * refused — is a log line until T-028's identity-set ledger exists. Not partitioned: ADR
 * 0014's month partitioning is superseded in words there, because a partitioned
 * policy-bearing table changes the catalogue assertion the RLS suite proves and a
 * retention delete needs a role that is not the app's; a row-count trigger is what reopens
 * the question.
 *
 * **The act is `family.subject.verb`** over the four families below, and the database
 * derives two columns from it — `family` and `subject_kind` — as generated columns, so a
 * screen filters by family or by record kind with no second value that could disagree with
 * the act. The CHECKs hold the shape and the closed family set at the row, as
 * `member_role_check` holds the three roles.
 */

/**
 * The four families every act belongs to (ADR 0035; `CONTEXT.md`, *audit event*), the one
 * closed list in the vocabulary: each slice declares its own acts against it and no central
 * list of acts exists. The audit slice's `Family` type is inferred from the boundary that
 * narrows to these.
 */
export const FAMILIES = ["people", "knowledge", "sources", "platform"] as const;

/**
 * The written form of an act — `family.subject.verb`, the family one of the four, the
 * subject and verb lower-case words with underscores (`people.member.role_changed`). The
 * database holds it as a CHECK and the boundary as a refinement; the audit slice refuses a
 * declaration that does not match it before any row exists.
 */
export const ACT_PATTERN = `^(${FAMILIES.join("|")})\\.[a-z][a-z_]*\\.[a-z][a-z_]*$`;

const familyList = FAMILIES.map((family) => `'${family}'`).join(", ");

const stamp = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const auditEvent = withRLS(
  "audit_event",
  {
    // Caller-minted, no default (ADR 0014 rule 4; ADR 0038): the governed write mints its
    // id before its git commit so the commit can carry it, and a row and a commit join on
    // one id. A ULID from the platform's minter, held to that shape at the boundary.
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id),
    act: text("act").notNull(),
    // Derived by the database from the act, never written: the first segment.
    family: text("family")
      .notNull()
      .generatedAlwaysAs(sql`split_part(act, '.', 1)`),
    // The actor id (`CONTEXT.md`): `human:<person id>`, `process:better-answers-<purpose>`
    // or an agent's id — never an email, a display name or a session, which is why the
    // ledger is never rewritten on erasure (ADR 0035).
    actor: text("actor").notNull(),
    // The record acted on: its kind is the act's second segment, derived; its id is written.
    subjectKind: text("subject_kind")
      .notNull()
      .generatedAlwaysAs(sql`split_part(act, '.', 2)`),
    subjectId: text("subject_id").notNull(),
    at: stamp("at").notNull().defaultNow(),
    // Ids and role words, and an act's confirmations as typed fields; never an email, a name,
    // a prompt or a completion. Each declared act names the fields its detail carries.
    detail: jsonb("detail").notNull(),
    // ADR 0014 rule 4: a bulk act is N rows sharing one batch id, never one row hiding N.
    batchId: text("batch_id"),
  },
  "workspaceId",
  (table) => [
    index("audit_event_workspace_id_idx").on(table.workspaceId),
    // The ledger is queryable by target (ADR 0014): every event about one record, in order.
    index("audit_event_subject_idx").on(table.workspaceId, table.subjectKind, table.subjectId),
    check("audit_event_act_check", sql.raw(`act ~ '${ACT_PATTERN}'`)),
    check("audit_event_family_check", sql.raw(`family IN (${familyList})`)),
  ],
);
