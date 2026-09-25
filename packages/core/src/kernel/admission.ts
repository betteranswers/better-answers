import { ROLES } from "@better-answers/schema";
import type { z } from "zod";

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

export type Effect = "read" | "write";

export const EVERY_PURPOSE = "every";

type RoleOrPurpose = {
  readonly role: Role;

  readonly purposes: readonly string[] | typeof EVERY_PURPOSE;
};

/** No role and no purpose reaches an act that admits this. */
export const OPERATOR_ALONE = { operator: true } as const;

export type Admits = RoleOrPurpose | typeof OPERATOR_ALONE;

/** The resolver's own words reach a caller from the door, never from here. */
export type AdmissionRefusal = KernelRefusalOfClass<"forbidden" | "unauthenticated">;

const ROLE_FORBIDS = "role-forbids" satisfies AdmissionRefusal;

const NOT_THE_OPERATOR = "not-the-operator" satisfies AdmissionRefusal;

const reaches = (held: Role, named: Role): boolean => ROLES.indexOf(held) <= ROLES.indexOf(named);

/**
 * `ROLES` runs from the highest down, so a named role is reached by itself and everything above.
 */
type Reaching<
  Named extends Role,
  Rest extends readonly Role[] = typeof ROLES,
> = Rest extends readonly [infer Head extends Role, ...infer Tail extends readonly Role[]]
  ? Head extends Named
    ? Head
    : Head | Reaching<Named, Tail>
  : never;

type Admitted<A extends Admits> = A extends RoleOrPurpose
  ?
      | (UserPrincipal & { readonly role: Reaching<A["role"]> })
      | (A["purposes"] extends readonly [] ? never : PlatformPrincipal)
  : OperatorPrincipal;

type Refused<A extends Admits> = A extends RoleOrPurpose
  ? typeof ROLE_FORBIDS
  : typeof NOT_THE_OPERATOR;

export type ActDeclaration<
  Schema extends z.ZodType = z.ZodType,
  A extends Admits = Admits,
  Word extends string = string,
  E extends Effect = Effect,
> = {
  readonly admits: A | ((input: z.output<Schema>) => A);

  readonly input: Schema;

  readonly refuses: readonly Word[];

  readonly effect: E;
};

export type InputOf<D extends ActDeclaration> = z.output<D["input"]>;

export type RefusalOf<D extends ActDeclaration> = D["refuses"][number];

type ReadsAdmits = (input: never) => Admits;

type AdmitsOf<D extends ActDeclaration> = [Extract<D["admits"], ReadsAdmits>] extends [never]
  ? Extract<D["admits"], Admits>
  : ReturnType<Extract<D["admits"], ReadsAdmits>>;

export type AdmittedOf<D extends ActDeclaration> = Admitted<AdmitsOf<D>>;

type AdmissionRefusedOf<D extends ActDeclaration> = Refused<AdmitsOf<D>>;

/**
 * Hands the declaration back unchanged. A word stated twice counts once in the union it builds,
 * so the count is checked here.
 *
 * @throws when `refuses` lists one word twice.
 */
export const declareAct = <
  Schema extends z.ZodType,
  const A extends Admits,
  const Word extends string,
  const E extends Effect,
>(
  declaration: ActDeclaration<Schema, A, Word, E>,
): ActDeclaration<Schema, A, Word, E> => {
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
 * purpose, or the operator where the act admits them alone. An `admits` written as a function is
 * read from `input`. Anyone else is refused `role-forbids`, or `not-the-operator` by an operator's
 * act.
 */
export const admit = <D extends ActDeclaration>(
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
