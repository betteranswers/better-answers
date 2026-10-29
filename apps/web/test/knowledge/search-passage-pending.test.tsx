import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FORBIDDEN, read } from "@test/two-workspaces.ts";

import {
  aForkliftGuide,
  aRackingPlan,
  aSearchApi,
  alerted,
  answeringFinds,
  atWidth,
  finding,
  FORKLIFT_GUIDE,
  focusIsOn,
  focusLandsOn,
  keyPressed,
  matchRows,
  openedSearch,
  openerIn,
  pageOf,
  passagePanel,
  placedForSearch,
  pressed,
  refusing,
  retryButton,
  rowNamed,
  said,
  saidNow,
  searchBox,
  searchHeading,
  searched,
  theForkliftGuide,
  typed,
  type Match,
  type Router,
  textOfRows,
  listsOnly,
} from "./search-answers.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedForSearch();

const TABLE: Readonly<Record<string, readonly Match[]>> = {
  pallet: [aForkliftGuide, aRackingPlan],
  forklift: [aForkliftGuide],
};

/** Answers pallet at once and holds the forklift list until `release`. */
const forkliftListHeld = () => {
  const reached = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  const api = aSearchApi();
  api.set(
    "knowledge.find",
    answeringFinds((asked) => {
      const answer = read(pageOf(TABLE[asked.query] ?? [], asked));
      if (asked.query !== "forklift") return answer;
      reached.resolve();
      return held.promise.then(() => answer);
    }),
  );
  api.set("knowledge.open", theForkliftGuide);
  return {
    api,
    reached: reached.promise,
    release: () => {
      held.resolve();
    },
  };
};

const passageClickedWhileTheListLoads = async (
  router: Router,
  forklift: ReturnType<typeof forkliftListHeld>,
) => {
  await searched(router, "pallet");
  expect(matchRows()).toHaveLength(2);
  typed("forklift");
  pressed(openerIn(rowNamed(FORKLIFT_GUIDE), FORKLIFT_GUIDE));
  await forklift.reached;
};

const passageOpenedWhileTheListLoads = async () => {
  const forklift = forkliftListHeld();
  const router = await openedSearch(forklift.api);
  await passageClickedWhileTheListLoads(router, forklift);
  const panel = await screen.findByRole("dialog", { name: FORKLIFT_GUIDE });
  await focusLandsOn(
    () => within(panel).getByRole("heading", { name: FORKLIFT_GUIDE }),
    "the opened passage's heading did not take focus",
  );
  expect(matchRows(), "the opener is still on the page while the list loads").toHaveLength(0);
  return { panel, release: forklift.release };
};

describe("a passage opened while the list changes", () => {
  for (const width of [320, 1280]) {
    it(`keeps open a passage clicked before settling, at ${String(width)} px`, async () => {
      atWidth(width);
      const forklift = forkliftListHeld();
      const router = await openedSearch(forklift.api);
      await passageClickedWhileTheListLoads(router, forklift);

      forklift.release();

      await waitFor(() => expect(textOfRows()).toEqual([expect.stringContaining(FORKLIFT_GUIDE)]));
      await focusLandsOn(
        () => screen.getByRole("heading", { name: FORKLIFT_GUIDE }),
        "the passage clicked closed as the typed search settled",
      );
    });
  }

  it("leaves the reader's focus alone when the pending list lands", async () => {
    atWidth(320);
    const forklift = forkliftListHeld();
    const router = await openedSearch(forklift.api);
    await passageClickedWhileTheListLoads(router, forklift);
    searchBox().focus();

    forklift.release();

    await waitFor(() =>
      expect(
        within(rowNamed(FORKLIFT_GUIDE)).getByRole("region", { name: FORKLIFT_GUIDE }),
      ).toBeDefined(),
    );
    focusIsOn(searchBox(), "the landed passage took focus from the reader");
  });

  it("puts focus on Search when Escape closes the panel mid-load", async () => {
    const { panel, release } = await passageOpenedWhileTheListLoads();

    keyPressed("Escape");
    await waitFor(() => expect(panel.isConnected).toBe(false));
    release();

    await listsOnly(FORKLIFT_GUIDE);
    await focusLandsOn(searchHeading, "Escape left focus on the page");
  });

  for (const [width, landsOn] of [
    [320, "Search"],
    [1280, FORKLIFT_GUIDE],
  ] as const) {
    it(`keeps the passage through a failed list, at ${String(width)} px`, async () => {
      atWidth(width);
      const api = aSearchApi();
      api.set("knowledge.find", finding(TABLE));
      api.set("knowledge.open", theForkliftGuide);
      const router = await openedSearch(api);
      await searched(router, "pallet");
      expect(matchRows()).toHaveLength(2);
      api.set("knowledge.find", answeringFinds(refusing(FORBIDDEN)));

      typed("forklift");
      pressed(openerIn(rowNamed(FORKLIFT_GUIDE), FORKLIFT_GUIDE));

      await waitFor(() => expect(alerted()?.textContent, "the alert says nothing").toMatch(/\S/));
      await focusLandsOn(
        () => screen.getByRole("heading", { name: landsOn }),
        "a failed list left focus on the page",
      );
      api.set("knowledge.find", finding(TABLE));
      pressed(retryButton());

      await listsOnly(FORKLIFT_GUIDE);
      expect(
        screen.getByRole("heading", { name: FORKLIFT_GUIDE }),
        "a failed list closed the passage it never dropped",
      ).toBeDefined();
    });
  }

  it("closes a passage opened as the search empties", async () => {
    const api = aSearchApi();
    api.set("knowledge.find", finding(TABLE));
    api.set("knowledge.open", theForkliftGuide);
    const router = await openedSearch(api);
    await waitFor(() => expect(said().textContent).toMatch(/\S/));
    const nothingAsked = saidNow();
    await searched(router, "forklift");

    typed("");
    pressed(openerIn(rowNamed(FORKLIFT_GUIDE), FORKLIFT_GUIDE));

    await waitFor(() =>
      expect(
        passagePanel(FORKLIFT_GUIDE),
        "a passage stayed open beside an empty search",
      ).toBeNull(),
    );
    expect(saidNow(), "emptying the search said more than nothing asked").toBe(nothingAsked);
    await focusLandsOn(
      searchHeading,
      "the passage closed under an emptied search left focus on the page",
    );
  });
});
