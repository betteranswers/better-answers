import { useMemo, type RefObject } from "react";

import { ListPages, ListState } from "@/shared/list-pages.tsx";
import { OutcomeLine } from "@/shared/outcome.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { sentenceOf } from "./audit-sentences.ts";
import { EventDays, useLanding } from "./event-days.tsx";
import { ACTIVITY_WORDS as WORDS } from "./member-action-words.ts";
import { useActivity, type ActivityEvent, type ListedMember } from "./people-api.ts";
import { MEMBER_PAGE_KEYSTROKES as KEY } from "./people-state.ts";
import { outcomeOfFailure } from "./refusal.tsx";
import { nameOf } from "./words.tsx";

type Activity = ReturnType<typeof useActivity>;

function Stream(properties: { readonly activity: Activity; readonly name: string }) {
  const { activity, name } = properties;
  const landing = useLanding();
  const events = useMemo(
    () => activity.data?.pages.flatMap((page) => page.events) ?? [],
    [activity.data],
  );

  if (events.length === 0) {
    return <ListState state={{ kind: "empty", words: WORDS.none(name), action: undefined }} />;
  }

  const showOlder = () => {
    landing.landOn(events.length);
    void activity.fetchNextPage();
  };

  return (
    <Card>
      <EventDays
        events={events}
        landing={landing}
        line={(event: ActivityEvent) => (
          // The marker wraps below a sentence too long to share its line, rather than squeeze it.
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 wrap-anywhere">{sentenceOf(event)}</span>
            <Pill>{WORDS.direction[event.direction](name)}</Pill>
          </div>
        )}
      />
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
    </Card>
  );
}

/** An empty stream has nowhere to say a later read failed, so a failure stands in for it. */
const streamStands = (activity: Activity): boolean =>
  activity.error === null || activity.data?.pages.some((page) => page.events.length > 0) === true;

/** The actions the member took and the actions done to them, in one stream, read a page at a time. */
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
