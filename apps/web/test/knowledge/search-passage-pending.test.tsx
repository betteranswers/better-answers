import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  aForkliftGuide,
  aRackingPlan,
  aSearchApi,
  searchAlert,
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
  searchStatusText,
  searchBox,
  searchHeading,
  searched,
  theForkliftGuide,
  typed,
  type Match,
  type Router,
  textOfRows,
  listsOnly,
} from "@test/knowledge/search-answers.ts";
import { FORBIDDEN, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedForSearch();

const TABLE: Readonly<Record<string, readonly Match[]>> = {
  pallet: [aForkliftGuide, aRackingPlan],
  forklift: [aForkliftGuide],
};

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
  expect(matchRows(), "the opener stayed on the page while the list loaded").toHaveLength(0);
  return { panel, release: forklift.release };
};

describe("the Knowledge Search page", () => {
  for (const width of [320, 1280]) {
    it(`keeps a passage clicked mid-search open, at ${String(width)} px`, async () => {
      atWidth(width);
      const forklift = forkliftListHeld();
      const router = await openedSearch(forklift.api);
      await passageClickedWhileTheListLoads(router, forklift);

      forklift.release();

      await waitFor(() => expect(textOfRows()).toEqual([expect.stringContaining(FORKLIFT_GUIDE)]));
      await focusLandsOn(
        () => screen.getByRole("heading", { name: FORKLIFT_GUIDE }),
        "the clicked passage closed when the search finished",
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
    it(`keeps the passage when the list fails, at ${String(width)} px`, async () => {
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

      await waitFor(() =>
        expect(searchAlert()?.textContent, "the alert says nothing").toMatch(/\S/),
      );
      await focusLandsOn(
        () => screen.getByRole("heading", { level: 2, name: landsOn }),
        "focus fell to the page body when the list failed",
      );
      api.set("knowledge.find", finding(TABLE));
      pressed(retryButton());

      await listsOnly(FORKLIFT_GUIDE);
      expect(
        screen.getByRole("heading", { name: FORKLIFT_GUIDE }),
        "the failed list closed the open passage",
      ).toBeDefined();
    });
  }

  it("closes a passage opened as the search is cleared", async () => {
    const api = aSearchApi();
    api.set("knowledge.find", finding(TABLE));
    api.set("knowledge.open", theForkliftGuide);
    const router = await openedSearch(api);
    const nothingAsked = searchStatusText();
    await searched(router, "forklift");

    typed("");
    pressed(openerIn(rowNamed(FORKLIFT_GUIDE), FORKLIFT_GUIDE));

    await waitFor(() =>
      expect(
        passagePanel(FORKLIFT_GUIDE),
        "a passage stayed open beside an empty search",
      ).toBeNull(),
    );
    expect(searchStatusText(), "clearing the search changed the empty-search status").toBe(
      nothingAsked,
    );
    await focusLandsOn(searchHeading, "focus fell to the page body when the passage closed");
  });
});
