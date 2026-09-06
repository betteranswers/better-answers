import { ACT, ROLES, ULID } from "@better-answers/schema";
import type { boundarySchemas } from "@better-answers/schema";
import type { z } from "zod";

import type { Role } from "../kernel/index.ts";

/**
 * The ledger's vocabulary: the four families, the shape of an act's name, the kinds a
 * detail field may have, and the declaration every slice makes before it may write
 * (ADR 0035; ADR 0038). The doors that write the rows are `index.ts`'s; this module has
 * no store and no transaction, only words and the rules they are held to.
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

/** A detail field's value: one scalar, never a nested object (the boundary holds that). */
export type DetailValue = string | number | boolean;

/**
 * What a detail field may be, named by kind rather than by type, so that a declaration
 * reads as the rule it is held to: an **id** is the minter's shape and never an email; a
 * **role** is one of the three words; a **flag** is an act's confirmation. A kind for a
 * person's name or contact does not exist, which is how the ledger stays a table an
 * erasure never rewrites; a kind an act needs and this list lacks is added here, with the
 * act that needs it. Each kind's check runs on every write.
 */
export const DETAIL_KINDS = {
  id: (value: DetailValue) => typeof value === "string" && ULID.test(value),
  role: (value: DetailValue) => typeof value === "string" && ROLES.some((role) => role === value),
  flag: (value: DetailValue) => typeof value === "boolean",
} as const;

export type DetailKind = keyof typeof DETAIL_KINDS;
/** The fields a declared act's detail carries, each named with its kind. */
export type DetailShape = Readonly<Record<string, DetailKind>>;

type DetailValueOf<K extends DetailKind> = K extends "id"
  ? string
  : K extends "role"
    ? Role
    : boolean;

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

/** One slice's declaration: the family it declared under and the acts it declared. */
export type Declaration = {
  readonly family: Family;
  readonly acts: readonly ActName[];
};

const declared: Declaration[] = [];
const declaredNames = new Set<string>();

const declarationRefusal = (family: Family, name: string): string | undefined => {
  const [prefix, subject] = name.split(".");
  if (!ACT.test(name) || prefix !== family) {
    return `${name} is not a ${family} act of the form family.subject.verb`;
  }
  if (subject !== undefined && NEVER_A_SUBJECT.has(subject)) {
    return `${name} names a record that is never a ledger row`;
  }
  if (declaredNames.has(name)) return `${name} is declared twice`;
  return undefined;
};

/**
 * Declare a slice's acts against one family. Runs when the slice's module loads, so a
 * declaration that breaks a rule fails the first test that imports the slice rather than
 * the first act that reaches production: the name must be `family.subject.verb` under the
 * family it is declared under, may not name a record that is never a ledger row, and may
 * be declared once in the whole tree — an act belongs to one slice. Every name is checked
 * before any is registered, so a refused declaration registers nothing.
 *
 * The declaration is also registered, so one test can walk every slice's acts and hold
 * the family prefix both ways (`packages/core/test/audit.test.ts`).
 */
export const declareActs = <F extends Family, const Acts extends Record<string, Act<ActName<F>>>>(
  family: F,
  acts: Acts,
): Acts => {
  const names = Object.values(acts).map(({ name }) => name);
  for (const name of names) {
    const refusal = declarationRefusal(family, name);
    if (refusal !== undefined) throw new Error(`audit: ${refusal}`);
  }
  for (const name of names) declaredNames.add(name);
  declared.push({ family, acts: names });
  return acts;
};

/** Every declaration made so far, in the order the slices loaded. */
export const declarations = (): readonly Declaration[] => [...declared];

/** Whether an act was declared — the doors' runtime half of "a declared act and nothing else". */
export const isDeclared = (name: string): boolean => declaredNames.has(name);
