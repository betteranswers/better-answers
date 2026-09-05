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
 * @param byConstraint the constraints this act refuses over, each with its refusal word
 */
export const refusalFor = <Refusal extends string>(
  error: Error,
  byConstraint: Readonly<Record<string, Refusal>>,
): Refusal | Error => {
  // node-postgres puts the violated constraint's name on the error it throws. Read as a
  // whole name first: a substring search over a map with `member_pkey` and
  // `member_pkey_v2` in it would answer whichever was declared first.
  const constraint =
    "constraint" in error && typeof error.constraint === "string" ? error.constraint : "";
  const named = byConstraint[constraint];
  if (named !== undefined) return named;
  // Not every failure carries the field — some drivers and some errors put the name only
  // in the text — so the message is read second, and by containment because that is all
  // the sentence allows.
  for (const [name, refusal] of Object.entries(byConstraint)) {
    if (error.message.includes(name)) return refusal;
  }
  return error;
};
