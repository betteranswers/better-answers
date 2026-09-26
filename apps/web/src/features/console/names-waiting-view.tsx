import { useId, useRef } from "react";

import { KeystrokesAct } from "@/shared/keystrokes.tsx";
import { consoleScreenById } from "@/shared/screens.ts";
import type { ViewToolbar } from "@/shared/view-toolbar.tsx";

import { NamesWaitingList } from "./names-waiting-list.tsx";
import { NAMES_WAITING_KEYSTROKES } from "./people-keystrokes.ts";

const people = consoleScreenById("people");

export const NAMES_WAITING_TOOLBAR: ViewToolbar = {
  acts: <KeystrokesAct screen={people.name} keystrokes={Object.values(NAMES_WAITING_KEYSTROKES)} />,
};

export function NamesWaitingView() {
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
