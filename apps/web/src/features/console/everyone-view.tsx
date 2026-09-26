import { useId } from "react";

import { KeystrokesAct } from "@/shared/keystrokes.tsx";
import { consoleScreenById } from "@/shared/screens.ts";
import type { ViewToolbar } from "@/shared/view-toolbar.tsx";

import { EveryoneList } from "./everyone-list.tsx";
import { PEOPLE_KEYSTROKES } from "./people-keystrokes.ts";

const people = consoleScreenById("people");

export const EVERYONE_TOOLBAR: ViewToolbar = {
  acts: <KeystrokesAct screen={people.name} keystrokes={Object.values(PEOPLE_KEYSTROKES)} />,
};

export function EveryoneView() {
  const headingId = useId();

  return (
    <>
      <h1>{people.name}</h1>
      <p className="mt-2 text-muted-foreground">{people.summary}</p>

      <section aria-labelledby={headingId} className="mt-6">
        <h2 id={headingId}>Everyone</h2>
        <EveryoneList />
      </section>
    </>
  );
}
