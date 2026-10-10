import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useId, useRef, useState, type RefObject } from "react";

import { refusalOf, type ApiError } from "@/shared/api/trpc.ts";
import { useBreadcrumbLastPart } from "@/shared/breadcrumb-last-part.ts";
import { RowLink } from "@/shared/grid-table.tsx";
import { useKeystroke, usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { ListState } from "@/shared/list-pages.tsx";
import { sentenceOf } from "@/shared/refusal-words.ts";
import { SummaryRow } from "@/shared/summary-row.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { useRoomBeside } from "@/shared/wide-layout.ts";
import { dayWords } from "@/shared/words.ts";

import {
  BROWSE,
  conceptMatchKey,
  conceptPageOf,
  OPENED_FROM,
  searchAt,
} from "./concept-address.ts";
import { ConceptBody, opensSomething, type MarkOpening } from "./concept-body.tsx";
import {
  descriptionOf,
  furtherKeysOf,
  kindOf,
  tagsOf,
  titleOf,
  verifiedEventsOf,
  type VerifiedEvent,
} from "./concept-frontmatter.ts";
import { EvidenceInline, EvidenceSheet, type Opened } from "./evidence-panel.tsx";
import { useConcept, type Concept, type Evidence } from "./knowledge-api.ts";
import { CONCEPT_KEYSTROKES as KEY } from "./knowledge-state.ts";
import { CONCEPT_WORDS as WORDS, RELATION_WORDS } from "./knowledge-words.ts";
import { SAID_OF_KNOWLEDGE } from "./refusal-words.ts";
import { failedReadWords } from "./refusal.tsx";

const LISTED = Object.values(KEY);

const LINK = "text-brand underline underline-offset-4";

/** Search at the query its reader left, with focus back on the match this page was opened from. */
const useWayBack = (iri: string | undefined) => {
  const navigate = useNavigate();
  const searchQuery = useRouterState({
    select: (state) => OPENED_FROM.safeParse(state.location.state).data?.searchQuery,
  });
  const href = searchAt(searchQuery);
  const go = () => {
    void navigate({
      href,
      state: (held) => (iri === undefined ? held : { ...held, openedMatch: conceptMatchKey(iri) }),
    });
  };
  return { href, go };
};

function WayBack(properties: { readonly iri: string | undefined }) {
  const wayBack = useWayBack(properties.iri);
  return (
    <RowLink href={wayBack.href} className={LINK} onOpen={wayBack.go}>
      {WORDS.toSearch}
    </RowLink>
  );
}

/** One state for an address that is malformed, names no concept, or names one withheld. */
function NoSuchConcept(properties: { readonly iri: string | undefined }) {
  return (
    <ListState
      state={{
        kind: "empty",
        words: sentenceOf(SAID_OF_KNOWLEDGE["not-found"]),
        action: <WayBack iri={properties.iri} />,
      }}
    />
  );
}

const namesNothing = (failure: Error | ApiError): boolean => {
  const word = refusalOf(failure)?.word;
  return word === "not-found" || word === "malformed";
};

type Heading = RefObject<HTMLHeadingElement | null>;

const SECTION_HEADING = "[font-size:var(--text-md)] font-semibold";

function Header(properties: { readonly concept: Concept; readonly titleId: string }) {
  const { frontmatter, trustWords } = properties.concept;
  const kind = kindOf(frontmatter);
  const description = descriptionOf(frontmatter);
  const tags = tagsOf(frontmatter);
  return (
    <header className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        {kind === undefined ? null : <Pill>{kind}</Pill>}
        <Pill>{trustWords}</Pill>
      </div>
      <h2 id={properties.titleId} className="mt-3 [font-size:var(--text-2xl)] wrap-anywhere">
        {titleOf(frontmatter)}
      </h2>
      {description === undefined ? null : (
        <p className="mt-2 text-muted-foreground">{description}</p>
      )}
      {tags.length === 0 ? null : (
        <ul aria-label={WORDS.tags} className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag, at) => (
            <li key={`${String(at)}:${tag}`}>
              <Pill variant="outline">{tag}</Pill>
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

const sourceOpened = (item: Evidence): Opened["source"] | undefined => {
  if (item.locator !== undefined) return { kind: "passage", locator: item.locator };
  return item.iri === undefined ? undefined : { kind: "concept", iri: item.iri };
};

function SourceLine(properties: {
  readonly item: Evidence;
  readonly source: number;
  readonly opening: MarkOpening;
}) {
  const { item, source, opening } = properties;
  const openerId = useId();
  const open = opening.openerId === openerId;
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono [font-size:var(--text-xs)] text-muted-foreground">
          [{source + 1}]
        </span>
        {opensSomething(item) ? (
          <Button
            id={openerId}
            variant="link"
            aria-expanded={open}
            className="h-auto min-w-0 justify-start px-0 py-0 text-left wrap-anywhere whitespace-normal"
            onClick={() => {
              opening.onOpen({ openerId, source });
            }}
          >
            {item.source}
          </Button>
        ) : (
          <span className="min-w-0 wrap-anywhere">{item.source}</span>
        )}
        {item.at === undefined ? null : (
          <span className="text-muted-foreground">{WORDS.place(item.at)}</span>
        )}
      </div>
      {open ? opening.inline : null}
    </li>
  );
}

/** The evidence pane: the reader's access first, every source the file cites, then where to go next. */
function Sources(properties: {
  readonly concept: Concept;
  readonly opening: MarkOpening;
  readonly heading: Heading;
}) {
  const { concept, opening, heading } = properties;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h3 ref={heading} id={headingId} tabIndex={-1} className={SECTION_HEADING}>
        {WORDS.sources}
      </h3>
      <Card marks className="mt-3">
        <div className="px-4 py-3">
          <p>{concept.lead}</p>
        </div>
        {concept.evidence.length === 0 ? null : (
          <ol className="divide-y divide-border border-t border-border">
            {concept.evidence.map((item, source) => (
              // The file's order is the only identity a source has: two may share every word.
              <SourceLine key={source} item={item} source={source} opening={opening} />
            ))}
          </ol>
        )}
        <div className="border-t border-border px-4 py-3">
          <p className="text-muted-foreground">{concept.next}</p>
        </div>
      </Card>
    </section>
  );
}

const eventWords = (event: VerifiedEvent): string =>
  WORDS.verifiedOn(
    Number.isNaN(Date.parse(event.at)) ? event.at : dayWords(event.at),
    event.byAPerson,
  );

function Verification(properties: { readonly concept: Concept }) {
  const headingId = useId();
  const events = verifiedEventsOf(properties.concept.frontmatter);
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h3 id={headingId} className={SECTION_HEADING}>
        {WORDS.verification}
      </h3>
      {events.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{WORDS.neverVerified}</p>
      ) : (
        <ul className="mt-2 grid gap-1">
          {events.map((event, at) => (
            <li key={at}>{eventWords(event)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Links(properties: { readonly concept: Concept; readonly heading: Heading }) {
  const headingId = useId();
  const { concept, heading } = properties;
  const { relations } = concept;
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h3 ref={heading} id={headingId} tabIndex={-1} className={SECTION_HEADING}>
        {WORDS.links}
      </h3>
      {relations.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{WORDS.noLinks}</p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {relations.map((relation) => {
            const page = conceptPageOf(relation.target);
            const kind = RELATION_WORDS.get(relation.kind);
            return (
              <li
                key={`${relation.kind}:${relation.target}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
              >
                {kind === undefined ? null : <Pill>{kind}</Pill>}
                {page === undefined ? (
                  <span className="wrap-anywhere">{relation.title}</span>
                ) : (
                  <Link to={page} className={cn(LINK, "wrap-anywhere")}>
                    {relation.title}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The one disclosure: what else the file says of itself, under the file's own key names. */
function Details(properties: { readonly concept: Concept }) {
  const further = furtherKeysOf(properties.concept.frontmatter);
  if (further.length === 0) return null;
  return (
    <Collapsible className="mt-8">
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm">
          {WORDS.details}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          {further.map(([key, words]) => (
            <SummaryRow key={key} term={key}>
              <span className="wrap-anywhere">{words}</span>
            </SummaryRow>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** One reading column, as wide as the body's own measure, so the sources sit under what cites them. */
const COLUMN = "max-w-measure [font-size:var(--prose-size,var(--text-lg))]";

const INTERFACE = "[font-size:var(--text-base)]";

function ConceptShown(properties: { readonly iri: string; readonly concept: Concept }) {
  const { iri, concept } = properties;
  useBreadcrumbLastPart(titleOf(concept.frontmatter));
  const titleId = useId();
  const sources = useRef<HTMLHeadingElement>(null);
  const links = useRef<HTMLHeadingElement>(null);
  const beside = useRoomBeside();
  const wayBack = useWayBack(iri);
  const [opened, setOpened] = useState<Opened>();

  usePageKeystrokes(LISTED);
  useKeystroke(KEY.back, wayBack.go);
  useKeystroke(KEY.sources, () => {
    sources.current?.focus();
  });
  useKeystroke(KEY.links, () => {
    links.current?.focus();
  });

  const close = () => {
    setOpened(undefined);
  };
  const opening: MarkOpening = {
    openerId: opened?.openerId,
    onOpen: ({ openerId, source }) => {
      const item = concept.evidence[source];
      const opens = item === undefined ? undefined : sourceOpened(item);
      if (item === undefined || opens === undefined) return;
      setOpened((current) => ({
        key: String(source),
        title: item.source,
        source: opens,
        openerId,
        pressed: (current?.pressed ?? 0) + 1,
      }));
    },
    inline:
      opened === undefined || beside ? undefined : (
        <EvidenceInline opened={opened} onClose={close} />
      ),
  };

  return (
    <article
      aria-labelledby={titleId}
      // Room for the panel beside the page, so it covers none of the claim it was opened from.
      className={cn("mt-6", opened !== undefined && beside && "pr-[var(--container-md)]")}
    >
      <div className={COLUMN}>
        <div className={INTERFACE}>
          <p>
            <WayBack iri={iri} />
          </p>
          <Header concept={concept} titleId={titleId} />
        </div>
        <div className="mt-6">
          <ConceptBody body={concept.body} evidence={concept.evidence} opening={opening} />
        </div>
        <div className={INTERFACE}>
          <Sources concept={concept} opening={opening} heading={sources} />
          <Verification concept={concept} />
          <Links concept={concept} heading={links} />
          <Details concept={concept} />
        </div>
      </div>
      {opened === undefined || !beside ? null : <EvidenceSheet opened={opened} onClose={close} />}
    </article>
  );
}

/** A failed read stands in for even a stale page, so nothing once read outlives being withheld. */
function ConceptRead(properties: { readonly iri: string; readonly heading: Heading }) {
  const { iri } = properties;
  const concept = useConcept(iri);

  if (concept.error !== null) {
    if (namesNothing(concept.error)) return <NoSuchConcept iri={iri} />;
    return (
      <ListState
        state={{
          kind: "failed",
          words: failedReadWords(concept.error),
          onRetry: () => {
            void concept.refetch();
          },
          focusAfterRetry: properties.heading,
        }}
      />
    );
  }
  const read = concept.data?.concept;
  if (read === undefined) {
    return (
      <>
        {/* The title's own room, so the page does not move down as the read lands. */}
        <div aria-hidden className="mt-6 min-h-24" />
        <ListState state={{ kind: "loading", words: WORDS.loading }} />
      </>
    );
  }
  return <ConceptShown iri={iri} concept={read} />;
}

/** `iri` is undefined where the address holds no concept's id, so nothing is asked about it. */
export function ConceptPage(properties: { readonly iri: string | undefined }) {
  const { iri } = properties;
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        {BROWSE.name}
      </h1>
      {iri === undefined ? (
        <NoSuchConcept iri={iri} />
      ) : (
        <ConceptRead key={iri} iri={iri} heading={heading} />
      )}
    </>
  );
}
