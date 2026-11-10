import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CONCEPT_IRI_PREFIX } from "@better-answers/schema/concept-file";

import { KNOWLEDGE_BASE_LIST } from "@/features/knowledge/knowledge-state.ts";
import { KNOWLEDGE_BASE_WORDS as WORDS } from "@/features/knowledge/knowledge-words.ts";
import { collectionNameOf } from "@/shared/knowledge/collection-name.ts";
import { KNOWLEDGE, menuGroupIn, pageById } from "@/shared/navigation.ts";
import { aSearchApi, placedForSearch } from "@test/knowledge/search-answers.ts";
import { server } from "@test/stub-server.ts";
import { openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedForSearch();

const KNOWLEDGE_BASE = pageById(menuGroupIn(KNOWLEDGE, "browse"), "knowledge-base").path;

const concept = (place: number, title: string) => ({
  iri: `${CONCEPT_IRI_PREFIX}${String(place).padStart(26, "0")}`,
  title,
  conceptType: "insurance policy",
  trust: { tier: "unverified", status: "current" },
  trustWords: "Unverified",
});

const COMPANY = {
  collection: "company",
  count: 4,
  conceptTypes: [
    { conceptType: "insurance policy", count: 2 },
    { conceptType: "lease", count: 1 },
    { conceptType: "licence", count: 1 },
  ],
};

const PRODUCT = {
  collection: "product",
  count: 3,
  conceptTypes: [{ conceptType: "datasheet", count: 3 }],
};

const UNFILED = { collection: null, count: 6, conceptTypes: [{ conceptType: "policy", count: 6 }] };

const aKnowledgeBaseApi = (collections: readonly unknown[] = [COMPANY, PRODUCT, UNFILED]) => {
  const api = aSearchApi();
  api.set("knowledge.tree", () => read({ collections }));
  api.set("knowledge.conceptsOfType", () =>
    read({ concepts: [concept(1, "Yard lease"), concept(2, "Van cover")], nextCursor: null }),
  );
  return api;
};

const typesAsked = (): readonly unknown[] =>
  server.asks.filter((ask) => ask.procedure === "knowledge.conceptsOfType").map((ask) => ask.input);

const treeItemOf = (collection: string) =>
  screen.getByRole("treeitem", { name: new RegExp(`^${collectionNameOf(collection)},`, "u") });

describe("the Knowledge Base page", () => {
  it("opens on the largest collection and lists its largest type", async () => {
    await openAt(KNOWLEDGE_BASE, aKnowledgeBaseApi());

    expect(await screen.findByRole("link", { name: "Yard lease" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Van cover" })).toBeDefined();
    expect(typesAsked()[0]).toMatchObject({
      collection: "company",
      conceptType: "insurance policy",
    });
    expect(treeItemOf("company").getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: WORDS.conceptTypeIn("insurance policy", "company"),
      }),
    ).toBeDefined();
  });

  it("passes over unfiled concepts while a collection has some", async () => {
    await openAt(KNOWLEDGE_BASE, aKnowledgeBaseApi());

    await screen.findByRole("link", { name: "Yard lease" });

    expect(typesAsked()).not.toContainEqual(expect.objectContaining({ collection: null }));
  });

  it("opens on concepts in no collection when no collection exists", async () => {
    await openAt(KNOWLEDGE_BASE, aKnowledgeBaseApi([UNFILED]));

    await screen.findByRole("link", { name: "Yard lease" });

    expect(typesAsked()[0]).toMatchObject({ collection: null, conceptType: "policy" });
  });

  it("keeps the type the address holds instead of the largest", async () => {
    await openAt(
      `${KNOWLEDGE_BASE}?${KNOWLEDGE_BASE_LIST}.collection=product&${KNOWLEDGE_BASE_LIST}.type=datasheet`,
      aKnowledgeBaseApi(),
    );

    await screen.findByRole("link", { name: "Yard lease" });

    expect(typesAsked()[0]).toMatchObject({ collection: "product", conceptType: "datasheet" });
    await waitFor(() => {
      expect(
        within(screen.getByRole("tree")).getByRole("treeitem", { selected: true }).textContent,
      ).toContain("datasheet");
    });
  });

  it("names each collection in the tree by its display name", async () => {
    await openAt(KNOWLEDGE_BASE, aKnowledgeBaseApi());

    await screen.findByRole("link", { name: "Yard lease" });

    expect(treeItemOf("company")).toBeDefined();
    expect(treeItemOf("product")).toBeDefined();
    expect(screen.queryByRole("treeitem", { name: /^company,/u })).toBeNull();
  });
});
