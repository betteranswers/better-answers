import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  MATCHES_A_PAGE as A_PAGE,
  SEARCH_KEYSTROKES as KEY,
} from "@/features/knowledge/knowledge-state.ts";
import { SEARCH_WORDS } from "@/features/knowledge/knowledge-words.ts";
import { SEARCH_PAGE as SEARCH } from "@/shared/knowledge/concept-address.ts";

import {
  aConceptRead,
  aForkliftGuide,
  aSearchApi,
  answeringConcepts,
  finding,
  focusLandsOn,
  FORKLIFT_GUIDE,
  HANDBOOK,
  keyPressed,
  matchRows,
  openedSearch,
  openerIn,
  PALLET_PASSAGES,
  passagePanel,
  placedForSearch,
  pressed,
  rowAt,
  rowNamed,
  saidNow,
  searched,
  searchBox,
  searchHeading,
  theForkliftGuide,
  typed,
  AUDIT_COMMITTEE,
  AUDIT_LOGS_RETENTION,
  FORKLIFT_LICENCES,
  listsOnly,
  palletsFound,
} from "./search-answers.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedForSearch();

const noMatchWasInFocus = async (listed: string) => {
  keyPressed(KEY.open.key);
  await waitFor(() =>
    expect(saidNow(), "the page says nothing of a key that opened nothing").toBe(
      `${listed} ${SEARCH_WORDS.selectFirst}`,
    ),
  );
};

describe("the Knowledge Search page", () => {
  it("opens the focused match by key, else says none is", async () => {
    const api = aSearchApi();
    api.set(
      "knowledge.find",
      finding({ forklift: [FORKLIFT_LICENCES], audit: [AUDIT_LOGS_RETENTION, AUDIT_COMMITTEE] }),
    );
    api.set(
      "knowledge.open",
      answeringConcepts(() => aConceptRead("Forklift Licences", 4)),
    );
    const router = await openedSearch(api);
    await searched(router, "forklift");
    const listed = saidNow();

    searchHeading().focus();
    await noMatchWasInFocus(listed);
    expect(router.state.location.pathname).toBe(SEARCH.path);
    await searched(router, "audit");
    await searched(router, "forklift");
    expect(saidNow(), "the page still says no match was in focus").toBe(listed);

    within(rowAt(0)).getByRole("link", { name: "Forklift Licences" }).focus();
    keyPressed(KEY.open.key);

    expect(
      await screen.findByRole("heading", { level: 2, name: "Forklift Licences" }),
    ).toBeDefined();
    expect(router.state.location.pathname).not.toBe(SEARCH.path);
  });

  it("opens nothing by key after focus leaves the match", async () => {
    const api = aSearchApi();
    api.set("knowledge.find", finding({ forklift: [aForkliftGuide] }));
    api.set("knowledge.open", theForkliftGuide);
    const router = await openedSearch(api);
    await searched(router, "forklift");
    const listed = saidNow();
    const row = rowAt(0);

    openerIn(row, FORKLIFT_GUIDE).focus();
    searchHeading().focus();

    await noMatchWasInFocus(listed);
    expect(passagePanel(FORKLIFT_GUIDE)).toBeNull();

    pressed(openerIn(row, FORKLIFT_GUIDE));
    expect(await screen.findByRole("dialog", { name: FORKLIFT_GUIDE })).toBeDefined();
    expect(saidNow(), "the page still says to select a match beside the one opened").toBe(listed);
  });

  it("opens the match focus landed on after More", async () => {
    await palletsFound();
    searchHeading().focus();

    keyPressed(KEY.more.key);

    await waitFor(() => expect(matchRows()).toHaveLength(PALLET_PASSAGES.length));
    const landed = rowAt(A_PAGE);
    await focusLandsOn(() => landed, "focus did not land on the first new match");
    keyPressed(KEY.open.key);

    await waitFor(() =>
      expect(openerIn(landed, HANDBOOK).getAttribute("aria-expanded")).toBe("true"),
    );
  });

  it("keeps the typed search for a concept opened before settling", async () => {
    const api = aSearchApi();
    api.set(
      "knowledge.find",
      finding({ audit: [AUDIT_LOGS_RETENTION, AUDIT_COMMITTEE], forklift: [FORKLIFT_LICENCES] }),
    );
    api.set(
      "knowledge.open",
      answeringConcepts(() => aConceptRead("Audit Committee", 2)),
    );
    const router = await openedSearch(api);
    await searched(router, "audit");

    typed("forklift");
    pressed(within(rowNamed("Audit Committee")).getByRole("link", { name: "Audit Committee" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Audit Committee" })).toBeDefined();
    pressed(within(screen.getByRole("main")).getByRole("link", { name: "Back to Search" }));

    await waitFor(() =>
      expect(searchBox().value, "the typed search was lost on the way back").toBe("forklift"),
    );
    await listsOnly("Forklift Licences");
    await focusLandsOn(searchHeading, "focus fell to the page on the way back");
  });
});
