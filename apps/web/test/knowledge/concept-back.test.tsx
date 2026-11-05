import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CONCEPT_IRI_PREFIX } from "@better-answers/schema/concept-file";

import { KNOWLEDGE_BASE_LIST } from "@/features/knowledge/knowledge-state.ts";
import { SEARCH_PAGE } from "@/shared/knowledge/concept-address.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import {
  aConceptRead,
  aSearchApi,
  answeringConcepts,
  placedForSearch,
} from "@test/knowledge/search-answers.ts";
import { openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedForSearch();

const KNOWLEDGE_BASE = pageNamed(menuGroupIn(KNOWLEDGE, "browse"), "Knowledge Base").path;

const OPEN_KIND = `${KNOWLEDGE_BASE}?${KNOWLEDGE_BASE_LIST}.collection=company&${KNOWLEDGE_BASE_LIST}.kind=lease`;

const A_LEASE = "00000000000000000000000005";

const aKnowledgeBaseApi = () => {
  const api = aSearchApi();
  api.set("knowledge.tree", () =>
    read({
      collections: [{ collection: "company", count: 1, kinds: [{ kind: "lease", count: 1 }] }],
    }),
  );
  api.set("knowledge.kindConcepts", () =>
    read({
      concepts: [
        {
          iri: `${CONCEPT_IRI_PREFIX}${A_LEASE}`,
          title: "Yard Lease",
          kind: "lease",
          trustWords: "Unverified",
        },
      ],
      nextCursor: null,
    }),
  );
  api.set(
    "knowledge.open",
    answeringConcepts(() => aConceptRead("Yard Lease", 5)),
  );
  return api;
};

const markedInTheMenu = () =>
  within(screen.getByRole("navigation", { name: "Knowledge" }))
    .queryAllByRole("link", { current: "page" })
    .map((link) => link.textContent);

const inTheBreadcrumb = () => within(screen.getByRole("navigation", { name: "Breadcrumb" }));

describe("the concept page's way back", () => {
  it("goes back to Knowledge Base with its kind open", async () => {
    const router = await openAt(OPEN_KIND, aKnowledgeBaseApi());

    fireEvent.click(await screen.findByRole("link", { name: "Yard Lease" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Yard Lease" })).toBeDefined();
    expect(router.state.location.pathname.startsWith(`${SEARCH_PAGE.path}/`)).toBe(true);
    const main = within(screen.getByRole("main"));
    expect(main.queryByRole("link", { name: "Back to Search" })).toBeNull();
    expect(
      inTheBreadcrumb().queryByRole("link", { name: "Knowledge Base" }),
      "the shell marks another page as the open one",
    ).not.toBeNull();
    expect(markedInTheMenu(), "the menu tells a screen reader the page it draws").toEqual([
      "Knowledge Base",
    ]);

    fireEvent.click(main.getByRole("link", { name: "Back to Knowledge Base" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(KNOWLEDGE_BASE));
    expect(router.state.location.searchStr).toContain(`${KNOWLEDGE_BASE_LIST}.kind=lease`);
    expect(await screen.findByRole("link", { name: "Yard Lease" })).toBeDefined();
  });

  it("returns to Knowledge Base by its keystroke", async () => {
    const router = await openAt(OPEN_KIND, aKnowledgeBaseApi());
    fireEvent.click(await screen.findByRole("link", { name: "Yard Lease" }));
    await screen.findByRole("heading", { level: 2, name: "Yard Lease" });

    fireEvent.keyDown(document.body, { key: "b" });

    await waitFor(() => expect(router.state.location.pathname).toBe(KNOWLEDGE_BASE));
    expect(router.state.location.searchStr).toContain(`${KNOWLEDGE_BASE_LIST}.kind=lease`);
  });

  it("keeps naming Search for a concept opened by its address", async () => {
    await openAt(`${SEARCH_PAGE.path}/${A_LEASE}`, aKnowledgeBaseApi());

    expect(await screen.findByRole("link", { name: "Back to Search" })).toBeDefined();
    expect(markedInTheMenu()).toEqual(["Search"]);
  });
});
