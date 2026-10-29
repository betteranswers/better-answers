import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MATCHES_A_PAGE as A_PAGE } from "@/features/knowledge/knowledge-state.ts";
import {
  aSearchApi,
  answeringFinds,
  type FindAsked,
  finding,
  findsAsked,
  focusIsOn,
  HANDBOOK,
  loadMore,
  loadMoreButton,
  matchRows,
  openedSearch,
  pageOf,
  palletPassage,
  PALLET_PASSAGES,
  placedForSearch,
  pressed,
  rowAt,
  saidNow,
  searchBox,
  searched,
  typed,
  withMoreHeld,
  FORKLIFT_LICENCES,
  listsOnly,
  textOfRows,
} from "@test/knowledge/search-answers.ts";
import { settlingAfter } from "@test/stubbed-api.ts";
import { read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedForSearch();

const repeatingTheFirstMatch = (asked: FindAsked) => {
  const page = pageOf(PALLET_PASSAGES, asked);
  return read(
    asked.cursor === undefined
      ? page
      : { ...page, matches: [PALLET_PASSAGES[0], ...page.matches.slice(1)] },
  );
};

const handbookRows = () => matchRows().filter((row) => row.textContent.includes(HANDBOOK));

describe("the Knowledge Search page", () => {
  it("loads more, and focus lands on the first new row", async () => {
    const api = aSearchApi();
    api.set("knowledge.find", finding({ pallet: PALLET_PASSAGES }));
    const router = await openedSearch(api);

    await searched(router, "pallet");
    expect(matchRows()).toHaveLength(A_PAGE);
    expect(loadMore()).not.toBeNull();
    const whileMoreFollow = saidNow();
    pressed(loadMoreButton());

    await waitFor(() => expect(matchRows()).toHaveLength(PALLET_PASSAGES.length));
    focusIsOn(rowAt(A_PAGE), "focus did not land on the first new match");
    expect(loadMore()).toBeNull();
    expect(saidNow(), "the status still says more follow").not.toBe(whileMoreFollow);
    expect(findsAsked()).toEqual([
      { query: "pallet", limit: A_PAGE },
      { query: "pallet", limit: A_PAGE, cursor: String(A_PAGE) },
    ]);
  });

  it("leaves focus where the reader moved it while More loads", async () => {
    const api = aSearchApi();
    const more = withMoreHeld(api, { pallet: PALLET_PASSAGES });
    const router = await openedSearch(api);
    await searched(router, "pallet");
    expect(matchRows()).toHaveLength(A_PAGE);
    pressed(loadMoreButton());
    await more.reached;
    searchBox().focus();

    more.release();

    await waitFor(() => expect(matchRows()).toHaveLength(PALLET_PASSAGES.length));
    focusIsOn(searchBox(), "the new rows took focus from the search box");
  });

  it("drops a match the next page repeats", async () => {
    const api = aSearchApi();
    api.set("knowledge.find", answeringFinds(repeatingTheFirstMatch));
    const router = await openedSearch(api);
    await searched(router, "pallet");

    pressed(loadMoreButton());

    await waitFor(() => expect(matchRows()).toHaveLength(PALLET_PASSAGES.length - 1));
    const keptInOrder = PALLET_PASSAGES.map((_, index) => index).filter(
      (index) => index !== A_PAGE,
    );
    expect(textOfRows(), "the repeat did not drop and the first appearance did not stay").toEqual(
      keptInOrder.map((index): unknown => expect.stringContaining(palletPassage(index))),
    );
    focusIsOn(rowAt(A_PAGE), "focus did not land on the first match the page added");
  });

  it("drops the old query's rows when More lands late", async () => {
    const api = aSearchApi();
    const more = withMoreHeld(api, { pallet: PALLET_PASSAGES, forklift: [FORKLIFT_LICENCES] });
    const router = await openedSearch(api);
    await searched(router, "pallet");
    expect(matchRows()).toHaveLength(A_PAGE);
    pressed(loadMoreButton());
    await more.reached;

    typed("forklift");
    await listsOnly("Forklift Licences");
    await settlingAfter(more.release);

    expect(textOfRows()).toEqual([expect.stringContaining("Forklift Licences")]);
    expect(handbookRows()).toHaveLength(0);
    typed("pallet");
    await waitFor(() => expect(matchRows()).toHaveLength(PALLET_PASSAGES.length));
  });
});
