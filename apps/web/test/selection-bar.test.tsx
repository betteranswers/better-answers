import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { placedWithoutMeasuring } from "./measuring.ts";
import { MembersList } from "./members-list.tsx";

placedWithoutMeasuring();

const bar = () => screen.queryByRole("toolbar", { name: "Selected members" });

const tick = (name: string) => {
  fireEvent.click(screen.getByRole("checkbox", { name: `Select ${name}` }));
};

const search = () => screen.getByRole("searchbox", { name: "Search by name or address" });

const searchFor = (value: string) => {
  fireEvent.change(search(), { target: { value } });
};

describe("the selection bar", () => {
  it("stands hidden until a row is ticked", () => {
    render(<MembersList />);

    expect(bar()).toBeNull();
    const standing = screen.getByRole("toolbar", { hidden: true });
    expect(standing.getAttribute("aria-label")).toBe("Selected members");
    expect(within(standing).getByRole("status", { hidden: true }).textContent).toBe("");
  });

  it("counts two ticked rows, and clearing hides it", () => {
    render(<MembersList />);

    tick("Ada Lovelace");
    tick("Bo Diddley");
    const shown = bar();
    expect(shown).not.toBeNull();
    expect(within(shown ?? document.body).getByRole("status").textContent).toBe(
      "2 members selected.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(bar()).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: "Select Ada Lovelace" }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("keeps a ticked row a search hides, and says so", () => {
    render(<MembersList />);

    tick("Ada Lovelace");
    tick("Bo Diddley");
    searchFor("Bo");
    expect(within(bar() ?? document.body).getByRole("status").textContent).toBe(
      "2 members selected, 1 not shown.",
    );

    searchFor("");
    expect(
      screen.getByRole("checkbox", { name: "Select Ada Lovelace" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("hosts the screen's bulk acts over every ticked row", () => {
    const acts: string[] = [];
    render(<MembersList pageSize={2} onAct={(act) => acts.push(act)} />);

    tick("Cy Twombly");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    tick("Ed Ruscha");
    fireEvent.click(within(bar() ?? document.body).getByRole("button", { name: "Change role" }));

    expect(acts).toEqual(["change the role of cy, ed"]);
  });

  it("clears on the screen's keystroke", () => {
    render(<MembersList />);

    tick("Ada Lovelace");
    const clear = screen.getByRole("button", { name: "Clear selection" });
    expect(clear.getAttribute("aria-keyshortcuts")).toBe("x");

    fireEvent.keyDown(document.body, { key: "x" });
    expect(bar()).toBeNull();
  });

  it("moves between its buttons by arrow keys, one tab stop", async () => {
    render(<MembersList />);
    tick("Ada Lovelace");
    const act = within(bar() ?? document.body).getByRole("button", { name: "Change role" });
    const clear = within(bar() ?? document.body).getByRole("button", { name: "Clear selection" });

    act.focus();
    fireEvent.keyDown(act, { key: "ArrowRight" });
    // The registry moves focus a task after the key.
    await waitFor(() => {
      expect(document.activeElement).toBe(clear);
    });
    expect([act.tabIndex, clear.tabIndex]).toEqual([-1, 0]);

    fireEvent.keyDown(clear, { key: "ArrowRight" });
    await waitFor(() => {
      expect(document.activeElement).toBe(act);
    });
  });

  it("hands focus inside it to the search when it clears", () => {
    render(<MembersList />);
    tick("Ada Lovelace");

    const clear = screen.getByRole("button", { name: "Clear selection" });
    clear.focus();
    fireEvent.click(clear);
    expect(bar()).toBeNull();
    expect(document.activeElement).toBe(search());

    tick("Ada Lovelace");
    within(bar() ?? document.body)
      .getByRole("button", { name: "Change role" })
      .focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "x" });
    expect(document.activeElement).toBe(search());
  });

  it("leaves focus outside it where it was", () => {
    render(<MembersList />);
    const ada = screen.getByRole("checkbox", { name: "Select Ada Lovelace" });
    fireEvent.click(ada);

    ada.focus();
    fireEvent.keyDown(ada, { key: "x" });
    expect(bar()).toBeNull();
    expect(document.activeElement).toBe(ada);
  });
});
