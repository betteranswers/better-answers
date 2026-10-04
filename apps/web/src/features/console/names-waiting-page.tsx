import { useId, useRef } from "react";

import { usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { CONSOLE, menuGroupIn } from "@/shared/navigation.ts";

import { NamesWaitingList } from "./names-waiting-list.tsx";
import { NAMES_WAITING_KEYSTROKES } from "./people-keystrokes.ts";

const people = menuGroupIn(CONSOLE, "people");

const LISTED = Object.values(NAMES_WAITING_KEYSTROKES);

export function NamesWaitingPage() {
  usePageKeystrokes(LISTED);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  return (
    <>
      <h1>{people.name}</h1>
      <p className="mt-2 text-muted-foreground">{people.summary}</p>

      <section aria-labelledby={headingId} className="mt-6">
        {/* Focusable, so a corrected row's focus lands here rather than on the page. */}
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          Names waiting
        </h2>
        <p className="mt-1 text-muted-foreground">
          Display names an Admin flagged to the operator, the longest waiting first. Correcting a
          name replaces it in every workspace and takes it off this list.
        </p>
        <NamesWaitingList headingRef={headingRef} />
      </section>
    </>
  );
}
