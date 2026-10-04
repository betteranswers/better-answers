import { useId } from "react";

import { usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { CONSOLE, menuGroupIn } from "@/shared/navigation.ts";

import { EveryoneList } from "./everyone-list.tsx";
import { PEOPLE_KEYSTROKES } from "./people-keystrokes.ts";

const people = menuGroupIn(CONSOLE, "people");

const LISTED = Object.values(PEOPLE_KEYSTROKES);

export function EveryonePage() {
  usePageKeystrokes(LISTED);
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
