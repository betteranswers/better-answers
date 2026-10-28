import { usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { CONSOLE, menuGroupIn } from "@/shared/navigation.ts";
import { PageHead } from "@/shared/page/page-head.tsx";

import { PEOPLE_KEYSTROKES } from "../people-keystrokes.ts";
import { EveryoneList } from "./everyone-list.tsx";

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
