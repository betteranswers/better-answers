import { recomputeVisibilitySourcedFrom } from "../concepts/index.ts";
import { recomputeCompositionsIncluding } from "../guides/index.ts";
import type { AdminUserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

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
