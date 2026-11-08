import { useNavigate, useRouterState } from "@tanstack/react-router";

import { askingHere } from "@/shared/address/address-ask.ts";
import { KNOWLEDGE_BASE_PAGE } from "@/shared/knowledge/concept-address.ts";
import { RowLink } from "@/shared/list/grid-table.tsx";
import { NEW_QUESTION } from "@/shared/navigation.ts";

import { GUIDES_PAGE } from "./guides/guide-state.ts";
import { SEARCH_WORDS as WORDS } from "./knowledge-words.ts";

export function WhereNext(properties: { readonly query: string }) {
  const navigate = useNavigate();
  const here = useRouterState({ select: (state) => state.location });
  const links = [
    {
      name: WORDS.askThisQuestion,
      href: askingHere(here, NEW_QUESTION.path, "question", properties.query.trim()),
    },
    { name: GUIDES_PAGE.name, href: GUIDES_PAGE.path },
    { name: KNOWLEDGE_BASE_PAGE.name, href: KNOWLEDGE_BASE_PAGE.path },
  ];
  return (
    <ul aria-label={WORDS.whereNext} className="flex flex-wrap gap-x-6 gap-y-2 px-4 pb-3">
      {links.map((link) => (
        <li key={link.name}>
          <RowLink
            href={link.href}
            className="text-brand"
            onOpen={() => {
              void navigate({ href: link.href });
            }}
          >
            {link.name}
          </RowLink>
        </li>
      ))}
    </ul>
  );
}
