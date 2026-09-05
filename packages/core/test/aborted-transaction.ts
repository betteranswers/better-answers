import type { PrincipalRefusal, Result } from "../src/kernel/index.ts";

/**
 * What a slice answered, unwrapped to one value a test can assert on.
 *
 * The claim every suite makes about a transaction Postgres has already aborted is that the
 * slice *answers* rather than throws: the Principal resolved (the abort came after), and the
 * read came back as an `Error` on the inner result. Three unwrappings and three assertions,
 * written out in every suite that made the claim.
 *
 * One value carries all three, because only one of the three roads through this function
 * ends at an `Error`: a Principal that was refused hands back its refusal word, a read that
 * succeeded hands back what it read, and neither is an `Error`. The caller asserts
 * `toBeInstanceOf(Error)` and a wrong shape fails there, in the test, with the value in the
 * message.
 */
export const answered = <T, E>(
  read: Result<Result<T, E>, PrincipalRefusal>,
): T | E | PrincipalRefusal => {
  if (!read.ok) return read.error;
  return read.value.ok ? read.value.value : read.value.error;
};
