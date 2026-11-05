import { useLandingLine } from "@/shared/landing.ts";
import { RowLink } from "@/shared/list/grid-table.tsx";

import { conceptMatchKey, conceptPageOf } from "./concept-address.ts";
import { useOpenMatch } from "./open-match.ts";

export function ConceptLink(properties: {
  readonly concept: { readonly iri: string; readonly title: string };
  readonly landsHere: boolean;
  readonly onLanded: () => void;
}) {
  const { concept } = properties;
  const openMatch = useOpenMatch();
  const land = useLandingLine(properties.landsHere, properties.onLanded);
  const page = conceptPageOf(concept.iri);
  if (page === undefined) return <span className="font-medium wrap-anywhere">{concept.title}</span>;
  return (
    <RowLink
      ref={land}
      href={page}
      onOpen={() => {
        openMatch({ key: conceptMatchKey(concept.iri), page });
      }}
    >
      {concept.title}
    </RowLink>
  );
}
