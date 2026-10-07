import { recomputeVisibilitySourcedFrom } from "../concepts/index.ts";
import { recomputeWriteUpsIncluding } from "../guides/index.ts";
import type { AdminUserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/**
 * Returns every indexed concept citing the documents, each recomputed, and the write-ups
 * recomputed over them. Without `documentIds`, every document in the connected source counts.
 */
export const cascadeOverEvidence = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  input: {
    readonly connectedSourceId: string;
    readonly documentIds?: readonly string[] | undefined;
  },
): Promise<{
  readonly concepts: readonly string[];
  readonly writeUps: readonly string[];
}> => {
  const concepts = await recomputeVisibilitySourcedFrom(admin, tx, input);
  const writeUps = await recomputeWriteUpsIncluding(admin, tx, { iris: concepts });
  return { concepts, writeUps };
};
