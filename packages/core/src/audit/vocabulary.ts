import {
  ACT,
  AUDIENCES,
  CONTENT_HASH,
  GIT_SHA,
  IRI,
  ROLES,
  SENSITIVITIES,
  ULID,
} from "@better-answers/schema";
import type { boundarySchemas } from "@better-answers/schema";
import type { z } from "zod";

import type { Role } from "../kernel/index.ts";

type AuditEventRow = z.infer<typeof boundarySchemas.auditEvent.select>;

export type Family = AuditEventRow["family"];

export type ActName<F extends Family = Family> = Extract<AuditEventRow["act"], `${F}.${string}`>;

export type DetailValue = string | number | boolean;

const isId = (value: DetailValue) => typeof value === "string" && ULID.test(value);
const isFlag = (value: DetailValue) => typeof value === "boolean";
const isIri = (value: DetailValue) => typeof value === "string" && IRI.test(value);
const isContentHash = (value: DetailValue) => typeof value === "string" && CONTENT_HASH.test(value);

export const DETAIL_KINDS = {
  id: isId,
  "id?": isId,
  role: (value: DetailValue) => typeof value === "string" && ROLES.some((role) => role === value),
  flag: isFlag,
  "flag?": isFlag,
  iri: isIri,
  "iri?": isIri,
  gitSha: (value: DetailValue) => typeof value === "string" && GIT_SHA.test(value),
  contentHash: isContentHash,
  "contentHash?": isContentHash,
  count: (value: DetailValue) => typeof value === "number" && Number.isInteger(value) && value >= 0,
  sensitivity: (value: DetailValue) =>
    typeof value === "string" && SENSITIVITIES.some((word) => word === value),
  audience: (value: DetailValue) =>
    typeof value === "string" && AUDIENCES.some((word) => word === value),
} as const;

export type DetailKind = keyof typeof DETAIL_KINDS;

export type DetailShape = Readonly<Record<string, DetailKind>>;

type OptionalDetailKind = Extract<DetailKind, `${string}?`>;

export const isOptionalKind = (kind: DetailKind): boolean => kind.endsWith("?");

type DetailValueOf<K extends DetailKind> = K extends "role"
  ? Role
  : K extends "flag" | "flag?"
    ? boolean
    : K extends "count"
      ? number
      : string;

export type DetailOf<Shape extends DetailShape> = {
  readonly [
    Field in keyof Shape as Shape[Field] extends OptionalDetailKind ? never : Field
  ]: DetailValueOf<Shape[Field]>;
} & {
  readonly [
    Field in keyof Shape as Shape[Field] extends OptionalDetailKind ? Field : never
  ]?: DetailValueOf<Shape[Field]>;
};

export type LedgerAct<Name extends ActName = ActName, Shape extends DetailShape = DetailShape> = {
  readonly name: Name;
  readonly detail: Shape;
};

export const act = <Name extends ActName, const Shape extends DetailShape>(
  name: Name,
  detail: Shape,
): LedgerAct<Name, Shape> => ({ name, detail });

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

export const declareActs = <
  F extends Family,
  const Acts extends Record<string, LedgerAct<ActName<F>>>,
>(
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

const identitySetNames = new Set<string>();

// Which ledger keeps an act is fixed where it is declared, so no caller can file a person's own
// act in a workspace.
export const declareIdentitySetActs = <
  F extends Family,
  const Acts extends Record<string, LedgerAct<ActName<F>>>,
>(
  family: F,
  acts: Acts,
): Acts => {
  const registered = declareActs(family, acts);
  for (const { name } of Object.values(acts)) identitySetNames.add(name);
  return registered;
};

export const declarations = (): readonly Declaration[] => [...declared];

export const isDeclared = (name: string): boolean => declaredNames.has(name);

export const isIdentitySetAct = (name: string): boolean => identitySetNames.has(name);
