/**
 * The repository's error convention in one module (`CODING_RULES.md` § TYPES):
 * failures are *returned*, and `try`/`catch` is written once, here, so that no
 * call site has to remember to write it.
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
