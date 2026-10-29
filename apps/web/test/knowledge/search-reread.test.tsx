import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MATCHES_A_PAGE as A_PAGE } from "@/features/knowledge/knowledge-state.ts";
import { read } from "@test/two-workspaces.ts";

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
  refocused,
  rowAt,
  saidNow,
  searchBox,
  searched,
  searchHeading,
  thePalletPassages,
  typed,
} from "./search-answers.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedForSearch();

const FIRST_PALLET_PASSAGE = palletPassage(0);

/** Answers each page of pallet without its first `withheld` matches, as a re-read after a change would. */
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
    it(`closes a passage a re-read drops, at ${String(width)} px`, async () => {
      atWidth(width);
      const { api, withheld } = withholding();
      const router = await openedSearch(api);
      await searched(router, "pallet");
      const whileListed = saidNow();
      pressed(firstOpener());
      const heading = await screen.findByRole("heading", { name: HANDBOOK });
      await focusLandsOn(() => heading, "the opened passage's heading did not take focus");
      expect((await screen.findByRole("blockquote")).textContent).toContain(FIRST_PALLET_PASSAGE);

      withheld.count = 1;
      refocused();

      await waitFor(() => expect(matchRows()).toHaveLength(A_PAGE - 1));
      expect(
        screen.queryByRole("heading", { name: HANDBOOK }),
        "the passage outlived its match",
      ).toBeNull();
      expect(saidNow(), "the page does not say its passage left").not.toBe(whileListed);
      const saidItLeft = saidNow();
      await focusLandsOn(searchHeading, "focus fell to the page with the passage");

      pressed(firstOpener());
      await focusLandsOn(
        () => screen.getByRole("heading", { name: HANDBOOK }),
        "the reopened passage's heading did not take focus",
      );
      expect(saidNow(), "the page still says a passage left").toBe(whileListed);

      searchBox().focus();
      withheld.count = 2;
      refocused();

      await waitFor(() => expect(matchRows()).toHaveLength(A_PAGE - 2));
      expect(saidNow()).toBe(saidItLeft);
      focusIsOn(searchBox(), "focus was taken from where the reader put it");

      typed("forklift");
      await waitFor(() => expect(saidNow()).toContain("forklift"));
      expect(matchRows()).toHaveLength(0);
      typed("pallet");
      await waitFor(() =>
        expect(saidNow(), "a search come back to still says a passage left").toBe(whileListed),
      );
    });
  }

  it("focuses Search when a re-read drops the focused match", async () => {
    const { api, withheld } = withholding();
    const router = await openedSearch(api);
    await searched(router, "pallet");
    firstOpener().focus();

    withheld.count = 1;
    refocused();

    await waitFor(() => expect(matchRows()).toHaveLength(A_PAGE - 1));
    await focusLandsOn(searchHeading, "focus fell to the page with its match");
  });
});
