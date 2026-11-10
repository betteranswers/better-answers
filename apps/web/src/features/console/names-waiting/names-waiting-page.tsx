import { usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { CONSOLE, menuGroupIn, pageById } from "@/shared/navigation.ts";
import { PageHead } from "@/shared/page/page-head.tsx";

import { NAMES_WAITING_KEYSTROKES } from "../people-keystrokes.ts";
import { NamesWaitingList } from "./names-waiting-list.tsx";

const people = menuGroupIn(CONSOLE, "people");

const THIS_PAGE = pageById(people, "flagged-names");

const LISTED = Object.values(NAMES_WAITING_KEYSTROKES);

export function NamesWaitingPage() {
  usePageKeystrokes(LISTED);

  return (
    <>
      <PageHead title={THIS_PAGE.name} />
      <NamesWaitingList />
    </>
  );
}
