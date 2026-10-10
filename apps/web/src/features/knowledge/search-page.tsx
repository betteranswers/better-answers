import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useId, useMemo, useRef, useState, type RefObject } from "react";

import { useAsked } from "@/shared/address-ask.ts";
import { FilterRow } from "@/shared/filter-row.tsx";
import { RowLink } from "@/shared/grid-table.tsx";
import { usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { useLanding, useLandingLine, type Landing } from "@/shared/landing.ts";
import { cn } from "@/shared/lib/utils.ts";
import { ListPages, ListState } from "@/shared/list-pages.tsx";
import { useSearchedList } from "@/shared/searched-list.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { useRoomBeside } from "@/shared/wide-layout.ts";

import {
  BROWSE,
  conceptMatchKey,
  conceptPageOf,
  RETURNED_TO,
  SEARCH_PAGE,
} from "./concept-address.ts";
import { EvidenceInline, EvidenceSheet, SensitivityTag, type Opened } from "./evidence-panel.tsx";
import {
  asksNothing,
  useMatches,
  type ConceptMatch,
  type Match,
  type Matches,
  type PassageMatch,
} from "./knowledge-api.ts";
import {
  QUERY_MAX,
  SEARCH_FIELDS,
  SEARCH_KEYSTROKES as KEY,
  SEARCH_LIST,
} from "./knowledge-state.ts";
import { SEARCH_WORDS as WORDS } from "./knowledge-words.ts";
import { failedReadWords } from "./refusal.tsx";

const LISTED = Object.values(KEY);

const keyOf = (match: Match): string =>
  match.layer === "bundles" ? conceptMatchKey(match.iri) : `sources:${match.locator}`;

/** A concept rewritten between pages can come back on the next, so a repeat is dropped. */
const matchesOf = (data: Matches["data"]): readonly Match[] => {
  const seen = new Set<string>();
  return (data?.pages ?? [])
    .flatMap((page) => page.matches)
    .filter((match) => {
      const key = keyOf(match);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

/** Every state is said here, a region that stays mounted, and never with a count. */
const saidOf = (query: string, matches: Matches, shown: number): string => {
  if (asksNothing(query)) return WORDS.nothingAsked;
  if (matches.isPending) return WORDS.searching(query);
  if (matches.data === undefined) return "";
  return shown === 0 ? WORDS.noMatches(query) : WORDS.matched(query, matches.hasNextPage);
};

/** Takes a line of its own where the kind beside it leaves too little room. */
const TITLE = "min-w-0 grow basis-48 font-medium break-words";

/** The match whose page the reader opened and came back from, where focus goes once. */
type Returning = { readonly key: string | undefined; readonly landed: () => void };

type Reading = {
  readonly returning: Returning;
  readonly onRead: (match: ConceptMatch, page: string) => void;
};

function ConceptLine(properties: { readonly match: ConceptMatch; readonly reading: Reading }) {
  const { match, reading } = properties;
  const page = conceptPageOf(match.iri);
  const land = useLandingLine(keyOf(match) === reading.returning.key, reading.returning.landed);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <Pill>{match.kind}</Pill>
      {page === undefined ? (
        <span className={TITLE}>{match.title}</span>
      ) : (
        <RowLink
          ref={land}
          href={page}
          className={TITLE}
          onOpen={() => {
            reading.onRead(match, page);
          }}
        >
          {match.title}
        </RowLink>
      )}
      <Pill>{match.trustWords}</Pill>
    </div>
  );
}

type Opening = {
  readonly opened: Opened | undefined;
  readonly beside: boolean;
  readonly onOpen: (chosen: Omit<Opened, "pressed">) => void;
  readonly onClose: () => void;
};

function PassageLine(properties: { readonly match: PassageMatch; readonly opening: Opening }) {
  const { match, opening } = properties;
  const openerId = useId();
  const key = keyOf(match);
  const opened = opening.opened?.key === key ? opening.opened : undefined;
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Pill>{WORDS.document}</Pill>
        <Button
          id={openerId}
          variant="link"
          aria-expanded={opened !== undefined}
          className={`h-auto justify-start px-0 text-left whitespace-normal ${TITLE}`}
          onClick={() => {
            opening.onOpen({
              key,
              openerId,
              title: match.title,
              source: {
                kind: "passage",
                locator: match.locator,
                unmapped: { sensitivity: match.sensitivity },
              },
            });
          }}
        >
          {match.title}
        </Button>
        <SensitivityTag sensitivity={match.sensitivity} />
      </div>
      {opened === undefined || opening.beside ? null : (
        <EvidenceInline opened={opened} onClose={opening.onClose} />
      )}
    </>
  );
}

function MatchLine(properties: {
  readonly match: Match;
  readonly landsHere: boolean;
  readonly onLanded: () => void;
  readonly opening: Opening;
  readonly reading: Reading;
}) {
  const { match } = properties;
  const land = useLandingLine(properties.landsHere, properties.onLanded);
  return (
    <li ref={land} tabIndex={-1} className="px-4 py-3">
      {match.layer === "bundles" ? (
        <ConceptLine match={match} reading={properties.reading} />
      ) : (
        <PassageLine match={match} opening={properties.opening} />
      )}
    </li>
  );
}

function MatchList(properties: {
  readonly shown: readonly Match[];
  readonly landing: Landing;
  readonly opening: Opening;
  readonly reading: Reading;
}) {
  const { shown, landing } = properties;
  return (
    <ol aria-label={WORDS.matches} className="divide-y divide-border border-t border-border">
      {shown.map((match, index) => (
        <MatchLine
          key={keyOf(match)}
          match={match}
          landsHere={index === landing.landAt}
          onLanded={landing.landed}
          opening={properties.opening}
          reading={properties.reading}
        />
      ))}
    </ol>
  );
}

function Results(properties: {
  readonly query: string;
  readonly matches: Matches;
  readonly shown: readonly Match[];
  readonly opening: Opening;
  readonly reading: Reading;
  readonly searchRef: RefObject<HTMLInputElement | null>;
}) {
  const { query, matches, shown } = properties;
  const landing = useLanding();

  if (asksNothing(query) || matches.isPending) return null;
  if (matches.data === undefined) {
    return (
      <ListState
        state={{
          kind: "failed",
          words: failedReadWords(matches.error),
          onRetry: () => {
            void matches.refetch();
          },
          focusAfterRetry: properties.searchRef,
        }}
      />
    );
  }
  if (shown.length === 0) return null;

  const showMore = () => {
    landing.landOn(shown.length);
    void matches.fetchNextPage();
  };
  return (
    <>
      <MatchList
        shown={shown}
        landing={landing}
        opening={properties.opening}
        reading={properties.reading}
      />
      <ListPages
        pages={{
          kind: "more",
          label: WORDS.more,
          more: matches.hasNextPage,
          loading: matches.isFetchingNextPage,
          failed: matches.isFetchNextPageError ? failedReadWords(matches.error) : undefined,
          onMore: showMore,
          keystroke: KEY.more,
        }}
      />
    </>
  );
}

/** Search's history entry keeps the match opened, for Back; the concept's keeps the query left. */
const useReading = (query: string): Reading => {
  const router = useRouter();
  const navigate = useNavigate();
  const returned = useRouterState({
    select: (state) => RETURNED_TO.safeParse(state.location.state).data?.openedMatch,
  });
  // Taken as the page opens: marking the entry on the way out must move no focus.
  const [returning, setReturning] = useState({ key: returned, query });
  // A match the search returned to never drew is not waited for under the next one.
  if (returning.key !== undefined && returning.query !== query) {
    setReturning({ key: undefined, query });
  }

  return {
    returning: {
      key: returning.key,
      landed: () => {
        setReturning({ key: undefined, query });
      },
    },
    onRead: (match, page) => {
      const searchQuery = router.latestLocation.searchStr;
      void navigate({
        to: ".",
        search: true,
        replace: true,
        state: (held) => ({ ...held, openedMatch: keyOf(match) }),
      });
      // The browser's history folds a replace and a push in one task into one push.
      router.history.flush();
      void navigate({
        href: page,
        state: (held) => ({ ...held, openedMatch: undefined, searchQuery }),
      });
    },
  };
};

function SearchRegion() {
  const headingId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const { state, search, setSearch } = useSearchedList(SEARCH_LIST, SEARCH_FIELDS);
  useAsked("search", (asked) => {
    setSearch(asked.slice(0, QUERY_MAX));
  });
  const query = state.search;
  const matches = useMatches(query);
  const shown = useMemo(() => matchesOf(matches.data), [matches.data]);
  const beside = useRoomBeside();
  const reading = useReading(query);
  const [opened, setOpened] = useState<Opened & { readonly query: string }>();
  // A passage opened for one search closes with it, as its match leaves the list.
  if (opened !== undefined && opened.query !== query) setOpened(undefined);
  const close = () => {
    setOpened(undefined);
  };
  const opening: Opening = {
    opened,
    beside,
    onOpen: (chosen) => {
      setOpened((current) => ({ ...chosen, query, pressed: (current?.pressed ?? 0) + 1 }));
    },
    onClose: close,
  };

  return (
    <section
      aria-labelledby={headingId}
      // Room for the panel beside the list, so it covers none of the matches.
      className={cn("mt-6", opened !== undefined && beside && "pr-[var(--container-md)]")}
    >
      <h2 id={headingId}>{SEARCH_PAGE.name}</h2>
      <Card marks className="mt-4">
        <FilterRow
          search={{
            label: WORDS.search,
            maxLength: QUERY_MAX,
            value: search,
            onChange: setSearch,
            keystroke: KEY.search,
            inputRef: searchRef,
          }}
        />
        <output className="block px-4 py-3 text-muted-foreground empty:hidden">
          {saidOf(query, matches, shown.length)}
        </output>
        {/* Keyed, so a page landing late for the last search never reaches this one's list. */}
        <Results
          key={query}
          query={query}
          matches={matches}
          shown={shown}
          opening={opening}
          reading={reading}
          searchRef={searchRef}
        />
      </Card>
      {opened === undefined || !beside ? null : <EvidenceSheet opened={opened} onClose={close} />}
    </section>
  );
}

export function SearchPage() {
  usePageKeystrokes(LISTED);

  return (
    <>
      <h1>{BROWSE.name}</h1>
      <p className="mt-2 text-muted-foreground">{BROWSE.summary}</p>
      <SearchRegion />
    </>
  );
}
