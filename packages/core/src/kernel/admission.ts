import { ROLES } from "@better-answers/schema";
import type { z } from "zod";

import { PROCESS_PREFIX } from "./actor.ts";
import type { PlatformPrincipal, Principal, Role, UserPrincipal } from "./principal.ts";
import { err, ok, type Result } from "./result.ts";
import type { KernelRefusalOfClass } from "./vocabulary.ts";

export type Effect = "read" | "write";

export const EVERY_PURPOSE = "every";

export const NO_PERSON = "nobody";

export type Admits = {
  readonly role: Role | typeof NO_PERSON;

  readonly purposes: readonly string[] | typeof EVERY_PURPOSE;
};

export type AdmissionRefusal = KernelRefusalOfClass<"forbidden" | "unauthenticated">;

// No row is read here, so nothing a credential could have done since sign-in can be known.
const ADMISSION_REFUSED = "role-forbids" satisfies AdmissionRefusal;

type AdmissionRefused = typeof ADMISSION_REFUSED;

export const reaches = (held: Role, named: Role): boolean =>
  ROLES.indexOf(held) <= ROLES.indexOf(named);

export type Reaching<
  Named extends Role,
  Rest extends readonly Role[] = typeof ROLES,
> = Rest extends readonly [infer Head extends Role, ...infer Tail extends readonly Role[]]
  ? Head extends Named
    ? Head
    : Head | Reaching<Named, Tail>
  : never;

export type Admitted<A extends Admits> =
  | (A["role"] extends Role ? UserPrincipal & { readonly role: Reaching<A["role"]> } : never)
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

// The words are fenced as registered by the slice's own refusal type; what a declaration
// cannot state twice, or leave out, is held here.
const declarationRefusal = (refuses: readonly string[]): string | undefined => {
  for (const word of refuses) {
    if (refuses.indexOf(word) !== refuses.lastIndexOf(word)) return `${word} is listed twice`;
  }
  return refuses.includes(ADMISSION_REFUSED)
    ? undefined
    : `an act that admits may refuse, so ${ADMISSION_REFUSED} belongs in its words`;
};

export const declareAct = <
  Schema extends z.ZodType,
  const A extends Admits,
  const Word extends string,
  const E extends Effect,
>(
  declaration: ActDeclaration<Schema, A, Word, E>,
): ActDeclaration<Schema, A, Word, E> => {
  const refusal = declarationRefusal(declaration.refuses);
  if (refusal !== undefined) throw new Error(`admission: ${refusal}`);
  return declaration;
};

const admitsPurpose = (admits: Admits, principal: PlatformPrincipal): boolean =>
  admits.purposes === EVERY_PURPOSE ||
  admits.purposes.includes(principal.actorId.slice(PROCESS_PREFIX.length));

const admitsRole = (admits: Admits, principal: UserPrincipal): boolean =>
  admits.role !== NO_PERSON && reaches(principal.role, admits.role);

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
      : admitsRole(wanted, principal);

  // SAFETY: the two branches above are the runtime reading of the conditional `Admitted` type.
  return opens ? ok(principal as AdmittedOf<D>) : err(ADMISSION_REFUSED);
};
