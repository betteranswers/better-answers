import { z } from "zod";

import { FAMILIES } from "@better-answers/schema";

import { act, declareActs, type DetailOf, record, type Matched } from "../audit/index.ts";
import {
  admit,
  attempt,
  declareAct,
  err,
  ok,
  type PrincipalRefusal,
  type RefusalOf,
  type Result,
  type UserPrincipal,
  ulid,
} from "../kernel/index.ts";
import {
  type PostgresDoor,
  type Tx,
  withMembership,
  withMembershipUnheld,
} from "../store/postgres/index.ts";
import type { AuditEventActor } from "../workspaces/index.ts";
import {
  auditSearch,
  eventsAsked,
  eventsNamed,
  type AuditEventSubject,
  type ReadAuditEvent,
} from "./audit-log.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const EXPORT_ACTS = declareActs("platform", {
  exported: act("platform.audit_log.exported", {
    matched: "matched",
    family: "family?",
    eventCount: "count",
    capped: "flag",
  }),
});

/** About 3 to 5 MB of text, which the browser saves as one file. */
const EXPORT_CAP = 10_000;

export const exportAuditLogInput = z.object({
  family: z.enum(FAMILIES).optional(),
  search: auditSearch.optional(),
});

export type ExportAuditLogInput = z.output<typeof exportAuditLogInput>;

const exportAuditLogAct = declareAct({
  admits: { role: "Admin", purposes: [] },
  input: exportAuditLogInput,
  refuses: ["role-forbids"],
  effect: "write",
});

export type ExportAuditLogRefusal =
  | MemberRefusal<RefusalOf<typeof exportAuditLogAct>>
  | PrincipalRefusal
  | Error;

export type AuditExport = {
  readonly csv: string;
  readonly count: number;
  /** Whether more events matched than the file holds. */
  readonly capped: boolean;
};

/** A spreadsheet runs a cell starting so as a formula; spaces before the sign do not stop it. */
const FORMULA_START = /^ *[=+\-@\t\r]/;

const cellOf = (value: string): string => {
  const inert = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${inert.replaceAll('"', '""')}"`;
};

const lineOf = (cells: readonly string[]): string => cells.map(cellOf).join(",");

const ACTOR_WORDS = {
  platform: "the platform",
  "former-member": "a former member",
} as const satisfies Readonly<Record<Exclude<AuditEventActor["kind"], "person">, string>>;

const actorWords = (by: AuditEventActor): string =>
  by.kind === "person" ? by.displayName : ACTOR_WORDS[by.kind];

const GONE_WORDS = {
  "former-member": "a former member",
  "deleted-group": "a deleted group",
  "erased-invitation": "an erased invitation",
} as const;

const subjectWords = (subject: AuditEventSubject): string => {
  if ("displayName" in subject) return subject.displayName;
  if ("name" in subject) return subject.name;
  if ("address" in subject) return subject.address;
  return GONE_WORDS[subject.kind];
};

const detailWords = (detail: ReadAuditEvent["detail"]): string =>
  Object.entries(detail)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
    )
    .join("; ");

const HEADER = ["Time", "Family", "Act", "Actor", "Subject", "Detail"];

const cellsOf = (event: ReadAuditEvent): readonly string[] => [
  event.at,
  event.family,
  event.act,
  actorWords(event.by),
  event.subject === null ? `${event.subjectKind} ${event.subjectId}` : subjectWords(event.subject),
  detailWords(event.detail),
];

const STOPPED = `The export stopped at ${EXPORT_CAP.toLocaleString("en-GB")} events. Narrow the search or the family for the rest.`;

const csvOf = (events: readonly ReadAuditEvent[], capped: boolean): string =>
  [HEADER, ...events.map(cellsOf), ...(capped ? [[STOPPED]] : [])]
    .map((cells) => `${lineOf(cells)}\r\n`)
    .join("");

/** Built a field at a time, as the family is stored only when the export was narrowed to one. */
type ExportedDetail = {
  -readonly [Key in keyof DetailOf<typeof EXPORT_ACTS.exported.detail>]: DetailOf<
    typeof EXPORT_ACTS.exported.detail
  >[Key];
};

type Read = {
  readonly events: readonly ReadAuditEvent[];
  readonly capped: boolean;
  readonly matched: readonly Matched[];
};

const readForExport = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ExportAuditLogInput,
): Promise<Read> => {
  const { page, found } = await eventsAsked(principal, tx, { ...input, limit: EXPORT_CAP });
  return {
    events: await eventsNamed(principal, tx, page.rows),
    capped: page.nextCursor !== null,
    matched: [
      ...(found?.people ?? []).map((id) => ({ kind: "person" as const, id })),
      ...(found?.groups ?? []).map((id) => ({ kind: "group" as const, id })),
    ],
  };
};

const recordExport = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ExportAuditLogInput,
  read: Read,
): Promise<void> => {
  const detail: ExportedDetail = {
    matched: read.matched,
    eventCount: read.events.length,
    capped: read.capped,
  };
  if (input.family !== undefined) detail.family = input.family;
  await record(principal, tx, {
    id: ulid(),
    act: EXPORT_ACTS.exported,
    subjectId: principal.workspaceId,
    detail,
  });
};

/**
 * Reads holding no row, so no other Admin's act waits on the export, then records it in a short
 * transaction, answering once that committed.
 */
export const exportAuditLog = async (
  principal: UserPrincipal,
  door: PostgresDoor,
  input: ExportAuditLogInput,
): Promise<Result<AuditExport, ExportAuditLogRefusal>> => {
  const admitted = admit(exportAuditLogAct, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const read = await attempt(() =>
    withMembershipUnheld(admitted.value, door, (member, tx) => readForExport(member, tx, input)),
  );
  if (!read.ok) return err(read.error);
  if (!read.value.ok) return err(read.value.error);
  const exported = read.value.value;

  const recorded = await attempt(() =>
    withMembership(admitted.value, door, (member, tx) => recordExport(member, tx, input, exported)),
  );
  if (!recorded.ok) return err(recorded.error);
  if (!recorded.value.ok) return err(recorded.value.error);
  const { events, capped } = exported;
  return ok({ csv: csvOf(events, capped), count: events.length, capped });
};
