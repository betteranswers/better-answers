import { z } from "zod";

import {
  ACT,
  AUDIENCES,
  boundarySchemas,
  CONTENT_HASH,
  FAMILIES,
  GIT_SHA,
  IRI,
  ROLES,
  SENSITIVITIES,
  ULID,
} from "@better-answers/schema";

import type { Role } from "../kernel/index.ts";

type AuditEventRow = z.infer<typeof boundarySchemas.auditEvent.select>;

export type Family = AuditEventRow["family"];

export type ActName<F extends Family = Family> = Extract<AuditEventRow["act"], `${F}.${string}`>;

/** Ids alone: the assistant's and the workspace's names are read when the grant is shown. */
export const endedGrant = z.strictObject({
  clientId: z.string().min(1),
  workspaceId: boundarySchemas.workspace.select.shape.id.nullable(),
  issuedAt: z.iso.datetime(),
});

export type EndedGrant = z.output<typeof endedGrant>;

/** A person or group a search found, by id alone: a typed name or address is never stored. */
const MATCHED_KINDS = ["person", "group"] as const;

const matched = z.strictObject({
  kind: z.enum(MATCHED_KINDS),
  id: z.string().regex(ULID),
});

export type Matched = z.output<typeof matched>;

export const matchedList = z.array(matched);

type DetailEntry = Readonly<Record<string, string | null>>;

export type DetailValue = string | number | boolean | readonly DetailEntry[];

/** How a person signed in: the code a sign-in email carries, typed, the link beside it, or a passkey. */
const SIGN_IN_METHODS = ["email_code", "email_link", "passkey"] as const;

export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

/** The two kinds of second factor a person can confirm with or set up. */
const SECOND_FACTORS = ["passkey", "authenticator"] as const;

export type SecondFactor = (typeof SECOND_FACTORS)[number];

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
  grants: (value: DetailValue) => z.array(endedGrant).safeParse(value).success,
  signInMethod: (value: DetailValue) =>
    typeof value === "string" && SIGN_IN_METHODS.some((method) => method === value),
  secondFactor: (value: DetailValue) =>
    typeof value === "string" && SECOND_FACTORS.some((factor) => factor === value),
  "family?": (value: DetailValue) =>
    typeof value === "string" && FAMILIES.some((family) => family === value),
  matched: (value: DetailValue) => matchedList.safeParse(value).success,
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
      : K extends "grants"
        ? readonly EndedGrant[]
        : K extends "signInMethod"
          ? SignInMethod
          : K extends "secondFactor"
            ? SecondFactor
            : K extends "family?"
              ? Family
              : K extends "matched"
                ? readonly Matched[]
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

export type AuditAct<Name extends ActName = ActName, Shape extends DetailShape = DetailShape> = {
  readonly name: Name;
  readonly detail: Shape;
};

export const act = <Name extends ActName, const Shape extends DetailShape>(
  name: Name,
  detail: Shape,
): AuditAct<Name, Shape> => ({ name, detail });

const NEVER_A_SUBJECT: ReadonlySet<string> = new Set([
  "run",
  "answer_audit",
  "signal",
  "alert",
  "spend",
  "llm_call",
  "backup",
  "health_check",
  "inbox",
]);

export type Declaration = {
  readonly family: Family;
  readonly acts: readonly ActName[];
  readonly detailKeys: readonly string[];
};

const declared: Declaration[] = [];
const declaredNames = new Set<string>();

const declarationRefusal = (
  family: Family,
  name: string,
  earlierInCall: ReadonlySet<string>,
): string | undefined => {
  const [prefix, subject] = name.split(".");
  if (!ACT.test(name) || prefix !== family) {
    return `${name} is not a ${family} act of the form family.subject.verb`;
  }
  if (subject !== undefined && NEVER_A_SUBJECT.has(subject)) {
    return `${name} names a record that is never an audit event`;
  }
  if (declaredNames.has(name) || earlierInCall.has(name)) return `${name} is declared twice`;
  return undefined;
};

/**
 * Declares every act or none: throws when a name is not of the family's form, names a record never
 * kept as an audit event, or is declared already or earlier in the same call.
 */
export const declareActs = <
  F extends Family,
  const Acts extends Record<string, AuditAct<ActName<F>>>,
>(
  family: F,
  acts: Acts,
): Acts => {
  const names = Object.values(acts).map(({ name }) => name);
  const earlierInCall = new Set<string>();
  for (const name of names) {
    const refusal = declarationRefusal(family, name, earlierInCall);
    if (refusal !== undefined) throw new Error(`audit: ${refusal}`);
    earlierInCall.add(name);
  }
  for (const name of names) declaredNames.add(name);
  const detailKeys = new Set(Object.values(acts).flatMap(({ detail }) => Object.keys(detail)));
  declared.push({ family, acts: names, detailKeys: [...detailKeys] });
  return acts;
};

const identitySetNames = new Set<string>();

/**
 * Which audit log keeps an act is fixed where it is declared, so no caller can file a person's own
 * act in a workspace.
 */
export const declareIdentitySetActs = <
  F extends Family,
  const Acts extends Record<string, AuditAct<ActName<F>>>,
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
