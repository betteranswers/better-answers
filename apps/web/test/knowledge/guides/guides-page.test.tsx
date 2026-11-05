import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GUIDES_PAGE } from "@/features/knowledge/guides/guide-state.ts";
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

describe("the Guides list", () => {
  it("counts the guides and names each by its subject", async () => {
    await openAt(GUIDES_PAGE.path, aGuideApi("Editor"));

    expect((await main().findByText("1 Guide")).tagName).toBe("OUTPUT");
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

  it("says how many sections need review", async () => {
    const api = aGuideApi("Viewer");
    api.set("knowledge.guides", () => read([aGuideSummary({ needsReview: 2 })]));
    await openAt(GUIDES_PAGE.path, api);

    expect(await main().findByText("2 sections need review")).toBeDefined();
  });

  it("says a single section needs review in the singular", async () => {
    const api = aGuideApi("Viewer");
    api.set("knowledge.guides", () => read([aGuideSummary({ needsReview: 1 })]));
    await openAt(GUIDES_PAGE.path, api);

    expect(await main().findByText("1 section needs review")).toBeDefined();
  });

  it("says nothing needs review when no section does", async () => {
    await openAt(GUIDES_PAGE.path, aGuideApi("Viewer"));

    await main().findByRole("link", { name: "Northgate Ltd" });
    expect(main().queryByText(/need review/u)).toBeNull();
  });

  it("opens a guide from its row", async () => {
    const api = aGuideApi("Editor", aGuide());
    const router = await openAt(GUIDES_PAGE.path, api);

    fireEvent.click(await main().findByRole("link", { name: "Northgate Ltd" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(A_GUIDE_PAGE);
    });
    expect(A_GUIDE_PAGE.endsWith(A_GUIDE_ID)).toBe(true);
    expect(await main().findByRole("heading", { level: 2, name: "Northgate Ltd" })).toBeDefined();
  });

  it("says when there is no guide to list", async () => {
    const api = aGuideApi("Editor");
    api.set("knowledge.guides", () => read([]));
    await openAt(GUIDES_PAGE.path, api);

    expect(await main().findByText(/No guides to show yet/u)).toBeDefined();
    expect(main().getByText("0 Guides").tagName).toBe("OUTPUT");
  });
});
