import { ROLES } from "@better-answers/schema";
import type { z } from "zod";

import { PROCESS_PREFIX } from "./actor.ts";
import type { PlatformPrincipal, Principal, Role, UserPrincipal } from "./principal.ts";
import { err, ok, type Result } from "./result.ts";
import type { KernelRefusalOfClass } from "./vocabulary.ts";

export type Effect = "read" | "write";

export const EVERY_PURPOSE = "every";

export type Admits = {
  readonly role: Role;

  readonly purposes: readonly string[] | typeof EVERY_PURPOSE;
};

// The resolver's own words reach a caller from the door, never from here.
export type AdmissionRefusal = KernelRefusalOfClass<"forbidden" | "unauthenticated">;

const ADMISSION_REFUSED = "role-forbids" satisfies AdmissionRefusal;

type AdmissionRefused = typeof ADMISSION_REFUSED;

const reaches = (held: Role, named: Role): boolean => ROLES.indexOf(held) <= ROLES.indexOf(named);

// `ROLES` runs from the highest down, so a named role is reached by itself and everything above.
type Reaching<
  Named extends Role,
  Rest extends readonly Role[] = typeof ROLES,
> = Rest extends readonly [infer Head extends Role, ...infer Tail extends readonly Role[]]
  ? Head extends Named
    ? Head
    : Head | Reaching<Named, Tail>
  : never;

type Admitted<A extends Admits> =
  | (UserPrincipal & { readonly role: Reaching<A["role"]> })
  | (A["purposes"] extends readonly [] ? never : PlatformPrincipal);

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

// A word stated twice counts once in the union it builds, so the count is checked here.
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

const admitsPurpose = (admits: Admits, principal: PlatformPrincipal): boolean =>
  admits.purposes === EVERY_PURPOSE ||
  admits.purposes.includes(principal.actorId.slice(PROCESS_PREFIX.length));

export const admit = <D extends ActDeclaration>(
  declaration: D,
  principal: Principal,
  input: InputOf<D>,
): Result<AdmittedOf<D>, AdmissionRefused> => {
  const { admits } = declaration;
  const wanted = typeof admits === "function" ? admits(input) : admits;
  const opens =
    principal.kind === "platform"
      ? admitsPurpose(wanted, principal)
      : reaches(principal.role, wanted.role);

  // oxlint-disable-next-line typescript/consistent-type-assertions -- `AdmittedOf<D>` is conditional on a `D` still open here, which no runtime predicate resolves for the compiler
  return opens ? ok(principal as AdmittedOf<D>) : err(ADMISSION_REFUSED);
};
