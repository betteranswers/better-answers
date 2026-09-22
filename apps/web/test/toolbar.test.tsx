import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Toolbar, ViewPanel, ViewTabsRoot, type ViewToolbar } from "@/app/toolbar.tsx";

import { openApp } from "./open-app.tsx";

afterEach(cleanup);

const ROUTES_AND_SPEND = "/system/routes-and-spend";

const shellAt = async (path: string) => (await openApp(path)).router;

const tabs = () => screen.getByRole("tablist", { name: "Routes and spend" });

const openTab = () => within(tabs()).getByRole("tab", { selected: true }).textContent;

// The registry opens a tab where a pointer commits — the press — and not on the click.
const pick = (name: string) => fireEvent.mouseDown(within(tabs()).getByRole("tab", { name }));

const A_TABBED_VIEW: ViewToolbar = {
  tabs: [
    { id: "bindings-all", name: "All" },
    { id: "bindings-gone", name: "Gone at source" },
  ],
  acts: (
    <button type="button" className="border border-border px-3">
      Add a binding
    </button>
  ),
};

const ANOTHER_TABBED_VIEW: ViewToolbar = {
  tabs: [
    { id: "ceiling-spend", name: "Spend" },
    { id: "ceiling-limits", name: "Limits" },
  ],
};

describe("the toolbar the open view fills", () => {
  it("carries the open view's tabs in the view's own order, marking the open one selected", async () => {
    await shellAt(ROUTES_AND_SPEND);

    expect(
      within(tabs())
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Routes", "Spend"]);
    expect(openTab()).toBe("Routes");
  });

  it("opens the tab a reader picks, and says in words the one nobody has built", async () => {
    await shellAt(ROUTES_AND_SPEND);

    pick("Spend");

    expect(openTab()).toBe("Spend");
    expect(screen.getByText("Spend is not built yet.")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Routes" })).toBeNull();
    // A tab divides a view and not the screen, so the view's own words stand either way.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("System");
  });

  it("opens another view on its own first tab, never on the tab this one left open", () => {
    const shell = (toolbar: ViewToolbar, name: string) => (
      <ViewTabsRoot tabs={toolbar.tabs}>
        <Toolbar name={name} toolbar={toolbar} />
      </ViewTabsRoot>
    );
    const { rerender } = render(shell(A_TABBED_VIEW, "Bindings"));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Gone at source" }));
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Gone at source");

    rerender(shell(ANOTHER_TABBED_VIEW, "Ceiling"));

    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Spend");
  });

  it("gives the open tab a panel of its own to control, and the view inside it", async () => {
    await shellAt(ROUTES_AND_SPEND);

    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(
      within(tabs()).getByRole("tab", { name: "Routes" }).id,
    );
    expect(within(panel).getByRole("region", { name: "Routes" })).toBeDefined();
  });

  it("gives a view that declares neither tabs nor acts no toolbar and no panel", async () => {
    await shellAt("/system/health");

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("draws a view's tabs at the start of the toolbar and its acts at the end", () => {
    render(
      <ViewTabsRoot tabs={A_TABBED_VIEW.tabs}>
        <Toolbar name="Bindings" toolbar={A_TABBED_VIEW} />
        <ViewPanel>
          <p>The bindings.</p>
        </ViewPanel>
      </ViewTabsRoot>,
    );

    const list = screen.getByRole("tablist", { name: "Bindings" });
    const act = screen.getByRole("button", { name: "Add a binding" });

    expect(list.compareDocumentPosition(act) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("gives a view that declares acts and no tabs a toolbar with the acts alone", () => {
    render(<Toolbar name="Bindings" toolbar={{ acts: A_TABBED_VIEW.acts }} />);

    expect(screen.getByRole("button", { name: "Add a binding" })).toBeDefined();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
