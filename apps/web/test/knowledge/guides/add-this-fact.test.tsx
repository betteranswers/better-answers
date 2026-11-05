import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SEARCH_PAGE } from "@/shared/knowledge/concept-address.ts";
import { aNewConceptApi } from "@test/knowledge/concept-editing-answers.ts";
import {
  A_GUIDE_PAGE,
  aFact,
  aGuide,
  aSection,
  LIABILITY_TITLE,
  RACKING_IRI,
} from "@test/knowledge/guide-answers.ts";
import { placedForSearch } from "@test/knowledge/search-answers.ts";
import { openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

await import("@/features/knowledge/editing/concept-session.tsx");

placedForSearch();

const openedFromTheGuide = async (guide = aGuide()) => {
  const api = aNewConceptApi();
  api.set("knowledge.guide", () => read(guide));
  const router = await openAt(A_GUIDE_PAGE, api);
  await screen.findByRole("article");
  return router;
};

const field = (name: string) => screen.getByRole<HTMLInputElement>("textbox", { name });

const prefilled = async () => {
  await screen.findByRole("heading", { level: 3, name: "New Concept" });
  expect(field("Title").value).toBe(LIABILITY_TITLE);
  expect(field("Kind").value).toBe("Insurance policy");
  expect(field("Tags").value).toBe("employers-liability");
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Collection" }).value).toBe(
    "northgate",
  );
};

describe("adding a missing fact from a guide", () => {
  it("opens Search with the editor prefilled from the fact", async () => {
    const router = await openedFromTheGuide();

    fireEvent.click(screen.getByRole("link", { name: "Add This Fact" }));

    await prefilled();
    expect(router.state.location.pathname).toBe(SEARCH_PAGE.path);
  });

  it("links the new concept to the guide's subject", async () => {
    await openedFromTheGuide();

    fireEvent.click(screen.getByRole("link", { name: "Add This Fact" }));

    await prefilled();
    const body = screen.getByRole("textbox", { name: "Body" });
    await waitFor(() => {
      expect(body.querySelector("a")?.getAttribute("href")).toBe(RACKING_IRI);
    });
  });

  it("adds the fact in focus on a", async () => {
    const router = await openedFromTheGuide();

    const add = screen.getByRole("link", { name: "Add This Fact" });
    add.focus();
    fireEvent.keyDown(add, { key: "a" });

    await prefilled();
    expect(router.state.location.pathname).toBe(SEARCH_PAGE.path);
  });

  it("leaves out a subject the guide does not have", async () => {
    const router = await openedFromTheGuide(aGuide({ subject: null }));

    fireEvent.click(screen.getByRole("link", { name: "Add This Fact" }));

    await prefilled();
    expect(router.state.location.search).not.toHaveProperty("knowledge.subject");
  });

  it("says nothing is missing when none is", async () => {
    const recorded = aGuide({
      sections: [aSection({ coverage: { met: 1, of: 1, facts: [aFact({ state: "met" })] } })],
    });
    await openedFromTheGuide(recorded);

    const button = screen.getByRole("button", { name: "Show Detail" });
    button.focus();
    fireEvent.keyDown(button, { key: "a" });

    const article = within(screen.getByRole("article"));
    expect(await article.findByText(/nothing to add/u)).toBeDefined();
  });
});
