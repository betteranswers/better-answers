import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { useAsked } from "@/shared/address-ask.ts";
import { FilterRow } from "@/shared/filter-row.tsx";
import { RowLink } from "@/shared/grid-table.tsx";
import { useKeystroke, usePageKeystrokes } from "@/shared/keystrokes.tsx";
import {
  BROWSE,
  conceptMatchKey,
  conceptPageOf,
  RETURNED_TO,
  SEARCH_PAGE,
} from "@/shared/knowledge/concept-address.ts";
import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";
import {
  EvidenceInline,
  EvidenceSheet,
  SensitivityTag,
  type Heading,
  type Opened,
} from "@/shared/knowledge/evidence-panel.tsx";
import { failedReadWords } from "@/shared/knowledge/refusal.tsx";
import { useLanding, useLandingLine, type Landing } from "@/shared/landing.ts";
import { cn } from "@/shared/lib/utils.ts";
import { ListPages, ListState } from "@/shared/list-pages.tsx";
import { PageHead } from "@/shared/page-head.tsx";
import { keyedRow, rowInFocus } from "@/shared/row-focus.ts";
import { useSearchedList } from "@/shared/searched-list.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { useRoomBeside } from "@/shared/wide-layout.ts";

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

const LISTED = Object.values(KEY);

const keyOf = (match: Match): string =>
  match.layer === "bundles" ? conceptMatchKey(match.iri) : `sources:${match.locator}`;

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

type Searched = "nothing-asked" | "searching" | "failed" | "listed";

const searchedOf = (query: string, matches: Matches): Searched => {
  if (asksNothing(query)) return "nothing-asked";
  if (matches.data !== undefined) return "listed";
  return matches.isPending ? "searching" : "failed";
};

const saidOf = (searched: Searched, query: string, more: boolean, shown: number): string => {
  if (searched === "nothing-asked") return WORDS.nothingAsked;
  if (searched === "searching") return WORDS.searching(query);
  if (searched === "failed") return "";
  return shown === 0 ? WORDS.noMatches(query) : WORDS.matched(query, more);
};

type OpenedFor = Opened & { readonly query: string; readonly waited: boolean };

const unlistedYet = (searched: Searched): boolean =>
  searched === "searching" || searched === "failed";

const stillListed = (
  opened: OpenedFor,
  query: string,
  shown: readonly Match[],
  searched: Searched,
): boolean =>
  opened.query === query &&
  (unlistedYet(searched) || shown.some((match) => keyOf(match) === opened.key));

type OpenedChange = { readonly opened: OpenedFor | undefined; readonly left: boolean };

const changeOf = (
  opened: OpenedFor,
  query: string,
  shown: readonly Match[],
  searched: Searched,
): OpenedChange | undefined => {
  if (!stillListed(opened, query, shown, searched)) {
    return { opened: undefined, left: opened.query === query };
  }
  if (opened.waited || !unlistedYet(searched)) return undefined;
  return { opened: { ...opened, waited: true }, left: false };
};

const openerIdOf = (key: string): string => `opener-${encodeURIComponent(key)}`;

const chosenOf = (match: PassageMatch): Omit<Opened, "pressed"> => {
  const key = keyOf(match);
  return {
    key,
    openerId: openerIdOf(key),
    title: match.title,
    source: { kind: "passage", locator: match.locator, unmapped: true },
  };
};

const TITLE = "min-w-0 grow basis-48 font-medium break-words";

type Returning = { readonly key: string | undefined; readonly landed: () => void };

type Reading = {
  readonly returning: Returning;
  readonly onRead: (match: ConceptMatch, page: string) => void;
};

function ConceptLine(properties: {
  readonly match: ConceptMatch;
  readonly opening: Opening;
  readonly reading: Reading;
}) {
  const { match, opening, reading } = properties;
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
            opening.open(match);
          }}
        >
          {match.title}
        </RowLink>
      )}
      <Pill>{match.collection ?? CONCEPT_WORDS.noCollection}</Pill>
      <Pill>{match.trustWords}</Pill>
    </div>
  );
}

type Opening = {
  readonly opened: Opened | undefined;
  readonly beside: boolean;
  readonly focusFromBodyOr: Heading | undefined;
  readonly open: (match: Match) => void;
  readonly onClose: () => void;
};

