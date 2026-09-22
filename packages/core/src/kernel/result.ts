export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function normalizeError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  if (typeof cause === "string") return new Error(cause);
  return new Error(`non-Error thrown: ${Object.prototype.toString.call(cause)}`, { cause });
}

// After an act's first write, anything it calls rejects: a word it might not read commits the act
// without its step.
export async function attempt<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await operation());
  } catch (cause) {
    return err(normalizeError(cause));
  }
}
