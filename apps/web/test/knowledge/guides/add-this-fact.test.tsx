import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EDITOR_WORDS } from "@/features/knowledge/editing/editor-words.ts";
import { GUIDE_WORDS } from "@/features/knowledge/guides/guide-words.ts";
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
  await screen.findByRole("heading", { level: 3, name: EDITOR_WORDS.headingNew });
  expect(field("Title").value).toBe(LIABILITY_TITLE);
  expect(field(EDITOR_WORDS.kind).value).toBe("Insurance policy");
  expect(field("Tags").value).toBe("employers-liability");
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Collection" }).value).toBe(
    "northgate",
  );
};

describe("adding a missing fact from a guide", () => {
  it("opens Search with the editor prefilled from the fact", async () => {
    const router = await openedFromTheGuide();

    fireEvent.click(screen.getByRole("link", { name: GUIDE_WORDS.addFact }));

    await prefilled();
    expect(router.state.location.pathname).toBe(SEARCH_PAGE.path);
  });

  it("links the new concept to the guide's subject", async () => {
    await openedFromTheGuide();

    fireEvent.click(screen.getByRole("link", { name: GUIDE_WORDS.addFact }));

    await prefilled();
    const body = screen.getByRole("textbox", { name: "Body" });
    await waitFor(() => {
      expect(body.querySelector("a")?.getAttribute("href")).toBe(RACKING_IRI);
    });
  });

  it("adds the fact in focus on a", async () => {
    const router = await openedFromTheGuide();

    const add = screen.getByRole("link", { name: GUIDE_WORDS.addFact });
    add.focus();
    fireEvent.keyDown(add, { key: "a" });

    await prefilled();
    expect(router.state.location.pathname).toBe(SEARCH_PAGE.path);
  });

  it("leaves out a subject the guide does not have", async () => {
    const router = await openedFromTheGuide(aGuide({ subject: null }));

    fireEvent.click(screen.getByRole("link", { name: GUIDE_WORDS.addFact }));

    await prefilled();
    expect(router.state.location.search).not.toHaveProperty("knowledge.subject");
  });

  it("stays on the guide when no fact is missing", async () => {
    const recorded = aGuide({
      sections: [aSection({ coverage: { met: 1, of: 1, facts: [aFact({ state: "met" })] } })],
    });
    const router = await openedFromTheGuide(recorded);

    const button = screen.getByRole("button", { name: GUIDE_WORDS.showDetail });
    button.focus();
    fireEvent.keyDown(button, { key: "a" });

    const status = within(screen.getByRole("article")).getByRole("status");
    await waitFor(() => {
      expect(status.textContent, "a with nothing missing said nothing").toMatch(/\S/u);
    });
    expect(router.state.location.pathname).toBe(A_GUIDE_PAGE);
  });
});
