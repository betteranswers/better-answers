import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MATCHES_A_PAGE as A_PAGE } from "@/features/knowledge/knowledge-state.ts";
import { SEARCH_WORDS } from "@/features/knowledge/knowledge-words.ts";
import {
  aSearchApi,
  answeringFinds,
  atWidth,
  focusIsOn,
  focusLandsOn,
  HANDBOOK,
  matchRows,
  openedSearch,
  openerIn,
  pageOf,
  palletPassage,
  PALLET_PASSAGES,
  placedForSearch,
  pressed,
  fireVisibilityChange,
  rowAt,
  searchStatusText,
  searchBox,
  searched,
  searchHeading,
  thePalletPassages,
  typed,
} from "@test/knowledge/search-answers.ts";
import { read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedForSearch();

const FIRST_PALLET_PASSAGE = palletPassage(0);

const withholding = () => {
  const withheld = { count: 0 };
  const api = aSearchApi();
  api.set(
    "knowledge.find",
    answeringFinds((asked) => {
      const page = pageOf(asked.query === "pallet" ? PALLET_PASSAGES : [], asked);
      return read({ ...page, matches: page.matches.slice(withheld.count) });
    }),
  );
  api.set("knowledge.open", thePalletPassages);
  return { api, withheld };
};

const firstOpener = () => openerIn(rowAt(0), HANDBOOK);

describe("the Knowledge Search page", () => {
  for (const width of [1024, 1280]) {
    it(`closes the passage a refresh drops, at ${String(width)} px`, async () => {
      atWidth(width);
      const { api, withheld } = withholding();
      const router = await openedSearch(api);
      await searched(router, "pallet");
      const whileListed = searchStatusText();
      pressed(firstOpener());
      const heading = await screen.findByRole("heading", { name: HANDBOOK });
      await focusLandsOn(() => heading, "the opened passage's heading did not take focus");
      expect((await screen.findByRole("blockquote")).textContent).toContain(FIRST_PALLET_PASSAGE);

      withheld.count = 1;
      fireVisibilityChange();

      await waitFor(() => expect(matchRows()).toHaveLength(A_PAGE - 1));
      expect(
        screen.queryByRole("heading", { name: HANDBOOK }),
        "the passage stayed open after its match was dropped",
      ).toBeNull();
      expect(
        searchStatusText(),
        "the status did not change when the open passage was dropped",
      ).not.toBe(whileListed);
      await focusLandsOn(searchHeading, "focus fell to the page body when the passage closed");

      pressed(firstOpener());
      await focusLandsOn(
        () => screen.getByRole("heading", { name: HANDBOOK }),
        "the reopened passage's heading did not take focus",
      );
      expect(searchStatusText(), "the dropped-passage notice stayed after a passage reopened").toBe(
        SEARCH_WORDS.matched("pallet", A_PAGE - 1, true),
      );

      searchBox().focus();
      withheld.count = 2;
      fireVisibilityChange();

      await waitFor(() => expect(matchRows()).toHaveLength(A_PAGE - 2));
      expect(searchStatusText()).toContain(SEARCH_WORDS.passageLeft);
      focusIsOn(searchBox(), "focus was taken from where the reader put it");

      typed("forklift");
      await waitFor(() => expect(searchStatusText()).toContain("forklift"));
      expect(matchRows()).toHaveLength(0);
      typed("pallet");
      await waitFor(() =>
        expect(searchStatusText(), "the dropped-passage notice came back with the search").toBe(
          SEARCH_WORDS.matched("pallet", A_PAGE - 2, true),
        ),
      );
    });
  }

  it("focuses Search when a refresh drops the focused match", async () => {
    const { api, withheld } = withholding();
    const router = await openedSearch(api);
    await searched(router, "pallet");
    firstOpener().focus();

    withheld.count = 1;
    fireVisibilityChange();

    await waitFor(() => expect(matchRows()).toHaveLength(A_PAGE - 1));
    await focusLandsOn(searchHeading, "focus fell to the page body when its match was dropped");
  });
});
