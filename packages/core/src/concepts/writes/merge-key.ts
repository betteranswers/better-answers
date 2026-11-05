import { foldKind } from "../../bundle/index.ts";
import { mergeKeyOf, type Held } from "../import/landing.ts";

export const mergeKeyMovedBy = (
  held: Pick<Held, "kind" | "title">,
  proposed: { readonly kind: string; readonly title: string },
): string | undefined => {
  const proposedKey = mergeKeyOf(foldKind(proposed.kind), proposed.title);
  return proposedKey === mergeKeyOf(held.kind, held.title) ? undefined : proposedKey;
};

/** The writer and the reconciler's replay both land an accepted suggestion at this key. */
export const acceptedKeyOf = (
  suggested: string,
  held: Pick<Held, "kind" | "title"> | undefined,
  proposed: { readonly kind: string; readonly title: string },
): string => (held === undefined ? undefined : mergeKeyMovedBy(held, proposed)) ?? suggested;
