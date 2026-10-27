import type { z } from "zod";

import { PROCESS_PREFIX, ROLES } from "@better-answers/schema";

import { err, ok, type Result } from "../result.ts";
import type { KernelRefusalOfClass } from "../vocabulary.ts";
import type { ProcessPurpose } from "./actor.ts";
import type {
  OperatorPrincipal,
  PlatformPrincipal,
  Principal,
  Role,
  UserPrincipal,
} from "./principal.ts";

export const EVERY_PURPOSE = "every";

type RoleOrPurpose = {
  readonly role: Role;

  readonly purposes: readonly ProcessPurpose[] | typeof EVERY_PURPOSE;
};

export const ADMIN_ALONE = { role: "Admin", purposes: [] } as const;

export const ANY_ROLE = { role: "Viewer", purposes: [] } as const;

export const OPERATOR_ALONE = { operator: true } as const;

export type Admits = RoleOrPurpose | typeof OPERATOR_ALONE;

export type AdmissionRefusal = KernelRefusalOfClass<"forbidden" | "unauthenticated">;

const ROLE_FORBIDS = "role-forbids" satisfies AdmissionRefusal;

const NOT_THE_OPERATOR = "not-the-operator" satisfies AdmissionRefusal;

const reaches = (held: Role, named: Role): boolean => {
  const at = ROLES.indexOf(held);
  return at !== -1 && at <= ROLES.indexOf(named);
};

type ReachingOne<
  Named extends Role,
  Rest extends readonly Role[] = typeof ROLES,
> = Rest extends readonly [infer Head extends Role, ...infer Tail extends readonly Role[]]
  ? Head extends Named
    ? Head
    : Head | ReachingOne<Named, Tail>
  : never;

type Reaching<Named extends Role> = Named extends Role ? ReachingOne<Named> : never;

type Admitted<A extends Admits> = A extends RoleOrPurpose
  ?
      | (UserPrincipal & { readonly role: Reaching<A["role"]> })
      | (A["purposes"] extends readonly [] ? never : PlatformPrincipal)
  : OperatorPrincipal;

type Refused<A extends Admits> = A extends RoleOrPurpose
  ? typeof ROLE_FORBIDS
  : typeof NOT_THE_OPERATOR;

export type ActionDeclaration<
  Schema extends z.ZodType = z.ZodType,
  A extends Admits = Admits,
  Word extends string = string,
> = {
  readonly admits: A | ((input: z.output<Schema>) => A);

  readonly input: Schema;

  readonly refuses: readonly Word[];
};

export type InputOf<D extends ActionDeclaration> = z.output<D["input"]>;

export type RefusalOf<D extends ActionDeclaration> = D["refuses"][number];

type ReadsAdmits = (input: never) => Admits;

type AdmitsOf<D extends ActionDeclaration> = [Extract<D["admits"], ReadsAdmits>] extends [never]
  ? Extract<D["admits"], Admits>
  : ReturnType<Extract<D["admits"], ReadsAdmits>>;

export type AdmittedOf<D extends ActionDeclaration> = Admitted<AdmitsOf<D>>;

type AdmissionRefusedOf<D extends ActionDeclaration> = Refused<AdmitsOf<D>>;

export const declareAction = <
  Schema extends z.ZodType,
  const A extends Admits,
  const Word extends string,
>(
  declaration: ActionDeclaration<Schema, A, Word>,
): ActionDeclaration<Schema, A, Word> => {
  const { refuses } = declaration;
  const twice = refuses.find((word) => refuses.indexOf(word) !== refuses.lastIndexOf(word));
  if (twice !== undefined) throw new Error(`admission: ${twice} is listed twice`);
  return declaration;
};

const admitsPurpose = (admits: RoleOrPurpose, principal: PlatformPrincipal): boolean =>
  admits.purposes === EVERY_PURPOSE ||
  admits.purposes.some((purpose) => purpose === principal.actorId.slice(PROCESS_PREFIX.length));

const opens = (wanted: Admits, principal: Principal | OperatorPrincipal): boolean => {
  if ("operator" in wanted) return principal.kind === "operator";
  if (principal.kind === "operator") return false;
  return principal.kind === "platform"
    ? admitsPurpose(wanted, principal)
    : reaches(principal.role, wanted.role);
};

export const admit = <D extends ActionDeclaration>(
  declaration: D,
  principal: Principal | OperatorPrincipal,
  input: InputOf<D>,
): Result<AdmittedOf<D>, AdmissionRefusedOf<D>> => {
  const { admits } = declaration;
  const wanted = typeof admits === "function" ? admits(input) : admits;
  const answered = opens(wanted, principal)
    ? ok(principal)
    : err("operator" in wanted ? NOT_THE_OPERATOR : ROLE_FORBIDS);

  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- both sides turn on a `D` still open here, which no runtime check narrows
  return answered as Result<AdmittedOf<D>, AdmissionRefusedOf<D>>;
};
