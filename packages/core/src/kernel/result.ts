/**
 * The repository's error convention in one module (`CODING_RULES.md` § TYPES):
 * failures are *returned*, and `try`/`catch` is written once, here, so that no
 * call site has to remember to write it.
 *
 * **What a slice returns.** Stated once, here, and followed by every entry point in
 * every slice (T-076; T-063 spec, *Refusals and results*):
 *
 * 1. A slice act returns a `Result`. Not a value it might not have, not a rejected
 *    promise — a value that says which of the two happened.
 * 2. Its error is a **closed union of refusal words a caller can act on** — hyphenated,
 *    named for what refused (`"slug-taken"`, `"not-a-member"`, `"role-forbids"`) — and,
 *    where the act touches a store, **the normalised Error** of a failure no refusal
 *    word covers. A caller tells the two apart by `instanceof Error`: a word is
 *    something to show a person, an Error is something to log and retry.
 * 3. An act that cannot fail today still returns a `Result`, with `never` as its error
 *    type. The shape does not change when its body arrives; only the union widens.
 * 4. **A slice entry point never throws across its seam.** Whatever a driver or an SDK
 *    raises is caught here by `attempt` and comes back as a value. A transport is where
 *    a failure becomes a throw again — a `TRPCError`, a status — because that is where
 *    a protocol has words for it.
 *
 * The constraint helper (`constraint.ts`) is rule 2 applied to Postgres: the constraints
 * a slice refuses over become its words, and every other violation stays the Error.
 */

export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * JavaScript lets anything be thrown, so a `catch` binding is `unknown` and a
 * caller cannot read `.message` off it. The parameter is named `cause` because
 * that is the one name `anti-slop/no-unknown-parameters` allows, and because
 * that is what it becomes on the Error this returns.
 */
export function normalizeError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  if (typeof cause === "string") return new Error(cause);
  return new Error(`non-Error thrown: ${Object.prototype.toString.call(cause)}`, { cause });
}

/**
 * The only `try`/`catch` a caller needs. Wrap the external library — a driver, an
 * SDK, `fetch` — and read the outcome as a value.
 */
export async function attempt<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await operation());
  } catch (cause) {
    return err(normalizeError(cause));
  }
}
