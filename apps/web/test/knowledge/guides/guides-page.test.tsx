import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GUIDES_PAGE } from "@/features/knowledge/guides/guide-state.ts";
import { GUIDES_WORDS } from "@/features/knowledge/guides/guide-words.ts";
import {
  A_GUIDE_ID,
  A_GUIDE_PAGE,
  aGuide,
  aGuideApi,
  aGuideSummary,
} from "@test/knowledge/guide-answers.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const main = () => within(screen.getByRole("main"));

const numbersInTheRow = () =>
  within(main().getByRole("list", { name: "Guides" }))
    .getByRole("listitem")
    .textContent.match(/\d+/gu);

describe("the Guides list", () => {
  it("counts the guides and names each by its subject", async () => {
    await openAt(GUIDES_PAGE.path, aGuideApi("Editor"));

    expect((await main().findByText(GUIDES_WORDS.count(1))).tagName).toBe("OUTPUT");
    const row = within(main().getByRole("list", { name: "Guides" })).getByRole("listitem");
    expect(within(row).getByRole("link", { name: "Northgate Ltd" })).toBeDefined();
    expect(within(row).getByText("Bid library")).toBeDefined();
    expect(within(row).getByText("8 sections")).toBeDefined();
  });

  it("names a guide with no subject by its collection", async () => {
    const api = aGuideApi("Viewer");
    api.set("knowledge.guides", () => read([aGuideSummary({ subject: null })]));
    await openAt(GUIDES_PAGE.path, api);

    expect(await main().findByRole("link", { name: "northgate" })).toBeDefined();
  });

  for (const needsReview of [1, 2]) {
    it(`counts ${String(needsReview)} needing review beside the section count`, async () => {
      const api = aGuideApi("Viewer");
      api.set("knowledge.guides", () => read([aGuideSummary({ needsReview })]));
      await openAt(GUIDES_PAGE.path, api);

      await main().findByRole("link", { name: "Northgate Ltd" });
      expect(numbersInTheRow()).toEqual(["8", String(needsReview)]);
    });
  }

  it("shows no review count when no section needs review", async () => {
    await openAt(GUIDES_PAGE.path, aGuideApi("Viewer"));

    await main().findByRole("link", { name: "Northgate Ltd" });
    expect(numbersInTheRow()).toEqual(["8"]);
  });

  it("opens a guide from its row", async () => {
    const api = aGuideApi("Editor", aGuide());
    const router = await openAt(GUIDES_PAGE.path, api);

    fireEvent.click(await main().findByRole("link", { name: "Northgate Ltd" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(A_GUIDE_PAGE);
    });
    expect(A_GUIDE_PAGE.endsWith(A_GUIDE_ID)).toBe(true);
    expect(await main().findByRole("heading", { level: 1, name: "Northgate Ltd" })).toBeDefined();
  });

  it("lists no guides and counts zero when there are none", async () => {
    const api = aGuideApi("Editor");
    api.set("knowledge.guides", () => read([]));
    await openAt(GUIDES_PAGE.path, api);

    expect((await main().findByText(GUIDES_WORDS.count(0))).tagName).toBe("OUTPUT");
    expect(main().queryByRole("list", { name: "Guides" })).toBeNull();
  });
});
