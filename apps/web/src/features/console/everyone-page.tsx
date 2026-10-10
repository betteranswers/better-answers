import { usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { CONSOLE, menuGroupIn } from "@/shared/navigation.ts";
import { PageHead } from "@/shared/page-head.tsx";

import { EveryoneList } from "./everyone-list.tsx";
import { PEOPLE_KEYSTROKES } from "./people-keystrokes.ts";

const people = menuGroupIn(CONSOLE, "people");

const LISTED = Object.values(PEOPLE_KEYSTROKES);

export function EveryonePage() {
  usePageKeystrokes(LISTED);

  return (
    <>
      <PageHead heading={people.name} summary={people.summary} />
      <EveryoneList />
    </>
  );
}
