import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  aPassageRead,
  answeringPassages,
  focusLandsOn,
  HANDBOOK,
  keyPressed,
  openerIn,
  palletPassage,
  placedForSearch,
  pressed,
  refusing,
  rowAt,
  thePalletPassages,
  searchedForPallets,
} from "@test/knowledge/search-answers.ts";
import { aRefusalAnswer, FORBIDDEN } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedForSearch();

const FIRST_PALLET_PASSAGE = palletPassage(0);

const NOT_FOUND = aRefusalAnswer("not-found", "absent", 404);

const RENAMED = "Warehouse handbook, second edition";

const panelOpened = async (title = HANDBOOK) => {
  const panel = await screen.findByRole("dialog", { name: title });
  return { panel, heading: within(panel).getByRole("heading", { name: title }) };
};

describe("the Knowledge Search page", () => {
  it("alerts when a passage read fails, and retries it", async () => {
    const { api } = await searchedForPallets();
    api.set("knowledge.open", answeringPassages(refusing(FORBIDDEN)));

    pressed(openerIn(rowAt(0), HANDBOOK));

    const { panel, heading } = await panelOpened();
    await waitFor(() =>
      expect(within(panel).getByRole("alert").textContent, "the alert says nothing").toMatch(/\S/),
    );
    api.set("knowledge.open", thePalletPassages);
    pressed(within(panel).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(panel.textContent).toContain(FIRST_PALLET_PASSAGE));
    await focusLandsOn(() => heading, "Retry did not return focus to the panel's heading");
  });

  it("alerts when the passage is not found", async () => {
    const { api } = await searchedForPallets();
    api.set("knowledge.open", answeringPassages(refusing(NOT_FOUND)));

    pressed(openerIn(rowAt(0), HANDBOOK));

    const { panel } = await panelOpened();
    await waitFor(() =>
      expect(within(panel).getByRole("alert").textContent, "the alert says nothing").toMatch(/\S/u),
    );
    expect(panel.textContent, "the panel shows a passage it did not find").not.toContain(
      FIRST_PALLET_PASSAGE,
    );
  });

  it("names the panel from the passage read, not the match", async () => {
    const { api } = await searchedForPallets();
    api.set(
      "knowledge.open",
      answeringPassages((locator) =>
        aPassageRead(RENAMED, locator, FIRST_PALLET_PASSAGE, "Restricted"),
      ),
    );
    const first = rowAt(0);

    pressed(openerIn(first, HANDBOOK));

    const { panel, heading } = await panelOpened(RENAMED);
    await focusLandsOn(() => heading, "the panel's heading did not take focus");
    await waitFor(() => expect(panel.textContent).toMatch(/Not company knowledge\W+Restricted/));
    expect(panel.textContent, "the panel copied the match's sensitivity").not.toContain("Internal");
    expect(first.textContent).toMatch(/Not company knowledge\W+Internal/);

    keyPressed("Escape");
    await waitFor(() => expect(panel.isConnected).toBe(false));
    api.set("knowledge.open", answeringPassages(refusing(NOT_FOUND)));
    pressed(openerIn(first, HANDBOOK));

    const refused = await panelOpened(HANDBOOK);
    await waitFor(() =>
      expect(
        within(refused.panel).getByRole("alert").textContent,
        "the alert says nothing",
      ).toMatch(/\S/u),
    );
    expect(screen.queryByText(RENAMED), "a refused read kept its earlier title").toBeNull();
  });
});
