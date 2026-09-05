/**
 * Postgres's constraint names, read into a slice's own vocabulary.
 *
 * A slice names the constraints whose violation is a refusal a caller can act on — a
 * slug already held, a workspace already there, a person who is not on the identity
 * set — and nothing else. Every other failure is the store's, and comes back as the
 * normalised Error itself: the result convention (`result.ts`) says a slice entry point
 * never throws, so this returns the error rather than re-raising it and the seam stays
 * a value in both cases. A caller distinguishes the two by `instanceof Error`, which is
 * also how the two arms of its error union differ in the type.
 */

/**
 * @param error the normalised Error `attempt` returned
 * @param named the constraints this act refuses over, each mapped to its refusal word
 */
export const refusalFor = <Refusal extends string>(
  error: Error,
  named: Readonly<Record<string, Refusal>>,
): Refusal | Error => {
  // node-postgres puts the violated constraint's name on the error it throws; older
  // messages carry it only in the text, so both are read.
  const constraint =
    "constraint" in error && typeof error.constraint === "string" ? error.constraint : "";
  const detail = `${error.message} ${constraint}`;
  for (const [name, refusal] of Object.entries(named)) {
    if (detail.includes(name)) return refusal;
  }
  return error;
};
