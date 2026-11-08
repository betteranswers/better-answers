import { foldConceptType } from "../../bundle/index.ts";
import { mergeKeyOf, type Held } from "../import/landing.ts";

export const mergeKeyMovedBy = (
  held: Pick<Held, "conceptType" | "title">,
  proposed: { readonly conceptType: string; readonly title: string },
): string | undefined => {
  const proposedKey = mergeKeyOf(foldConceptType(proposed.conceptType), proposed.title);
  return proposedKey === mergeKeyOf(held.conceptType, held.title) ? undefined : proposedKey;
};

export const acceptedKeyOf = (
  suggested: string,
  held: Pick<Held, "conceptType" | "title"> | undefined,
  proposed: { readonly conceptType: string; readonly title: string },
): string => (held === undefined ? undefined : mergeKeyMovedBy(held, proposed)) ?? suggested;

export const heldAsWritten = (
  held: Pick<Held, "mergeKey" | "conceptType" | "title"> | undefined,
  mergeKey: string,
  written: { readonly conceptType: string; readonly title: string },
): boolean =>
  held?.mergeKey === mergeKey &&
  held.title === written.title &&
  held.conceptType === foldConceptType(written.conceptType);
