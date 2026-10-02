import { useCallback, useMemo, useState, type RefObject } from "react";

import { ListPages, ListState } from "@/shared/list-pages.tsx";
import { OutcomeLine } from "@/shared/outcome.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { timeWords, weekdayWords } from "@/shared/words.ts";

import { sentenceOf } from "./audit-sentences.ts";
import { ACTIVITY_WORDS as WORDS } from "./member-act-words.ts";
import { useActivity, type ActivityEvent, type ListedMember } from "./people-api.ts";
import { MEMBER_PAGE_KEYSTROKES as KEY } from "./people-state.ts";
import { outcomeOfFailure } from "./refusal.tsx";
import { nameOf } from "./words.tsx";

type Activity = ReturnType<typeof useActivity>;

/** Newest first, so a day's lines already stand together, each keeping its place in the stream. */
const daysOf = (events: readonly ActivityEvent[]) =>
  Map.groupBy(events.entries(), ([, event]) => weekdayWords(event.at));

function Line(properties: {
  readonly event: ActivityEvent;
  readonly name: string;
  readonly landsHere: boolean;
  readonly onLanded: () => void;
}) {
  const { event, name, landsHere, onLanded } = properties;
  // Taken as the line mounts, so focus waits for the page of older lines that brings it.
  const land = useCallback(
    (line: HTMLLIElement | null) => {
      if (line === null || !landsHere) return;
      line.focus();
      onLanded();
    },
    [landsHere, onLanded],
  );

  return (
    <li ref={land} tabIndex={-1} className="flex items-baseline gap-x-3 px-4 py-2">
      <time dateTime={event.at} className="shrink-0 text-muted-foreground tabular-nums">
        {timeWords(event.at)}
      </time>
      {/* The marker wraps below a sentence too long to share its line, rather than squeeze it. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 wrap-anywhere">{sentenceOf(event)}</span>
        <Pill>{WORDS.direction[event.direction](name)}</Pill>
      </div>
    </li>
  );
}

/** Load more puts focus on the first line it brings, where reading resumes. */
function Stream(properties: { readonly activity: Activity; readonly name: string }) {
  const { activity, name } = properties;
  const [landAt, setLandAt] = useState<number>();
  const landed = useCallback(() => {
    setLandAt(undefined);
  }, []);
  const events = useMemo(
    () => activity.data?.pages.flatMap((page) => page.events) ?? [],
    [activity.data],
  );
  const days = useMemo(() => [...daysOf(events)], [events]);

  if (events.length === 0) {
    return <ListState state={{ kind: "empty", words: WORDS.none(name), act: undefined }} />;
  }

  const showOlder = () => {
    setLandAt(events.length);
    void activity.fetchNextPage();
  };

  return (
    <div className="border border-border">
      <div className="divide-y divide-border">
        {days.map(([day, lines]) => (
          <div key={day}>
            <h3 className="max-w-none border-b border-border bg-muted px-4 py-2 font-medium">
              {day}
            </h3>
            <ol className="divide-y divide-border">
              {lines.map(([index, event]) => (
                <Line
                  key={event.id}
                  event={event}
                  name={name}
                  landsHere={index === landAt}
                  onLanded={landed}
                />
              ))}
            </ol>
          </div>
        ))}
      </div>
      {/* The lines read so far stay; Load more is the way to ask again. */}
      <OutcomeLine
        outcome={activity.error === null ? undefined : outcomeOfFailure(activity.error, "read")}
        className="px-4 has-[[role=alert]:not(:empty)]:py-2"
      />
      <ListPages
        pages={{
          kind: "more",
          label: WORDS.older,
          more: activity.hasNextPage,
          loading: activity.isFetchingNextPage,
          onMore: showOlder,
          keystroke: KEY.olderActivity,
        }}
      />
    </div>
  );
}

/** An empty stream has nowhere to say a later read failed, so a failure stands in for it. */
const streamStands = (activity: Activity): boolean =>
  activity.error === null || activity.data?.pages.some((page) => page.events.length > 0) === true;

/** The acts the member took and the acts done to them, in one stream, read a page at a time. */
export function MemberActivity(properties: {
  readonly member: ListedMember;
  readonly heading: RefObject<HTMLHeadingElement | null>;
}) {
  const { member, heading } = properties;
  const activity = useActivity(member.personId);

  if (activity.data !== undefined && streamStands(activity)) {
    return <Stream activity={activity} name={nameOf(member)} />;
  }
  if (activity.error === null)
    return <ListState state={{ kind: "loading", words: WORDS.loading }} />;
  return (
    <ListState
      state={{
        kind: "failed",
        words: outcomeOfFailure(activity.error, "read").words,
        onRetry: () => {
          void activity.refetch();
        },
        focusAfterRetry: heading,
      }}
    />
  );
}
