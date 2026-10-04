import { useCallback, useMemo, useState, type ReactNode } from "react";

import { timeWords, weekdayWords } from "@/shared/words.ts";

type Dated = { readonly id: string; readonly at: string };

/** Newest first, so a day's lines stand together. A loop: `Map.groupBy` is newer than the build's browsers. */
const daysOf = <Event extends Dated>(events: readonly Event[]) => {
  const days = new Map<string, [number, Event][]>();
  for (const [index, event] of events.entries()) {
    const day = weekdayWords(event.at);
    days.set(day, [...(days.get(day) ?? []), [index, event]]);
  }
  return days;
};

/** Load more puts focus on the first line it brings, where reading resumes. */
export const useLanding = () => {
  const [landAt, setLandAt] = useState<number>();
  const landed = useCallback(() => {
    setLandAt(undefined);
  }, []);
  return { landAt, landed, landOn: setLandAt };
};

function Line(properties: {
  readonly at: string;
  readonly landsHere: boolean;
  readonly onLanded: () => void;
  readonly children: ReactNode;
}) {
  const { at, landsHere, onLanded } = properties;
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
      <time dateTime={at} className="shrink-0 text-muted-foreground tabular-nums">
        {timeWords(at)}
      </time>
      {properties.children}
    </li>
  );
}

/** One heading a day, newest first, each event a line beneath its time. */
export function EventDays<Event extends Dated>(properties: {
  readonly events: readonly Event[];
  readonly landing: ReturnType<typeof useLanding>;
  readonly line: (event: Event) => ReactNode;
}) {
  const { events, landing, line } = properties;
  const days = useMemo(() => [...daysOf(events)], [events]);

  return (
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
                at={event.at}
                landsHere={index === landing.landAt}
                onLanded={landing.landed}
              >
                {line(event)}
              </Line>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
