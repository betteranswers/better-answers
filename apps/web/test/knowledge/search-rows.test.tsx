import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GUIDES_PAGE } from "@/features/knowledge/guides/guide-state.ts";
import { SEARCH_WORDS } from "@/features/knowledge/knowledge-words.ts";
import { KNOWLEDGE_BASE_PAGE } from "@/shared/knowledge/concept-address.ts";
import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";
import {
  aConceptMatch,
  aSearchApi,
  finding,
  foundNothing,
  matchRows,
  openedSearch,
  placedForSearch,
  rowNamed,
  searched,
  searchStatusText,
} from "@test/knowledge/search-answers.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedForSearch();

const standing = (
  tier: string,
  status: string,
  verifiedBy: string | null,
  verifiedAt: string | null,
) => ({ tier, status, verifiedBy, verifiedAt, rider: null });

const CHECKED_BY_PRIYA = "Verified by Priya Shah · 3 March 2026";

const SAFEGUARDING = [
  aConceptMatch("Safeguarding Children Partnerships", 1, {
    kind: "Sector",
    collection: "Sectors",
    description: "How local partnerships keep children safe, and who buys training and audits.",
    trust: standing("human-reviewed", "current", "Priya Shah", "2026-03-03T09:41:00.000Z"),
    trustWords: CHECKED_BY_PRIYA,
  }),
  aConceptMatch("Safeguarding Training Policy", 2, {
    kind: "Policy",
    collection: "Policies",
    description: "Who is trained, how often, and where the record is kept.",
    trust: standing("machine-confirmed", "current", null, "2026-02-12T10:00:00.000Z"),
    trustWords: "Verified automatically",
  }),
  aConceptMatch("Safeguarding Contacts", 3, {
    description: "The names to call when a concern is raised.",
  }),
  aConceptMatch("Safeguarding Review Rota", 4, {
    kind: "Process",
    collection: "Operations",
    description: null,
    trust: standing("human-reviewed", "out-of-date", "Priya Shah", "2025-01-10T09:00:00.000Z"),
    trustWords: "Out of date",
  }),
];

const searchedForSafeguarding = async () => {
  const api = aSearchApi();
  api.set("knowledge.find", finding({ safeguarding: SAFEGUARDING }));
  const router = await openedSearch(api);
  await searched(router, "safeguarding");
  await waitFor(() => expect(matchRows()).toHaveLength(SAFEGUARDING.length));
};

const nextSteps = () => screen.getByRole("list", { name: "Where to look next" });

const linkIn = (name: string) => within(nextSteps()).getByRole("link", { name });

describe("a concept's row on the Knowledge Search page", () => {
  it("shows a person's verification once, with its date", async () => {
    await searchedForSafeguarding();

    const text = rowNamed("Safeguarding Children Partnerships").textContent;

    expect(text).toContain(CHECKED_BY_PRIYA);
    expect(text.match(/3 March 2026/g)).toHaveLength(1);
    expect(text).toContain(`${CONCEPT_WORDS.kind}Sector`);
    expect(text).toContain("CollectionSectors");
  });

  it("shows a machine's check with the day it was made", async () => {
    await searchedForSafeguarding();

    expect(rowNamed("Safeguarding Training Policy").textContent).toContain(
      "Verified automatically · 12 February 2026",
    );
  });

  it("shows an unverified concept with no date or collection", async () => {
    await searchedForSafeguarding();

    const text = rowNamed("Safeguarding Contacts").textContent;

    expect(text).toContain("Unverified");
    expect(text).toContain("CollectionNo collection");
    expect(text).not.toMatch(/\d{4}/);
  });

  it("shows an out-of-date concept by that word alone", async () => {
    await searchedForSafeguarding();

    const text = rowNamed("Safeguarding Review Rota").textContent;

    expect(text).toContain("Out of date");
    expect(text).not.toMatch(/\d{4}/);
  });

  it("shows the description, and nothing when there is none", async () => {
    await searchedForSafeguarding();

    expect(rowNamed("Safeguarding Contacts").textContent).toContain(
      "The names to call when a concern is raised.",
    );
    expect(rowNamed("Safeguarding Children Partnerships").textContent).toContain(
      "How local partnerships keep children safe",
    );
    expect(rowNamed("Safeguarding Review Rota").querySelector("p")).toBeNull();
  });
});

describe("a Knowledge Search that finds nothing", () => {
  it("names the query and links to Ask, Guides, Knowledge Base", async () => {
    const api = aSearchApi();
    await openedSearch(api);

    await foundNothing(api, "zebra");

    expect(searchStatusText()).toBe(SEARCH_WORDS.noMatches("zebra"));
    expect(linkIn("Ask this question").getAttribute("href")).toBe(
      "/ask/new-question?question=zebra",
    );
    expect(linkIn(GUIDES_PAGE.name).getAttribute("href")).toBe("/knowledge/guides");
    expect(linkIn(KNOWLEDGE_BASE_PAGE.name).getAttribute("href")).toBe("/knowledge/knowledge-base");
  });

  it("carries a typed question to Ask unchanged", async () => {
    const api = aSearchApi();
    await openedSearch(api);

    await foundNothing(api, "Can we bill in euros?");

    expect(linkIn("Ask this question").getAttribute("href")).toBe(
      "/ask/new-question?question=Can+we+bill+in+euros%3F",
    );
  });

  it("names the next action while nothing is typed", async () => {
    await openedSearch(aSearchApi());

    expect(screen.getByRole("searchbox", { name: SEARCH_WORDS.search })).toBeTruthy();
    expect(searchStatusText()).toBe("");
    expect(screen.queryByRole("list", { name: "Where to look next" })).toBeNull();
  });
});
