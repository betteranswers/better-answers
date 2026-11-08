import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";

import { refusalOf, type ApiError } from "@/shared/api/trpc.ts";
import { useKeystroke, usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { conceptMatchKey, conceptPageOf, wayBackOf } from "@/shared/knowledge/concept-address.ts";
import { ConceptBody, LINK, type MarkOpening } from "@/shared/knowledge/concept-body.tsx";
import { descriptionOf, kindOf, tagsOf, titleOf } from "@/shared/knowledge/concept-frontmatter.ts";
import { CONCEPT_WORDS as WORDS } from "@/shared/knowledge/concept-words.ts";
import {
  EvidenceInline,
  EvidenceSheet,
  type Heading,
  type Opened,
} from "@/shared/knowledge/evidence-panel.tsx";
import { KindLine } from "@/shared/knowledge/kind-line.tsx";
import {
  openingOf,
  useConcept,
  type Concept,
  type Evidence,
} from "@/shared/knowledge/knowledge-reads.ts";
import { useOpenedFrom } from "@/shared/knowledge/open-match.ts";
import { SAID_OF_KNOWLEDGE } from "@/shared/knowledge/refusal-words.ts";
import { failedReadWords } from "@/shared/knowledge/refusal.tsx";
import { TitleBlock } from "@/shared/knowledge/title-block.tsx";
import { copiedToTheClipboard } from "@/shared/lib/clipboard.ts";
import { cn } from "@/shared/lib/utils.ts";
import { RowLink } from "@/shared/list/grid-table.tsx";
import { keyed } from "@/shared/list/keyed.ts";
import { ListState, RecordLoading } from "@/shared/list/list-pages.tsx";
import { useBreadcrumbLastPart } from "@/shared/page/breadcrumb-last-part.ts";
import { PageHead } from "@/shared/page/page-head.tsx";
import { useRoomBeside } from "@/shared/page/wide-layout.ts";
import { STOCK } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { useConceptEditing } from "./editing/concept-actions.tsx";
import {
  CONCEPT_KEYSTROKES as KEY,
  EDITOR_KEYSTROKES,
  wayBackKeystroke,
} from "./knowledge-state.ts";
import { RELATION_WORDS } from "./knowledge-words.ts";

const listedWithWayBackTo = (page: string) => [
  wayBackKeystroke(page),
  KEY.sources,
  KEY.links,
  KEY.copy,
  ...Object.values(EDITOR_KEYSTROKES),
];

const useWayBack = (iri: string | undefined) => {
  const navigate = useNavigate();
  const openedFrom = useOpenedFrom();
  const { page, href } = wayBackOf(openedFrom);
  const openedMatch =
    iri === undefined || openedFrom === undefined ? undefined : conceptMatchKey(iri);
  const go = () => {
    void navigate({
      href,
      state: (held) => ({ ...held, openedFrom: undefined, openedMatch }),
    });
  };
  return { name: page.name, href, go };
};

function WayBack(properties: { readonly iri: string | undefined; readonly quiet?: true }) {
  const wayBack = useWayBack(properties.iri);
  return (
    <RowLink
      href={wayBack.href}
      className={
        properties.quiet === true
          ? "[font-size:var(--text-sm)] font-normal text-muted-foreground underline hover:text-foreground"
          : LINK
      }
      onOpen={wayBack.go}
    >
      {WORDS.backTo(wayBack.name)}
    </RowLink>
  );
}

function NoSuchConcept() {
  return (
    <ListState
      state={{
        kind: "empty",
        words: SAID_OF_KNOWLEDGE["not-found"],
        action: <WayBack iri={undefined} />,
      }}
    />
  );
}

const namesNothing = (failure: Error | ApiError): boolean => {
  const word = refusalOf(failure)?.word;
  return word === "not-found" || word === "malformed";
};

const SECTION_HEADING = "[font-size:var(--text-lg)] font-semibold";

const useCopy = (text: string) => {
  const [said, setSaid] = useState<string>();
  const copy = () => {
    setSaid(undefined);
    void copiedToTheClipboard(text).then((copied) => {
      setSaid(copied ? WORDS.copied : STOCK.copy);
    });
  };
  return { said, copy };
};

function Header(properties: {
  readonly concept: Concept;
  readonly heading: Heading;
  readonly actions: ReactNode;
  readonly copying: ReturnType<typeof useCopy>;
}) {
  const { concept, heading, actions, copying } = properties;
  const { frontmatter, collection } = concept;
  const description = descriptionOf(frontmatter);
  const tags = tagsOf(frontmatter);
  return (
    <>
      <PageHead title={titleOf(frontmatter)} headingRef={heading} inPlace />
      {description === undefined ? null : (
        <p className="mt-1.5 text-muted-foreground [font-size:var(--text-lg)]">{description}</p>
      )}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-border pb-5">
        <KindLine
          kind={kindOf(frontmatter)}
          collection={collection ?? WORDS.noCollection}
          className="min-h-8 items-center [font-size:var(--text-sm)] [&_dd]:text-foreground"
        />
        <div className="flex flex-wrap items-start gap-2">
          <span
            aria-live="polite"
            className="flex min-h-8 items-center text-muted-foreground [font-size:var(--text-sm)]"
          >
            {copying.said}
          </span>
          {actions}
          <Button
            type="button"
            variant="outline"
            aria-keyshortcuts={KEY.copy.key}
            onClick={copying.copy}
          >
            {WORDS.copy}
          </Button>
        </div>
      </div>
      {tags.length === 0 ? null : (
        <ul aria-label={WORDS.tags} className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag, at) => (
            <li key={`${String(at)}:${tag}`}>
              <Pill variant="outline">{tag}</Pill>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SourceLine(properties: {
  readonly item: Evidence;
  readonly source: number;
  readonly opening: MarkOpening;
}) {
  const { item, source, opening } = properties;
  const openerId = useId();
  const open = opening.openerId === openerId;
  return (
    <li className="border-b border-border py-2.5">
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-2">
        <span className="font-mono [font-size:var(--text-xs)] text-muted-foreground">
          [{source + 1}]
        </span>
        {openingOf(item) === undefined ? (
          <span className="min-w-0 wrap-anywhere">{item.source}</span>
        ) : (
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
        )}
        {item.at === undefined ? null : (
          <span className="max-w-40 text-right font-mono [font-size:var(--text-sm)] text-muted-foreground wrap-anywhere">
            {item.at}
          </span>
        )}
      </div>
      {open ? opening.inline : null}
    </li>
  );
}

function Counted(properties: { readonly children: number }) {
  return (
    <span className="ml-1 [font-size:var(--text-base)] font-normal text-muted-foreground">
      {properties.children}
    </span>
  );
}

function Sources(properties: {
  readonly concept: Concept;
  readonly opening: MarkOpening;
  readonly heading: Heading;
}) {
  const { concept, opening, heading } = properties;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 ref={heading} id={headingId} tabIndex={-1} className={SECTION_HEADING}>
        {WORDS.sources} <Counted>{concept.evidence.length}</Counted>
      </h2>
      {concept.access === "included" ? null : (
        <p className="mt-1 text-muted-foreground">{concept.lead}</p>
      )}
      {concept.access === "partly-included" || concept.access === "not-included" ? (
        <p className="mt-1 text-muted-foreground">{concept.next}</p>
      ) : null}
      <ol className="mt-3 border-t border-border">
        {keyed(concept.evidence, ({ source }) => source).map(({ key, item }, source) => (
          <SourceLine key={key} item={item} source={source} opening={opening} />
        ))}
      </ol>
    </section>
  );
}

function Links(properties: { readonly concept: Concept; readonly heading: Heading }) {
  const headingId = useId();
  const { concept, heading } = properties;
  const { relations } = concept;
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 ref={heading} id={headingId} tabIndex={-1} className={SECTION_HEADING}>
        {WORDS.links} <Counted>{relations.length}</Counted>
      </h2>
      <ul className="mt-3 border-t border-border">
        {relations.map((relation) => {
          const page = conceptPageOf(relation.target);
          return (
            <li
              key={`${relation.kind}:${relation.target}`}
              className="flex items-baseline justify-between gap-x-4 border-b border-border py-2.5"
            >
              {page === undefined ? (
                <span className="min-w-0 wrap-anywhere">{relation.title}</span>
              ) : (
                <Link to={page} className={cn(LINK, "min-w-0 wrap-anywhere")}>
                  {relation.title}
                </Link>
              )}
              <span className="shrink-0 text-muted-foreground [font-size:var(--text-sm)]">
                {RELATION_WORDS.get(relation.kind)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const COLUMN = "max-w-measure [font-size:var(--prose-size,var(--text-lg))]";

const INTERFACE = "[font-size:var(--text-base)]";

/** Each class is spelt out because Tailwind finds a class by reading the source. */
const LAYOUT =
  "grid grid-cols-[minmax(0,544px)] @min-[880px]:grid-cols-[minmax(0,544px)_352px] @min-[880px]:grid-rows-[auto_auto_1fr] @min-[880px]:gap-x-12 @min-[1056px]:gap-x-16";

const WAY_BACK = "order-1 mb-2 @min-[880px]:col-start-1 @min-[880px]:row-start-1";

const HEAD = "order-2 mb-6 @min-[880px]:col-start-1 @min-[880px]:row-start-2";

const TITLE_BLOCK =
  "order-3 mb-6 @min-[880px]:col-start-2 @min-[880px]:row-span-2 @min-[880px]:row-start-2 @min-[880px]:mb-0 @min-[880px]:self-start";

const BODY = "order-4 @min-[880px]:col-start-1 @min-[880px]:row-start-3";

const useReadingKeys = (wayBack: ReturnType<typeof useWayBack>, copy: () => void) => {
  const sources = useRef<HTMLHeadingElement>(null);
  const links = useRef<HTMLHeadingElement>(null);
  const listed = useMemo(() => listedWithWayBackTo(wayBack.name), [wayBack.name]);
  usePageKeystrokes(listed);
  useKeystroke(wayBackKeystroke(wayBack.name), wayBack.go);
  const goToSources = () => {
    sources.current?.focus();
  };
  useKeystroke(KEY.sources, goToSources);
  useKeystroke(KEY.links, () => {
    links.current?.focus();
  });
  useKeystroke(KEY.copy, copy);
  return { sources, links, goToSources };
};

const useOpening = (concept: Concept) => {
  const beside = useRoomBeside();
  const [opened, setOpened] = useState<Opened>();
  const close = () => {
    setOpened(undefined);
  };
  const opening: MarkOpening = {
    openerId: opened?.openerId,
    onOpen: ({ openerId, source }) => {
      const item = concept.evidence[source];
      const opens = openingOf(item);
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
  return { opening, close, sheet: opened !== undefined && beside ? opened : undefined };
};

function Citations(properties: {
  readonly concept: Concept;
  readonly opening: MarkOpening;
  readonly sources: Heading;
  readonly links: Heading;
}) {
  const { concept, opening, sources, links } = properties;
  return (
    <div className={INTERFACE}>
      {concept.evidence.length === 0 ? null : (
        <Sources concept={concept} opening={opening} heading={sources} />
      )}
      {concept.relations.length === 0 ? null : <Links concept={concept} heading={links} />}
    </div>
  );
}

function ConceptShown(properties: {
  readonly iri: string;
  readonly concept: Concept;
  readonly heading: Heading;
  readonly standing: "commits" | "suggests" | undefined;
}) {
  const { iri, concept, heading } = properties;
  const title = titleOf(concept.frontmatter);
  useBreadcrumbLastPart(title);
  const editing = useConceptEditing({
    target: { kind: "concept", iri },
    standing: properties.standing,
  });
  const copying = useCopy(concept.body);
  const keys = useReadingKeys(useWayBack(iri), copying.copy);
  const { opening, close, sheet } = useOpening(concept);

  return (
    <div className={cn("@container mt-6", sheet !== undefined && "pr-[var(--container-md)]")}>
      <article aria-label={title} data-grid-mask="reading" className={LAYOUT}>
        <p className={WAY_BACK}>
          <WayBack iri={iri} quiet />
        </p>
        <header className={cn(HEAD, INTERFACE)}>
          <Header concept={concept} heading={heading} actions={editing.actions} copying={copying} />
          {editing.editor}
        </header>
        <div className={BODY}>
          <div className={COLUMN}>
            <ConceptBody
              body={concept.body}
              evidence={concept.evidence}
              bodyLinks={concept.bodyLinks}
              opening={opening}
            />
          </div>
          <Citations
            concept={concept}
            opening={opening}
            sources={keys.sources}
            links={keys.links}
          />
        </div>
        <TitleBlock
          concept={concept}
          onGoToSources={keys.goToSources}
          className={cn(TITLE_BLOCK, INTERFACE)}
        />
        {sheet === undefined ? null : <EvidenceSheet opened={sheet} onClose={close} />}
      </article>
    </div>
  );
}

function ConceptUnread(properties: {
  readonly concept: ReturnType<typeof useConcept>;
  readonly heading: Heading;
}) {
  const { concept } = properties;
  if (concept.error === null) return <RecordLoading words={WORDS.loading} />;
  if (namesNothing(concept.error)) return <NoSuchConcept />;
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

function ConceptRead(properties: {
  readonly iri: string;
  readonly heading: Heading;
  readonly unreadTitle: string;
}) {
  const { iri, heading } = properties;
  const concept = useConcept(iri);
  const shown = concept.error === null ? concept.data?.concept : undefined;

  if (shown !== undefined) {
    return (
      <ConceptShown iri={iri} concept={shown} heading={heading} standing={concept.data?.standing} />
    );
  }
  return (
    <>
      <PageHead title={properties.unreadTitle} headingRef={heading} />
      <ConceptUnread concept={concept} heading={heading} />
    </>
  );
}

export function ConceptPage(properties: { readonly iri: string | undefined }) {
  const { iri } = properties;
  const heading = useRef<HTMLHeadingElement>(null);
  const unreadTitle = wayBackOf(useOpenedFrom()).page.name;

  return iri === undefined ? (
    <>
      <PageHead title={unreadTitle} headingRef={heading} />
      <NoSuchConcept />
    </>
  ) : (
    <ConceptRead key={iri} iri={iri} heading={heading} unreadTitle={unreadTitle} />
  );
}
