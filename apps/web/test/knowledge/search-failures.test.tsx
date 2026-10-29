import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MATCHES_A_PAGE as A_PAGE } from "@/features/knowledge/knowledge-state.ts";
import { heldBack } from "@test/stubbed-api.ts";
import { FORBIDDEN, read } from "@test/two-workspaces.ts";

import {
  aCeilingMet,
  aMoment,
  aSearchApi,
  alerted,
  answeringFinds,
  answeringPassages,
  finding,
  findsAsked,
  focusIsOn,
  focusLandsOn,
  HANDBOOK,
  keyPressed,
  loadMoreButton,
  matchRows,
  openedSearch,
  openerIn,
  opensAsked,
  pageOf,
  PALLET_PASSAGES,
  passagePanel,
  placedForSearch,
  pressed,
  refocused,
  refusing,
  retryButton,
  rowAt,
  saidNow,
  searchBox,
  typed,
  type FindAsked,
  palletsFound,
} from "./search-answers.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedForSearch();

/** The first page answers; every page after it is refused. */
const moreRefused = (asked: FindAsked) =>
  asked.cursor === undefined ? read(pageOf(PALLET_PASSAGES, asked)) : FORBIDDEN;

const saysTheWait = (alert: HTMLElement | null, minutes: number) =>
  expect(alert?.textContent, `the alert does not say a wait of ${String(minutes)} minutes`).toMatch(
    new RegExp(String.raw`\b${String(minutes)}\b`),
  );

const saysSomething = (alert: HTMLElement | null) =>
  expect(alert?.textContent, "the alert says nothing").toMatch(/\S/);

describe("the Knowledge Search page", () => {
  it("says the reads' ceiling and asks no more", async () => {
    const { api } = await palletsFound();
    api.set("knowledge.find", answeringFinds(refusing(aCeilingMet(180))));

    typed("forklift");

    await waitFor(() => saysTheWait(alerted(), 3));
    refocused();
    await aMoment();
    expect(
      findsAsked().filter((asked) => asked.query === "forklift"),
      "the page asked again past the ceiling",
    ).toHaveLength(1);
  });

  it("asks a passage at its ceiling again only when pressed", async () => {
    const { api } = await palletsFound();
    const unread = openerIn(rowAt(0), HANDBOOK);
    const wasRead = openerIn(rowAt(1), HANDBOOK);
    const closed = async () => {
      keyPressed("Escape");
      await waitFor(() => expect(passagePanel(HANDBOOK)).toBeNull());
    };
    const waits = async () => {
      const panel = await screen.findByRole("dialog", { name: HANDBOOK });
      await waitFor(() => saysTheWait(within(panel).getByRole("alert"), 1));
    };
    pressed(wasRead);
    await waitFor(() => expect(screen.getByRole("blockquote").textContent).toContain("Pallet bay"));
    await closed();
    const before = opensAsked();
    api.set("knowledge.open", answeringPassages(refusing(aCeilingMet(60))));

    for (const opener of [unread, wasRead]) {
      pressed(opener);
      await waits();
      await closed();
      pressed(opener);
      await waits();
      await closed();
    }
    pressed(wasRead);
    await waits();
    refocused();
    await aMoment();

    expect(opensAsked() - before, "a passage was asked for again while its wait ran").toBe(2);
  });

  it("offers a retry when the first read fails", async () => {
    const api = aSearchApi();
    api.set("knowledge.find", answeringFinds(refusing(FORBIDDEN)));
    await openedSearch(api);

    typed("pallet");

    await waitFor(() => saysSomething(alerted()));
    expect(saidNow(), "a failed read says something beside its alert").toBe("");
    api.set("knowledge.find", finding({ pallet: PALLET_PASSAGES }));
    pressed(retryButton());

    await waitFor(() => expect(matchRows()).toHaveLength(A_PAGE));
    expect(alerted()).toBeNull();
    focusIsOn(searchBox(), "Retry left focus on the page");
  });

  it("keeps the shown rows when More fails, and retries it", async () => {
    const { api } = await palletsFound();
    api.set("knowledge.find", answeringFinds(moreRefused));
    expect(matchRows()).toHaveLength(A_PAGE);

    pressed(loadMoreButton());
    await waitFor(() => saysSomething(alerted()));
    expect(matchRows()).toHaveLength(A_PAGE);

    const retrying = heldBack(api, "knowledge.find");
    pressed(retryButton());
    await retrying.asked;
    await waitFor(() => expect(alerted()).toBeNull());
    retrying.reject(FORBIDDEN);
    await waitFor(() => saysSomething(alerted()));
    focusIsOn(retryButton(), "a failed Retry took focus from the button");

    api.set("knowledge.find", finding({ pallet: PALLET_PASSAGES }));
    pressed(retryButton());
    await waitFor(() => expect(matchRows()).toHaveLength(PALLET_PASSAGES.length));
    expect(alerted()).toBeNull();
    await focusLandsOn(
      () => rowAt(A_PAGE),
      "the retried page did not land focus on its first match",
    );
  });
});
