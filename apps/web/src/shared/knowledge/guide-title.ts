import { collectionNameOf } from "./collection-name.ts";

type Titled = {
  readonly collection: string;
  readonly subject: { readonly title: string } | null;
};

export const guideTitleOf = (guide: Titled): string =>
  guide.subject?.title ?? collectionNameOf(guide.collection);
