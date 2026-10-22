import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useId, useRef, useState, type RefObject } from "react";

import { RowLink } from "@/shared/grid-table.tsx";
import { useKeystroke, usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { useLandingLine } from "@/shared/landing.ts";
import { ListRead, ListState } from "@/shared/list-pages.tsx";
import { useRole } from "@/shared/member.ts";
import { detailAt, headingOf } from "@/shared/navigation.ts";
import { OutcomeLine, selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { ListHead, PageHead } from "@/shared/page-head.tsx";
import { keyedRow, onTheRowInFocus, rowInFocus, type Saying } from "@/shared/row-focus.ts";
import { SelectionBar } from "@/shared/selection-bar.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Checkbox } from "@/shared/ui/checkbox.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { NONE, outcomeOfFailure, ReuseConfirm, useAccepting, type Ticked } from "./accepting.tsx";
import { useWaiting, type WaitingItem } from "./inbox-api.ts";
import {
  DECIDED_ON_ITS_PAGE,
  RETURNED_TO,
  shortcutOf,
  WAITING_KEYSTROKES as KEY,
  WAITING_ON_YOU,
} from "./inbox-state.ts";
import { WAITING_WORDS as WORDS } from "./inbox-words.ts";
import { WaitingFacts } from "./waiting-facts.tsx";

const LISTED = Object.values(KEY);

const NO_ITEMS: readonly WaitingItem[] = [];

const NOTHING_IN_FOCUS = selectFirst(WORDS.selectFirst);

const keyOf = (item: WaitingItem): string => item.suggestionId;

const useReturning = () => {
  const returned = useRouterState({
    select: (state) => RETURNED_TO.safeParse(state.location.state).data?.openedSuggestion,
  });
  const [landed, setLanded] = useState(false);
  return {
    at: landed ? undefined : returned,
    landed: () => {
      setLanded(true);
    },
  };
};

type Returning = ReturnType<typeof useReturning>;

const useOpen = () => {
  const navigate = useNavigate();
  const router = useRouter();
  return (item: WaitingItem) => {
    void navigate({
      to: ".",
      replace: true,
      state: (held) => ({ ...held, decided: undefined, openedSuggestion: item.suggestionId }),
    });
    // TanStack history merges a replace and a push queued in one microtask into one push.
    router.history.flush();
    void navigate({
      href: detailAt(WAITING_ON_YOU, item.suggestionId),
      state: (held) => ({ ...held, openedSuggestion: undefined }),
    });
  };
};

const useDecidedOnItsPage = (
  say: (outcome: Outcome) => void,
  heading: RefObject<HTMLElement | null>,
) => {
  const decided = useRouterState({
    select: (state) => DECIDED_ON_ITS_PAGE.safeParse(state.location.state).data?.decided,
  });
  const arrived = useEffectEvent(() => {
    if (decided === undefined) return;
    say({ tone: decided.refused ? "refused" : "said", words: decided.said });
    heading.current?.focus();
  });
  const key = decided === undefined ? undefined : `${decided.suggestionId} ${decided.said}`;
  useEffect(() => {
    if (key !== undefined) arrived();
  }, [key]);
};

function WaitingRow(properties: {
  readonly item: WaitingItem;
  readonly ownerShown: boolean;
  readonly ticked: boolean;
  readonly onTick: (ticked: boolean) => void;
  readonly onOpen: () => void;
  readonly returning: Returning;
}) {
  const { item, returning } = properties;
  const headingId = useId();
  const tickId = useId();
  const land = useLandingLine(returning.at === item.suggestionId, returning.landed);

  return (
    <li
      aria-labelledby={headingId}
      {...keyedRow(item.suggestionId)}
      className="flex gap-3 border-t border-border px-4 py-4 first:border-t-0"
    >
      <div className="pt-1">
        <Checkbox
          id={tickId}
          checked={properties.ticked}
          onCheckedChange={(checked) => {
            properties.onTick(checked === true);
          }}
        />
        <Label htmlFor={tickId} className="sr-only">
          {WORDS.select(item.title)}
        </Label>
      </div>
      <div className="min-w-0 flex-1">
        <h3 id={headingId}>
          <RowLink
            ref={land}
            href={detailAt(WAITING_ON_YOU, item.suggestionId)}
            onOpen={properties.onOpen}
          >
            {item.title}
          </RowLink>
        </h3>
        <WaitingFacts item={item} ownerShown={properties.ownerShown} />
        <p className="mt-2 text-muted-foreground">{WORDS.next}</p>
      </div>
    </li>
  );
}

function WaitingList(properties: {
  readonly items: readonly WaitingItem[];
  readonly ticked: Ticked;
  readonly onTicked: (ticked: Ticked) => void;
  readonly returning: Returning;
}) {
  const { items, ticked, onTicked } = properties;
  const ownerShown = useRole() === "Admin";
  const open = useOpen();
  if (items.length === 0) {
    return <ListState state={{ kind: "empty", words: WORDS.none, action: null }} />;
  }

  return (
    <ul>
      {items.map((item) => (
        <WaitingRow
          key={item.suggestionId}
          item={item}
          ownerShown={ownerShown}
          ticked={ticked.has(item.suggestionId)}
          onTick={(tick) => {
            const next = new Set(ticked);
            if (tick) next.add(item.suggestionId);
            else next.delete(item.suggestionId);
            onTicked(next);
          }}
          onOpen={() => {
            open(item);
          }}
          returning={properties.returning}
        />
      ))}
    </ul>
  );
}

function RowKeys(properties: {
  readonly items: readonly WaitingItem[];
  readonly ticked: Ticked;
  readonly onTicked: (ticked: Ticked) => void;
  readonly say: Saying;
}) {
  const { items, ticked, onTicked } = properties;
  const open = useOpen();
  const acting = onTheRowInFocus(() => rowInFocus(items, keyOf), properties.say, NOTHING_IN_FOCUS);
  useKeystroke(KEY.open, acting(open));
  useKeystroke(
    KEY.tick,
    acting((item) => {
      const next = new Set(ticked);
      if (!next.delete(item.suggestionId)) next.add(item.suggestionId);
      onTicked(next);
    }),
  );
  return null;
}

function WaitingRegion() {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const read = useWaiting();
  const items = read.data?.items ?? NO_ITEMS;
  const [ticked, setTicked] = useState<Ticked>(NONE);
  const [outcome, say] = useState<Outcome>();
  const returning = useReturning();
  const accepting = useAccepting({ items, ticked, tick: setTicked, heading, say });
  useDecidedOnItsPage(say, heading);
  usePageKeystrokes(LISTED);

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <ListHead
        heading={WAITING_ON_YOU.name}
        headingId={headingId}
        headingRef={heading}
        count={read.data === undefined ? "" : WORDS.count(items.length)}
        action={
          items.length === 0 ? undefined : (
            <Button
              aria-keyshortcuts={shortcutOf(KEY.acceptSelected)}
              aria-disabled={accepting.acting}
              className="aria-disabled:opacity-50"
              onClick={accepting.acceptTicked}
            >
              {WORDS.acceptSelected}
            </Button>
          )
        }
      />
      <OutcomeLine outcome={outcome} className="mt-2" />
      {accepting.confirming === 0 ? null : (
        <ReuseConfirm
          said={WORDS.reuse(accepting.confirming)}
          onConfirm={accepting.confirm}
          onCancel={accepting.cancel}
        />
      )}
      <Card marks className="mt-4">
        <ListRead
          read={read}
          loading={WORDS.loading}
          failed={(failure) => outcomeOfFailure(failure, "read").words}
          focusAfterRetry={heading}
        >
          <SelectionBar
            label={WORDS.selected}
            ticked={ticked}
            shown={items.map(keyOf)}
            noun={["suggestion", "suggestions"]}
            clearKeystroke={KEY.clearSelection}
            onClear={() => {
              setTicked(NONE);
            }}
            focusAfterClear={heading}
          />
          <RowKeys items={items} ticked={ticked} onTicked={setTicked} say={say} />
          <WaitingList items={items} ticked={ticked} onTicked={setTicked} returning={returning} />
        </ListRead>
      </Card>
    </section>
  );
}

export function WaitingOnYouPage() {
  return (
    <>
      <PageHead heading={headingOf(WAITING_ON_YOU)} summary={WORDS.about} />
      <WaitingRegion />
    </>
  );
}