function PassageLine(properties: { readonly match: PassageMatch; readonly opening: Opening }) {
  const { match, opening } = properties;
  const key = keyOf(match);
  const opened = opening.opened?.key === key ? opening.opened : undefined;
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Pill>{WORDS.document}</Pill>
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

function MatchLine(properties: {
  readonly match: Match;
  readonly landsHere: boolean;
  readonly onLanded: () => void;
  readonly onDroppedInFocus: () => void;
  readonly opening: Opening;
  readonly reading: Reading;
}) {
  const { match, onDroppedInFocus } = properties;
  const land = useLandingLine(properties.landsHere, properties.onLanded);
  const key = keyOf(match);
  useLayoutEffect(
    () => () => {
      if (rowInFocus([key], (held) => held) !== undefined) onDroppedInFocus();
    },
    [key, onDroppedInFocus],
  );
  return (
    <li ref={land} tabIndex={-1} className="px-4 py-3" {...keyedRow(key)}>
      {match.layer === "bundles" ? (
        <ConceptLine match={match} opening={properties.opening} reading={properties.reading} />
      ) : (
        <PassageLine match={match} opening={properties.opening} />
      )}
    </li>
  );
}

function MatchList(properties: {
  readonly shown: readonly Match[];
  readonly landing: Landing;
  readonly onDroppedInFocus: () => void;
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
          onDroppedInFocus={properties.onDroppedInFocus}
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
  readonly onDroppedInFocus: () => void;
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
        onDroppedInFocus={properties.onDroppedInFocus}
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

const useReading = (query: string): Reading => {
  const router = useRouter();
  const navigate = useNavigate();
  const returned = useRouterState({
    select: (state) => RETURNED_TO.safeParse(state.location.state).data?.openedMatch,
  });
  const [returning, setReturning] = useState({ key: returned, query });
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

const focusIfLost = (heading: RefObject<HTMLElement | null>): void => {
  if (document.activeElement === document.body) heading.current?.focus();
};

const focusFromBodyOr = (opened: OpenedFor | undefined, heading: Heading): Heading | undefined =>
  opened?.waited === true ? heading : undefined;

const useOpening = (
  query: string,
  shown: readonly Match[],
  searched: Searched,
  heading: Heading,
) => {
  const [opened, setOpened] = useState<OpenedFor>();
  const [leftIn, setLeftIn] = useState<string>();
  const change = opened === undefined ? undefined : changeOf(opened, query, shown, searched);
  if (change !== undefined) {
    setOpened(change.opened);
    if (change.left) setLeftIn(query);
  }
  const left = leftIn === query;
  if (leftIn !== undefined && !left) setLeftIn(undefined);
  const listFailed = opened !== undefined && searched === "failed";

  useEffect(() => {
    if (left || listFailed) focusIfLost(heading);
  }, [left, listFailed, heading]);

  return {
    opened,
    focusFromBodyOr: focusFromBodyOr(opened, heading),
    unlisted: left && searched !== "nothing-asked",
    onOpen: (chosen: Omit<Opened, "pressed">, typed: string) => {
      setLeftIn(undefined);
      setOpened((current) => ({
        ...chosen,
        query: typed,
        waited: false,
        pressed: (current?.pressed ?? 0) + 1,
      }));
    },
    onClose: () => {
      setOpened(undefined);
    },
  };
};

const useReturnedUnlisted = (
  returningKey: string | undefined,
  shown: readonly Match[],
  loading: boolean,
  heading: RefObject<HTMLElement | null>,
) => {
  const unlisted =
    returningKey !== undefined && !loading && !shown.some((match) => keyOf(match) === returningKey);

  useEffect(() => {
    if (unlisted) focusIfLost(heading);
  }, [unlisted, heading]);
};

const useDroppedInFocus = (heading: RefObject<HTMLElement | null>) => {
  const dropped = useRef(false);

  useEffect(() => {
    if (!dropped.current) return;
    dropped.current = false;
    focusIfLost(heading);
  });

  return useCallback(() => {
    dropped.current = true;
  }, []);
};

const useOpenKey = (query: string, shown: readonly Match[], open: (match: Match) => void) => {
  const [unopenedIn, setUnopenedIn] = useState<string>();
  if (unopenedIn !== undefined && unopenedIn !== query) setUnopenedIn(undefined);
  const opening = (match: Match) => {
    setUnopenedIn(undefined);
    open(match);
  };

  useKeystroke(KEY.open, () => {
    const match = rowInFocus(shown, keyOf);
    if (match === undefined) setUnopenedIn(query);
    else opening(match);
  });

  return { unopened: unopenedIn === query, open: opening };
};

function SearchRegion() {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { state, search, setSearch, flush } = useSearchedList(SEARCH_LIST, SEARCH_FIELDS);
  useAsked("search", (asked) => {
    setSearch(asked.slice(0, QUERY_MAX));
  });
  const query = state.search;
  const matches = useMatches(query);
  const shown = useMemo(() => matchesOf(matches.data), [matches.data]);
  const beside = useRoomBeside();
  const reading = useReading(query);
  const searched = searchedOf(query, matches);
  const panel = useOpening(query, shown, searched, heading);
  useReturnedUnlisted(reading.returning.key, shown, matches.isLoading, heading);
  const onDroppedInFocus = useDroppedInFocus(heading);
  const open = (match: Match) => {
    flush();
    if (match.layer !== "bundles") {
      panel.onOpen(chosenOf(match), search);
      return;
    }
    const page = conceptPageOf(match.iri);
    if (page !== undefined) reading.onRead(match, page);
  };
  const openKey = useOpenKey(query, shown, open);
  const opening: Opening = {
    opened: panel.opened,
    beside,
    focusFromBodyOr: panel.focusFromBodyOr,
    open: openKey.open,
    onClose: panel.onClose,
  };

  return (
    <section
      aria-labelledby={headingId}
      className={cn("mt-6", panel.opened !== undefined && beside && "pr-[var(--container-md)]")}
    >
      <h2 ref={heading} id={headingId} tabIndex={-1}>
        {SEARCH_PAGE.name}
      </h2>
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
          {saidOf(searched, query, matches.hasNextPage, shown.length)}
          {panel.unlisted ? ` ${WORDS.passageLeft}` : null}
          {openKey.unopened ? ` ${WORDS.selectFirst}` : null}
        </output>
        <Results
          key={query}
          query={query}
          matches={matches}
          shown={shown}
          opening={opening}
          reading={reading}
          searchRef={searchRef}
          onDroppedInFocus={onDroppedInFocus}
        />
      </Card>
      {panel.opened === undefined || !beside ? null : (
        <EvidenceSheet opened={panel.opened} onClose={panel.onClose} focusFallback={heading} />
      )}
    </section>
  );
}

export function SearchPage() {
  usePageKeystrokes(LISTED);

  return (
    <>
      <PageHead heading={BROWSE.name} summary={BROWSE.summary} />
      <SearchRegion />
    </>
  );
}
