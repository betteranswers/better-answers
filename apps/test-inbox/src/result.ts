export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

/** Answers a rejection from the runtime or D1 as an error, so no caller needs a `catch`. */
export const attempted = async <T>(work: () => Promise<Result<T>>): Promise<Result<T>> => {
  try {
    return await work();
  } catch (error) {
    // Each caller answers this error with a 503, or logs it.
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};
