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
 * An Error as it came, a string as an Error's message, and anything else as an Error that names
 * its type and keeps it as `cause`.
 */
export function normalizeError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  if (typeof cause === "string") return new Error(cause);
  return new Error(`non-Error thrown: ${Object.prototype.toString.call(cause)}`, { cause });
}

/**
 * What `operation` resolves to, or its rejection as a normalised Error; it never rejects itself.
 * After an act's first write, anything the act calls rejects: a word it might not read commits the
 * act without its step.
 */
export async function attempt<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await operation());
  } catch (cause) {
    return err(normalizeError(cause));
  }
}

/** As `attempt`, for an operation that answers a Result: its refusal and a rejection meet in one. */
export async function attemptResult<T, E>(
  operation: () => Promise<Result<T, E>>,
): Promise<Result<T, E | Error>> {
  const ran = await attempt(operation);
  return ran.ok ? ran.value : ran;
}
