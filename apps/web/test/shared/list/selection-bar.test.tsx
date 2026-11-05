import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { placedWithoutMeasuring } from "@test/measuring.ts";
import { MembersList } from "@test/members-list.tsx";

placedWithoutMeasuring();

const queryBar = () => screen.queryByRole("toolbar", { name: "Selected Members" });

const getBar = () => screen.getByRole("toolbar", { name: "Selected Members" });

const countsIn = (shown: HTMLElement | null): readonly string[] =>
  within(shown ?? document.body)
    .getByRole("status")
    .textContent.match(/\d+/g) ?? [];

const select = (name: string) => {
  fireEvent.click(screen.getByRole("checkbox", { name: `Select ${name}` }));
};

const search = () => screen.getByRole("searchbox", { name: "Search by name or address" });

const searchFor = (value: string) => {
  fireEvent.change(search(), { target: { value } });
};

describe("the selection bar", () => {
  it("stays hidden until a row is selected", () => {
    render(<MembersList />);

    expect(queryBar()).toBeNull();
    const toolbar = screen.getByRole("toolbar", { hidden: true });
    expect(toolbar.getAttribute("aria-label")).toBe("Selected Members");
    expect(within(toolbar).getByRole("status", { hidden: true }).textContent).toBe("");
  });

  it("counts two selected rows and hides after clearing", () => {
    render(<MembersList />);

    select("Ada Lovelace");
    select("Bo Diddley");
    const shown = queryBar();
    expect(shown).not.toBeNull();
    expect(countsIn(shown)).toEqual(["2"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear Selection" }));
    expect(queryBar()).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: "Select Ada Lovelace" }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("keeps and counts selected rows a search hides", () => {
    render(<MembersList />);

    select("Ada Lovelace");
    select("Bo Diddley");
    searchFor("Bo");
    expect(countsIn(queryBar())).toEqual(["2", "1"]);

    searchFor("");
    expect(
      screen.getByRole("checkbox", { name: "Select Ada Lovelace" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("runs bulk actions on selected rows across pages", () => {
    const actions: string[] = [];
    render(<MembersList pageSize={2} onAction={(action) => actions.push(action)} />);

    select("Cy Twombly");
    fireEvent.click(screen.getByRole("button", { name: "Next Page" }));
    select("Ed Ruscha");
    fireEvent.click(within(getBar()).getByRole("button", { name: "Change Role" }));

    expect(actions).toEqual(["change the role of cy, ed"]);
  });

  it("clears the selection with the x keystroke", () => {
    render(<MembersList />);

    select("Ada Lovelace");
    const clear = screen.getByRole("button", { name: "Clear Selection" });
    expect(clear.getAttribute("aria-keyshortcuts")).toBe("x");

    fireEvent.keyDown(document.body, { key: "x" });
    expect(queryBar()).toBeNull();
  });

  it("moves between buttons with arrow keys as one tab stop", async () => {
    render(<MembersList />);
    select("Ada Lovelace");
    const action = within(getBar()).getByRole("button", { name: "Change Role" });
    const clear = within(getBar()).getByRole("button", { name: "Clear Selection" });

    action.focus();
    fireEvent.keyDown(action, { key: "ArrowRight" });
    await waitFor(() => {
      expect(document.activeElement).toBe(clear);
    });
    expect([action.tabIndex, clear.tabIndex]).toEqual([-1, 0]);

    fireEvent.keyDown(clear, { key: "ArrowRight" });
    await waitFor(() => {
      expect(document.activeElement).toBe(action);
    });
  });

  it("moves focus inside the bar to search on clear", () => {
    render(<MembersList />);
    select("Ada Lovelace");

    const clear = screen.getByRole("button", { name: "Clear Selection" });
    clear.focus();
    fireEvent.click(clear);
    expect(queryBar()).toBeNull();
    expect(document.activeElement).toBe(search());

    select("Ada Lovelace");
    const changeRole = within(getBar()).getByRole("button", { name: "Change Role" });
    changeRole.focus();
    expect(document.activeElement).toBe(changeRole);
    fireEvent.keyDown(changeRole, { key: "x" });
    expect(document.activeElement).toBe(search());
  });

  it("leaves focus outside the bar unchanged on clear", () => {
    render(<MembersList />);
    const ada = screen.getByRole("checkbox", { name: "Select Ada Lovelace" });
    fireEvent.click(ada);

    ada.focus();
    fireEvent.keyDown(ada, { key: "x" });
    expect(queryBar()).toBeNull();
    expect(document.activeElement).toBe(ada);
  });
});
