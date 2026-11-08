import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CONCEPT_IRI_PREFIX } from "@better-answers/schema/concept-file";

import { KNOWLEDGE_BASE_LIST } from "@/features/knowledge/knowledge-state.ts";
import { ALL_KNOWLEDGE_PAGE, SEARCH_PAGE } from "@/shared/knowledge/concept-address.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import {
  aConceptRow,
  ALL_KNOWLEDGE,
  anAllKnowledgeApi,
  knowledgeAsks,
} from "@test/knowledge/all-knowledge-answers.ts";
import {
  anOpenedConcept,
  aSearchApi,
  answeringConcepts,
  placedForSearch,
} from "@test/knowledge/search-answers.ts";
import { openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedForSearch();

const KNOWLEDGE_BASE = pageNamed(menuGroupIn(KNOWLEDGE, "browse"), "Knowledge Base").path;

const OPEN_CONCEPT_TYPE = `${KNOWLEDGE_BASE}?${KNOWLEDGE_BASE_LIST}.collection=company&${KNOWLEDGE_BASE_LIST}.type=lease`;

const A_LEASE = "00000000000000000000000005";

const aKnowledgeBaseApi = () => {
  const api = aSearchApi();
  api.set("knowledge.tree", () =>
    read({
      collections: [
        { collection: "company", count: 1, conceptTypes: [{ conceptType: "lease", count: 1 }] },
      ],
    }),
  );
  api.set("knowledge.conceptsOfType", () =>
    read({
      concepts: [
        {
          iri: `${CONCEPT_IRI_PREFIX}${A_LEASE}`,
          title: "Yard Lease",
          conceptType: "lease",
          trust: { tier: "unverified", status: "current" },
          trustWords: "Unverified",
        },
      ],
      nextCursor: null,
    }),
  );
  api.set(
    "knowledge.open",
    answeringConcepts((iri) =>
      read({
        found: true,
        concept: anOpenedConcept(iri, { title: "Yard Lease", type: "lease" }, ""),
      }),
    ),
  );
  return api;
};

const markedInTheMenu = () =>
  within(screen.getByRole("navigation", { name: "Knowledge" }))
    .queryAllByRole("link", { current: "page" })
    .map((link) => link.textContent);

const inTheBreadcrumb = () => within(screen.getByRole("navigation", { name: "Breadcrumb" }));

describe("the concept page's back link", () => {
  it("goes back to Knowledge Base with its type open", async () => {
    const router = await openAt(OPEN_CONCEPT_TYPE, aKnowledgeBaseApi());

    fireEvent.click(await screen.findByRole("link", { name: "Yard Lease" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Yard Lease" })).toBeDefined();
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
    expect(router.state.location.searchStr).toContain(`${KNOWLEDGE_BASE_LIST}.type=lease`);
    expect(await screen.findByRole("link", { name: "Yard Lease" })).toBeDefined();
  });

  it("returns to Knowledge Base by its keystroke", async () => {
    const router = await openAt(OPEN_CONCEPT_TYPE, aKnowledgeBaseApi());
    fireEvent.click(await screen.findByRole("link", { name: "Yard Lease" }));
    await screen.findByRole("heading", { level: 1, name: "Yard Lease" });

    fireEvent.keyDown(document.body, { key: "b" });

    await waitFor(() => expect(router.state.location.pathname).toBe(KNOWLEDGE_BASE));
    expect(router.state.location.searchStr).toContain(`${KNOWLEDGE_BASE_LIST}.type=lease`);
  });

  it("goes back to All Knowledge with its address", async () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      aConceptRow(index + 1, `Policy ${String(index + 1).padStart(2, "0")}`),
    );
    const held = `${ALL_KNOWLEDGE}?all.sort=-title&all.type=policy&all.page=2`;
    const router = await openAt(
      held,
      anAllKnowledgeApi(() => many),
    );

    fireEvent.click(await screen.findByRole("link", { name: "Policy 05" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Policy 05" })).toBeDefined();
    expect(markedInTheMenu()).toEqual(["All Knowledge"]);
    const main = within(screen.getByRole("main"));
    expect(main.queryByRole("link", { name: "Back to Search" })).toBeNull();

    fireEvent.click(main.getByRole("link", { name: "Back to All Knowledge" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(ALL_KNOWLEDGE_PAGE.path));
    expect(router.state.location.search).toMatchObject({
      "all.sort": "-title",
      "all.type": "policy",
      "all.page": 2,
    });
    const returned = await screen.findByRole("link", { name: "Policy 05" });
    await waitFor(() => expect(document.activeElement).toBe(returned));
    expect(
      new Set(knowledgeAsks().map((ask) => JSON.stringify(ask))),
      "a read asked for a page the address does not hold",
    ).toEqual(
      new Set([
        JSON.stringify({
          collections: [],
          conceptType: "policy",
          sort: { column: "title", desc: true },
          page: 2,
        }),
      ]),
    );
  });

  it("links back to Search for a concept opened by address", async () => {
    await openAt(`${SEARCH_PAGE.path}/${A_LEASE}`, aKnowledgeBaseApi());

    expect(await screen.findByRole("link", { name: "Back to Search" })).toBeDefined();
    expect(markedInTheMenu()).toEqual(["Search"]);
  });
});
