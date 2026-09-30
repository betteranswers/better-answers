import { useId } from "react";

import { KeystrokesAct } from "@/shared/keystrokes.tsx";
import { CONSOLE, groupIn } from "@/shared/navigation.ts";
import type { ScreenToolbar } from "@/shared/screen-toolbar.tsx";

import { EveryoneList } from "./everyone-list.tsx";
import { PEOPLE_KEYSTROKES } from "./people-keystrokes.ts";

const people = groupIn(CONSOLE, "people");

export const EVERYONE_TOOLBAR: ScreenToolbar = {
  acts: <KeystrokesAct screen={people.name} keystrokes={Object.values(PEOPLE_KEYSTROKES)} />,
};

export function EveryoneScreen() {
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
