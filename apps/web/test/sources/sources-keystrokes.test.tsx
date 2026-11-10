import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
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
} from "@test/sources/stubbed-sources.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const keystrokesButton = () => screen.getByRole("button", { name: KEYSTROKE_WORDS.button });

const messagesShown = () =>
  within(connectedSourcesRegion())
    .getAllByRole("status")
    .filter((status) => /\S/v.test(status.textContent));

describe("the Sources page's keystrokes", () => {
  it("clears the select-a-source message once a key acts", async () => {
    await openSources(anAdminWith(aConnectedSource("Supplier forms")));
    const row = await rowOf("Supplier forms");
    const atRest = messagesShown().length;
    keystrokesButton().focus();

    press("n");
    expect(messagesShown(), "n with no source in focus showed no message").toHaveLength(atRest + 1);

    rowAction(row, "narrow").focus();
    press("n");
    expect(rowAction(row, "narrow").getAttribute("aria-expanded")).toBe("true");
    expect(messagesShown(), "the message stayed after n opened the Narrow panel").toHaveLength(
      atRest,
    );
  });

  it("ignores action keys when no source has focus", async () => {
    await openSources(anAdminWith(aConnectedSource("Supplier forms")));
    const row = await rowOf("Supplier forms");
    const atRest = messagesShown().length;
    rowAction(row, "review").focus();
    keystrokesButton().focus();

    for (const key of ["r", "p", "n", "w"]) press(key);

    expect(
      screen.queryByRole("dialog"),
      "p opened the Publish dialog with no source in focus",
    ).toBeNull();
    expect(reviewOf("Supplier forms")).toBeNull();
    expect(messagesShown(), "the keys showed no message, or more than one").toHaveLength(
      atRest + 1,
    );
    for (const action of ["narrow", "widen"] as const) {
      expect(rowAction(row, action).getAttribute("aria-expanded")).toBe("false");
    }
  });
});
