import { ACT_PATTERN, boundarySchemas, ROLES, ULID } from "@better-answers/schema";
import type { z } from "zod";

import { actorIdOf } from "../kernel/index.ts";
import type { ActorId, AuditEventId, PlatformPrincipal, Principal, Role } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/**
 * The one append-only *ledger* (`CONTEXT.md`): the typed act vocabulary and the two doors
 * every slice writes it through (ADR 0014 rule 4; ADR 0035; ADR 0038).
 *
 * ADR 0029 rule 3 — imports `kernel` and `store`; never a slice, never `llm`. Two doors
 * and no third, rather than one write per slice, is what keeps the vocabulary typed and
 * the ledger one source of truth:
 *
 * - `record` derives the actor from the caller's Principal — a person by their person id,
 *   the platform by its own actor id — and is the door every act uses.
 * - `recordFor` takes the platform principal **and an explicit actor**, for the one act a
 *   person performs while holding no membership and so no Principal: the *access request*
 *   (T-061). Typed so a user principal cannot reach it.
 *
 * **Both run inside the caller's transaction and reject on any failure.** That is the
 * one place a `core` function is designed to reject rather than return a `Result`
 * (`kernel/result.ts`, rule 5), and it is the point of the ledger: an act and its event
 * land or fail together, so a door that answered a value the caller might not read would
 * let an act commit without its row. The rejection aborts the transaction the door was
 * called in, and the enclosing act's `attempt` is where it becomes a value at that act's
 * own seam. The refusals here are all programming errors — an act nobody declared, a
 * detail carrying a field the act does not name, an id that is not the minter's — never
 * a refusal a caller could act on.
 *
 * **What the row carries** is the boundary's business (`packages/schema`): the id the
 * caller minted, the workspace the transaction is scoped to, the act, the actor, the
 * subject's id, the detail, an optional batch id; the database derives the family and
 * the subject's kind from the act and refuses an act outside the four families.
 */

type AuditEventRow = z.infer<typeof boundarySchemas.auditEvent.select>;

/**
 * The four families — people · knowledge · sources · platform — the one closed list in
 * the vocabulary, read off the boundary that narrows to it (ADR 0028: the boundary is the
 * source of application-level types).
 */
export type Family = AuditEventRow["family"];

/**
 * An act's name, `family.subject.verb`, over one family or any: `ActName<"people">` is
 * every act whose first word is *people*. The subject is the record acted on and the
 * verb what happened — `people.member.role_changed`, `knowledge.suggestion.accepted`,
 * `sources.binding.published`, `platform.reconciler.replayed`.
 */
export type ActName<F extends Family = Family> = Extract<AuditEventRow["act"], `${F}.${string}`>;

/**
 * What a detail field may be, named by kind rather than by type, so that a declaration
 * reads as the rule it is held to: an **id** is the minter's shape and never an email; a
 * **role** is one of the three words; a **flag** is an act's confirmation; a **count** is
 * how many. A kind for a person's name or contact does not exist, which is how the
 * ledger stays a table an erasure never rewrites. Each kind's check runs on every write.
 */
const DETAIL_KINDS = {
  id: (value: DetailValue) => typeof value === "string" && ULID.test(value),
  role: (value: DetailValue) => typeof value === "string" && ROLES.some((role) => role === value),
  flag: (value: DetailValue) => typeof value === "boolean",
  count: (value: DetailValue) => typeof value === "number" && Number.isInteger(value) && value >= 0,
} as const;

type DetailValue = string | number | boolean;
export type DetailKind = keyof typeof DETAIL_KINDS;
/** The fields a declared act's detail carries, each named with its kind. */
export type DetailShape = Readonly<Record<string, DetailKind>>;

type DetailValueOf<K extends DetailKind> = K extends "id"
  ? string
  : K extends "role"
    ? Role
    : K extends "flag"
      ? boolean
      : number;

/** The detail a row of one declared act carries: the shape's fields, each at its kind's type. */
export type DetailOf<Shape extends DetailShape> = {
  readonly [Field in keyof Shape]: DetailValueOf<Shape[Field]>;
};

/**
 * A declared act: its name and the shape of the detail every row of it carries. Made by
 * `act` and registered by `declareActs`; the doors accept one of these and never a string,
 * so an act that was not declared cannot be written.
 */
export type Act<Name extends ActName = ActName, Shape extends DetailShape = DetailShape> = {
  readonly name: Name;
  readonly detail: Shape;
};

export const act = <Name extends ActName, const Shape extends DetailShape>(
  name: Name,
  detail: Shape,
): Act<Name, Shape> => ({ name, detail });

/**
 * A record that is never a ledger row, so an act may not name it as its subject: runs,
 * the answer audit (ADR 0017), signals, alerts and spend (ADR 0025), backup runs and health
 * checks, the inbox — each is its own record family with its own table. An event with no
 * workspace — a sign-in, a token issued or refused — is a log line until an identity-set
 * ledger exists (T-028), and is kept out by the ledger being a tenant table rather than by
 * this list.
 */
const NEVER_A_SUBJECT: ReadonlySet<string> = new Set([
  "run",
  "answer_audit",
  "signal",
  "alert",
  "spend",
  "llm_call",
  "backup_run",
  "health_check",
  "inbox",
]);

const ACT = new RegExp(ACT_PATTERN);

/** One slice's declaration: the family it declared under and the acts it declared. */
export type Declaration = {
  readonly family: Family;
  readonly acts: readonly ActName[];
};

const declared: Declaration[] = [];
const declaredNames = new Set<string>();

