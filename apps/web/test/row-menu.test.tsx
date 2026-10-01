import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RowMenu } from "@/shared/row-menu.tsx";

import { placedWithoutMeasuring } from "./measuring.ts";

placedWithoutMeasuring();

const NOTHING = () => undefined;

const act = (label: string, destructive?: boolean) => ({ label, destructive, onSelect: NOTHING });

/** The menu's items in the order a reader meets them, a separator drawn as a rule. */
const menuOf = (acts: readonly ReturnType<typeof act>[]) => {
  render(<RowMenu name="Ada Lovelace" acts={acts} />);
  // The registry's menus open on a key or a press, never on a click.
  fireEvent.keyDown(screen.getByRole("button", { name: "Acts for Ada Lovelace" }), {
    key: "Enter",
  });
  return [
    ...screen.getByRole("menu").querySelectorAll('[role="menuitem"], [role="separator"]'),
  ].map((item) => (item.getAttribute("role") === "separator" ? "—" : item.textContent));
};

describe("a row's menu", () => {
  it("draws a leading destructive act last, below a separator", () => {
    expect(menuOf([act("Remove from workspace", true), act("Open"), act("Change role")])).toEqual([
      "Open",
      "Change role",
      "—",
      "Remove from workspace",
    ]);
  });

  it("gathers interleaved destructive acts below one separator, in order", () => {
    const acts = [act("Open"), act("Remove", true), act("Change role"), act("Revoke", true)];

    expect(menuOf(acts)).toEqual(["Open", "Change role", "—", "Remove", "Revoke"]);
  });

  it("draws no separator when every act is destructive", () => {
    expect(menuOf([act("Remove", true), act("Revoke", true)])).toEqual(["Remove", "Revoke"]);
  });
});
