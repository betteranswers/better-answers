import { collectionLabelOf } from "@/shared/knowledge/collection-name.ts";
import { conceptMatchKey, conceptPageOf } from "@/shared/knowledge/concept-address.ts";
import {
  EvidenceInline,
  SensitivityTag,
  type Heading,
  type Opened,
} from "@/shared/knowledge/evidence-panel.tsx";
import { TrustMark } from "@/shared/knowledge/trust-mark.tsx";
import { TypeLine } from "@/shared/knowledge/type-line.tsx";
import { useLandingLine } from "@/shared/landing.ts";
import { RowLink } from "@/shared/list/grid-table.tsx";
import { Button } from "@/shared/ui/button.tsx";

import type { ConceptMatch, Match, PassageMatch } from "./knowledge-api.ts";
import { SEARCH_WORDS as WORDS } from "./knowledge-words.ts";

export const keyOf = (match: Match): string =>
  match.layer === "bundles" ? conceptMatchKey(match.iri) : `sources:${match.locator}`;

export const openerIdOf = (key: string): string => `opener-${encodeURIComponent(key)}`;

const TITLE = "min-w-0 grow basis-48 font-medium break-words";

type Returning = { readonly key: string | undefined; readonly landed: () => void };

export type Reading = {
  readonly returning: Returning;
  readonly onRead: (match: ConceptMatch, page: string) => void;
};

export function ConceptLine(properties: {
  readonly match: ConceptMatch;
  readonly opening: Opening;
  readonly reading: Reading;
}) {
  const { match, opening, reading } = properties;
  const page = conceptPageOf(match.iri);
  const land = useLandingLine(keyOf(match) === reading.returning.key, reading.returning.landed);
  return (
    <div className="grid justify-items-start gap-1">
      {page === undefined ? (
        <span className={TITLE}>{match.title}</span>
      ) : (
        <RowLink
          ref={land}
          href={page}
          className={TITLE}
          onOpen={() => {
            opening.open(match);
          }}
        >
          {match.title}
        </RowLink>
      )}
      {match.description === null ? null : (
        <p className="line-clamp-2 max-w-full text-muted-foreground">{match.description}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <TrustMark trust={match.trust} words={match.trustWords} dated />
        <TypeLine type={match.conceptType} collection={collectionLabelOf(match.collection)} />
      </div>
    </div>
  );
}

export type Opening = {
  readonly opened: Opened | undefined;
  readonly beside: boolean;
  readonly focusFromBodyOr: Heading | undefined;
  readonly open: (match: Match) => void;
  readonly onClose: () => void;
};

export function PassageLine(properties: {
  readonly match: PassageMatch;
  readonly opening: Opening;
}) {
  const { match, opening } = properties;
  const key = keyOf(match);
  const opened = opening.opened?.key === key ? opening.opened : undefined;
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Button
          id={openerIdOf(key)}
          variant="link"
          aria-expanded={opened !== undefined}
          className={`h-auto justify-start px-0 text-left whitespace-normal ${TITLE}`}
          onClick={() => {
            opening.open(match);
          }}
        >
          {match.title}
        </Button>
        <SensitivityTag sensitivity={match.sensitivity} />
        <TypeLine type={WORDS.document} className="basis-full" />
      </div>
      <p className="mt-1 break-words text-muted-foreground">{match.openingLine}</p>
      {opened === undefined || opening.beside ? null : (
        <EvidenceInline
          opened={opened}
          onClose={opening.onClose}
          focusFromBodyOr={opening.focusFromBodyOr}
        />
      )}
    </>
  );
}
