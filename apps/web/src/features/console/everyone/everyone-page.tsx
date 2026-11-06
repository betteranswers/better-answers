import { usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { CONSOLE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { PageHead } from "@/shared/page/page-head.tsx";

import { PEOPLE_KEYSTROKES } from "../people-keystrokes.ts";
import { EveryoneList } from "./everyone-list.tsx";

const people = menuGroupIn(CONSOLE, "people");

const THIS_PAGE = pageNamed(people, "Everyone");

const LISTED = Object.values(PEOPLE_KEYSTROKES);

export function EveryonePage() {
  usePageKeystrokes(LISTED);

  return (
    <>
      <PageHead title={THIS_PAGE.name} />
      <EveryoneList />
    </>
  );
}
