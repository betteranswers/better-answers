import { useMemo, type ReactNode } from "react";

import { useLandingLine, type Landing } from "@/shared/landing.ts";
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

function Line(properties: {
  readonly at: string;
  readonly landsHere: boolean;
  readonly onLanded: () => void;
  readonly children: ReactNode;
}) {
  const { at, landsHere, onLanded } = properties;
  const land = useLandingLine(landsHere, onLanded);

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
  readonly landing: Landing;
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
