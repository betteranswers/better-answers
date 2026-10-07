/** The audit logs as migration 0073 found them. */
export const AUDIT_LOGS = ["audit_event", "identity_audit_event"] as const;

/** The names migration 0073 renamed, put back so it can run again over rows written before it. */
export const NAMES_BEFORE_THE_ACTION: readonly string[] = AUDIT_LOGS.flatMap((log) => [
  `ALTER TABLE "${log}" RENAME COLUMN "action" TO "act"`,
  `ALTER TABLE "${log}" RENAME CONSTRAINT "${log}_action_check" TO "${log}_act_check"`,
  `ALTER TABLE "${log}" RENAME CONSTRAINT "${log}_action_not_null" TO "${log}_act_not_null"`,
]);

export const AN_AUDIT_EVENT_ROW_BEFORE_THE_ACTION = `INSERT INTO audit_event (id, workspace_id, act, actor, subject_id, detail)
       VALUES ($1, $2, $3, 'process:better-answers-test', $4, $5)`;

export const AN_IDENTITY_SET_AUDIT_EVENT_ROW_BEFORE_THE_ACTION = `INSERT INTO identity_audit_event (id, act, actor, subject_id, detail)
       VALUES ($1, $2, 'process:better-answers-test', $3, $4)`;