/**
 * Declare a slice's acts against one family. Runs when the slice's module loads, so a
 * declaration that breaks a rule fails the first test that imports the slice rather than
 * the first act that reaches production: the name must be `family.subject.verb` under the
 * family it is declared under, may not name a record that is never a ledger row, and may
 * be declared once in the whole tree — an act belongs to one slice.
 *
 * The declaration is also registered, so one test can walk every slice's acts and hold
 * the family prefix both ways (`packages/core/test/audit.test.ts`).
 */
export const declareActs = <F extends Family, const Acts extends Record<string, Act<ActName<F>>>>(
  family: F,
  acts: Acts,
): Acts => {
  const names: ActName[] = [];
  for (const { name } of Object.values(acts)) {
    const [prefix, subject] = name.split(".");
    if (!ACT.test(name) || prefix !== family) {
      throw new Error(`audit: ${name} is not a ${family} act of the form family.subject.verb`);
    }
    if (subject !== undefined && NEVER_A_SUBJECT.has(subject)) {
      throw new Error(`audit: ${name} names a record that is never a ledger row`);
    }
    if (declaredNames.has(name)) throw new Error(`audit: ${name} is declared twice`);
    declaredNames.add(name);
    names.push(name);
  }
  declared.push({ family, acts: names });
  return acts;
};

/** Every declaration made so far, in the order the slices loaded. */
export const declarations = (): readonly Declaration[] => [...declared];

/**
 * What a caller hands a door: the id it minted (`kernel`'s `ulid`), the act it declared,
 * the id of the record acted on, the detail the act names, and a batch id when this row is
 * one of N a bulk act writes (ADR 0014 rule 4).
 */
export type AuditEvent<A extends Act> = {
  readonly id: string;
  readonly act: A;
  readonly subjectId: string;
  readonly detail: DetailOf<A["detail"]>;
  readonly batchId?: string;
};

/** What a door answers: the row's id, and the actor it was booked to. */
export type Recorded = {
  readonly id: AuditEventId;
  readonly actorId: ActorId;
};

/**
 * The row's own columns, parsed through the boundary less the workspace: the transaction's
 * scope supplies that, below, because the platform principal carries no workspace id.
 */
const eventInsert = boundarySchemas.auditEvent.insert.omit({ workspaceId: true });

const detailRefusal = (shape: DetailShape, detail: Readonly<Record<string, DetailValue>>) => {
  for (const field of Object.keys(detail)) {
    if (!Object.hasOwn(shape, field)) return `detail names a field the act does not: ${field}`;
  }
  for (const [field, kind] of Object.entries(shape)) {
    const value = detail[field];
    if (value === undefined) return `detail is missing the field ${field}`;
    if (!DETAIL_KINDS[kind](value)) return `detail's ${field} is not a ${kind}`;
  }
  return undefined;
};

const write = async <A extends Act>(
  tx: Tx,
  workspaceId: string | null,
  actor: ActorId,
  event: AuditEvent<A>,
): Promise<Recorded> => {
  if (!declaredNames.has(event.act.name)) {
    throw new Error(`audit: ${event.act.name} was never declared`);
  }
  const row = eventInsert.safeParse({
    id: event.id,
    act: event.act.name,
    actor,
    subjectId: event.subjectId,
    detail: event.detail,
    batchId: event.batchId ?? null,
  });
  if (!row.success)
    throw new Error(`audit: ${event.act.name} refused at the boundary`, { cause: row.error });
  const refusal = detailRefusal(event.act.detail, event.detail);
  if (refusal !== undefined) throw new Error(`audit: ${event.act.name} ${refusal}`);

  // The workspace is the one the transaction is scoped to: a user principal's is its own,
  // written so a disagreement with the scope is refused by the policy rather than landed;
  // the platform principal carries none, so the scope alone says where the row lands — and
  // an unscoped transaction lands nothing, because the column refuses NULL.
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO audit_event (id, workspace_id, act, actor, subject_id, detail, batch_id)
     VALUES ($1, COALESCE($2::text, (select current_workspace_id())), $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      row.data.id,
      workspaceId,
      row.data.act,
      row.data.actor,
      row.data.subjectId,
      row.data.detail,
      row.data.batchId,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error(`audit: ${event.act.name} landed no row`);
  return { id: boundarySchemas.auditEvent.select.shape.id.parse(id), actorId: actor };
};

/**
 * The first door: write one event as the caller, the actor derived from the Principal by
 * the kernel's one function. Inside the caller's own transaction, so the row lands with
 * the act's rows or not at all.
 */
export const record = <A extends Act>(
  principal: Principal,
  tx: Tx,
  event: AuditEvent<A>,
): Promise<Recorded> =>
  write(tx, principal.kind === "user" ? principal.workspaceId : null, actorIdOf(principal), event);

/**
 * The second door: write one event as the platform, booked to an actor the platform
 * names — the person who asked to join a workspace they hold no membership in (T-061),
 * whose act is theirs and not the platform's. The first parameter is the platform
 * principal and only that: the type refuses a user principal at compile time, and the
 * check below refuses one at runtime for a caller that arrived without the compiler, so
 * no person's session can ever book a row to somebody else.
 */
export const recordFor = <A extends Act>(
  platform: PlatformPrincipal,
  tx: Tx,
  event: AuditEvent<A> & { readonly actor: ActorId },
): Promise<Recorded> => {
  if (platform.kind !== "platform") {
    throw new Error("audit: only the platform principal may name another actor");
  }
  return write(tx, null, event.actor, event);
};
