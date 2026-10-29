import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SELECT_A_CONNECTED_SOURCE_FIRST } from "@/features/sources/words.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";

import {
  aConnectedSource,
  anAdminWith,
  connectedSourcesRegion,
  openSources,
  press,
  reviewOf,
  rowAction,
  rowOf,
} from "./stubbed-sources.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const keystrokesButton = () => screen.getByRole("button", { name: "Keyboard Shortcuts" });

describe("the Sources page's keystrokes", () => {
  it("drops the select-first line once a key acts", async () => {
    await openSources(anAdminWith(aConnectedSource("Supplier forms")));
    const row = await rowOf("Supplier forms");
    const said = () =>
      within(connectedSourcesRegion()).queryAllByText(SELECT_A_CONNECTED_SOURCE_FIRST);
    keystrokesButton().focus();

    press("n");
    expect(said(), "n with no connected source in focus said nothing").toHaveLength(1);

    rowAction(row, "narrow").focus();
    press("n");
    expect(rowAction(row, "narrow").getAttribute("aria-expanded")).toBe("true");
    expect(said(), "the select-first line outlived the narrow").toHaveLength(0);
  });

  it("acts on no source by key once focus leaves", async () => {
    await openSources(anAdminWith(aConnectedSource("Supplier forms")));
    const row = await rowOf("Supplier forms");
    const saying = () =>
      within(connectedSourcesRegion())
        .getAllByRole("status")
        .filter((status) => /\S/v.test(status.textContent));
    const atRest = saying().length;
    rowAction(row, "review").focus();
    keystrokesButton().focus();

    for (const key of ["r", "p", "n", "w"]) press(key);

    expect(screen.queryByRole("dialog"), "a key published a source not in focus").toBeNull();
    expect(reviewOf("Supplier forms")).toBeNull();
    expect(saying(), "a key with no connected source in focus said nothing").toHaveLength(
      atRest + 1,
    );
    for (const action of ["narrow", "widen"] as const) {
      expect(rowAction(row, action).getAttribute("aria-expanded")).toBe("false");
    }
  });
});
