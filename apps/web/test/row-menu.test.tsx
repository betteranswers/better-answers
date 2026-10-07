import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RowMenu } from "@/shared/row-menu.tsx";

import { placedWithoutMeasuring } from "./measuring.ts";

placedWithoutMeasuring();

const NOTHING = () => undefined;

const action = (label: string, destructive?: boolean) => ({
  label,
  destructive,
  onSelect: NOTHING,
});

/** The menu's items in the order a reader meets them, a separator drawn as a rule. */
const menuOf = (actions: readonly ReturnType<typeof action>[]) => {
  render(<RowMenu name="Ada Lovelace" actions={actions} />);
  // The registry's menus open on a key or a press, never on a click.
  fireEvent.keyDown(screen.getByRole("button", { name: "Actions for Ada Lovelace" }), {
    key: "Enter",
  });
  return [
    ...screen.getByRole("menu").querySelectorAll('[role="menuitem"], [role="separator"]'),
  ].map((item) => (item.getAttribute("role") === "separator" ? "—" : item.textContent));
};

describe("a row's menu", () => {
  it("draws a leading destructive action last, below a separator", () => {
    expect(
      menuOf([action("Remove from workspace", true), action("Open"), action("Change role")]),
    ).toEqual(["Open", "Change role", "—", "Remove from workspace"]);
  });

  it("gathers interleaved destructive actions below one separator, in order", () => {
    const actions = [
      action("Open"),
      action("Remove", true),
      action("Change role"),
      action("Revoke", true),
    ];

    expect(menuOf(actions)).toEqual(["Open", "Change role", "—", "Remove", "Revoke"]);
  });

  it("draws no separator when every action is destructive", () => {
    expect(menuOf([action("Remove", true), action("Revoke", true)])).toEqual(["Remove", "Revoke"]);
  });

  it("lands focus where an action that took its row asks", async () => {
    render(
      <>
        <h2 tabIndex={-1}>Invitations</h2>
        <RowMenu
          name="Ada Lovelace"
          actions={[
            { label: "Resend", onSelect: NOTHING },
            {
              label: "Cancel",
              destructive: true,
              onSelect: NOTHING,
              focusAfter: () => screen.getByRole("heading", { name: "Invitations" }),
            },
          ]}
        />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Actions for Ada Lovelace" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Cancel" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Invitations" }));
    });
  });

  it("hands focus back to its trigger after any other action", async () => {
    render(<RowMenu name="Ada Lovelace" actions={[action("Resend")]} />);
    const trigger = screen.getByRole("button", { name: "Actions for Ada Lovelace" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Resend" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});
