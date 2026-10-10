import type { z } from "zod";

import { ROLES } from "@better-answers/schema";

import { PROCESS_PREFIX } from "./actor.ts";
import type {
  OperatorPrincipal,
  PlatformPrincipal,
  Principal,
  Role,
  UserPrincipal,
} from "./principal.ts";
import { err, ok, type Result } from "./result.ts";
import type { KernelRefusalOfClass } from "./vocabulary.ts";

export const EVERY_PURPOSE = "every";

type RoleOrPurpose = {
  readonly role: Role;

  readonly purposes: readonly string[] | typeof EVERY_PURPOSE;
};

/** A person who is an Admin, and the platform for no purpose. */
export const ADMIN_ALONE = { role: "Admin", purposes: [] } as const;

/** No role and no purpose reaches an action that admits this. */
export const OPERATOR_ALONE = { operator: true } as const;

export type Admits = RoleOrPurpose | typeof OPERATOR_ALONE;

/** The resolver's own words reach a caller from the door, never from here. */
export type AdmissionRefusal = KernelRefusalOfClass<"forbidden" | "unauthenticated">;

const ROLE_FORBIDS = "role-forbids" satisfies AdmissionRefusal;

const NOT_THE_OPERATOR = "not-the-operator" satisfies AdmissionRefusal;

/** A role outside the three reaches nothing, whatever a caller's type says. */
const reaches = (held: Role, named: Role): boolean => {
  const at = ROLES.indexOf(held);
  return at !== -1 && at <= ROLES.indexOf(named);
};

/**
 * `ROLES` runs from the highest down, so a named role is reached by itself and everything above.
 */
type ReachingOne<
  Named extends Role,
  Rest extends readonly Role[] = typeof ROLES,
> = Rest extends readonly [infer Head extends Role, ...infer Tail extends readonly Role[]]
  ? Head extends Named
    ? Head
    : Head | ReachingOne<Named, Tail>
  : never;

/** A union of roles is reached by whoever reaches any of them, so by its lowest and above. */
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

  /** The schema an entry parses with; `z.custom<T>()` where no entry parses the input yet. */
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

/**
 * Hands the declaration back unchanged. A word stated twice counts once in the union it builds,
 * so the count is checked here.
 *
 * @throws when `refuses` lists one word twice.
 */
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
  admits.purposes.includes(principal.actorId.slice(PROCESS_PREFIX.length));

const opens = (wanted: Admits, principal: Principal | OperatorPrincipal): boolean => {
  if ("operator" in wanted) return principal.kind === "operator";
  if (principal.kind === "operator") return false;
  return principal.kind === "platform"
    ? admitsPurpose(wanted, principal)
    : reaches(principal.role, wanted.role);
};

/**
 * Admits a person whose role is the declared one or above, the platform acting for a declared
 * purpose, or the operator where the action admits them alone. An `admits` written as a function is
 * read from `input`. Anyone else is refused `role-forbids`, or `not-the-operator` by an operator's
 * action.
 */
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

  // oxlint-disable-next-line typescript/consistent-type-assertions -- both sides turn on a `D` still open here, which no runtime check narrows
  return answered as Result<AdmittedOf<D>, AdmissionRefusedOf<D>>;
};
