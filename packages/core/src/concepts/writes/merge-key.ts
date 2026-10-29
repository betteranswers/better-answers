import { foldKind } from "../../bundle/index.ts";
import { mergeKeyOf, type Held } from "../import/landing.ts";

export const mergeKeyMovedBy = (
  held: Pick<Held, "kind" | "title">,
  proposed: { readonly kind: string; readonly title: string },
): string | undefined => {
  const proposedKey = mergeKeyOf(foldKind(proposed.kind), proposed.title);
  return proposedKey === mergeKeyOf(held.kind, held.title) ? undefined : proposedKey;
};
