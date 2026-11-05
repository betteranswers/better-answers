import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RowMenu } from "@/shared/list/row-menu.tsx";
import { placedWithoutMeasuring } from "@test/measuring.ts";

placedWithoutMeasuring();

const NOTHING = () => undefined;

const action = (label: string, destructive?: boolean) => ({
  label,
  destructive,
  onSelect: NOTHING,
});

const openMenuItems = (actions: readonly ReturnType<typeof action>[]) => {
  render(<RowMenu name="Ada Lovelace" actions={actions} />);
  // The menus open on a key or pointer press, never on a click.
  fireEvent.keyDown(screen.getByRole("button", { name: "Actions for Ada Lovelace" }), {
    key: "Enter",
  });
  return [
    ...screen.getByRole("menu").querySelectorAll('[role="menuitem"], [role="separator"]'),
  ].map((item) => (item.getAttribute("role") === "separator" ? "—" : item.textContent));
};

describe("a row's menu", () => {
  it("moves a leading destructive action last, below a separator", () => {
    expect(
      openMenuItems([action("Remove from workspace", true), action("Open"), action("Change Role")]),
    ).toEqual(["Open", "Change Role", "—", "Remove from workspace"]);
  });

  it("gathers interleaved destructive actions below one separator, in order", () => {
    const actions = [
      action("Open"),
      action("Remove", true),
      action("Change Role"),
      action("Revoke", true),
    ];

    expect(openMenuItems(actions)).toEqual(["Open", "Change Role", "—", "Remove", "Revoke"]);
  });

  it("shows no separator when every action is destructive", () => {
    expect(openMenuItems([action("Remove", true), action("Revoke", true)])).toEqual([
      "Remove",
      "Revoke",
    ]);
  });

  it("moves focus to the target a row-removing action names", async () => {
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

  it("returns focus to the trigger after any other action", async () => {
    render(<RowMenu name="Ada Lovelace" actions={[action("Resend")]} />);
    const trigger = screen.getByRole("button", { name: "Actions for Ada Lovelace" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Resend" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});
