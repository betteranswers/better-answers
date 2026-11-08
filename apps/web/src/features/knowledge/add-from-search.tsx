import { Link } from "@tanstack/react-router";

import { SEARCH_PAGE } from "@/shared/knowledge/concept-address.ts";
import { LINK } from "@/shared/knowledge/concept-body.tsx";

import { KNOWLEDGE_BASE_WORDS as WORDS } from "./knowledge-words.ts";

/** The next action on a page that lists no concepts yet. */
export function AddFromSearch() {
  return (
    <Link to={SEARCH_PAGE.path} className={LINK}>
      {WORDS.addFromSearch(SEARCH_PAGE.name)}
    </Link>
  );
}
