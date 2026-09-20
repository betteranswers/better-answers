import { recomputeVisibilitySourcedFrom } from "../concepts/index.ts";
import { recomputeCompositionsIncluding } from "../guides/index.ts";
import type { AdminUserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/**
 * The two levels of the visibility cascade that sit **outside** the sources slice's own rows
 * (ADR 0023, ADR 0039), run in the order the derivation depends on: every concept citing the
 * evidence that moved is re-derived first, then every composition including one of those
 * concepts.
 *
 * It is one function rather than two calls at each act because the order is the invariant, not
 * the calls: a composition re-derived before the concepts it includes would be computed from
 * classes about to change, and the act would commit a composition wider than its own concepts.
 * Both acts that move a binding's evidence — narrowing the binding, and narrowing named
 * documents of it — reach the rest of the cascade through here.
 *
 * It takes the transaction and never a door, as the level below it does: the caller owns the
 * transaction, and a failure here aborts the caller's act rather than leaving a level rewritten
 * beside one that is not.
 */
export const cascadeOverEvidence = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  input: { readonly bindingId: string; readonly documentIds?: readonly string[] | undefined },
): Promise<{
  readonly concepts: readonly string[];
  readonly compositions: readonly string[];
}> => {
  const concepts = await recomputeVisibilitySourcedFrom(admin, tx, input);
  const compositions = await recomputeCompositionsIncluding(admin, tx, { iris: concepts });
  return { concepts, compositions };
};
