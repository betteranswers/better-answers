import { CatchBoundary } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Toolbar, ViewPanel, ViewTabsRoot } from "@/app/toolbar.tsx";
import { viewStateOf, type ViewToolbar } from "@/shared/view-toolbar.tsx";

import { openApp } from "./open-app.tsx";

afterEach(cleanup);

const ROUTES_AND_SPEND = "/system/routes-and-spend";

const shellAt = async (path: string) => (await openApp(path)).router;

const tabs = () => screen.getByRole("tablist", { name: "Routes and spend" });

const openTab = () => within(tabs()).getByRole("tab", { selected: true }).textContent;

/** The registry opens a tab where a pointer commits — the press — and not on the click. */
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

/**
 * One helper of the feature's own, called by its content and by its acts: the shared slot
 * never learns the type.
 */
const useTickedGroups = viewStateOf<number>("/bindings/review");

const useAnotherViewsTickedGroups = viewStateOf<number>("/bindings/all");

function NarrowAct() {
  const [ticked] = useTickedGroups();

  // Inert on an empty slot, which is the act's own property and what makes a thrown view safe.
  return (
    <button type="button" disabled={ticked === undefined}>
      {ticked === undefined ? "Narrow these documents" : `Narrow ${ticked} documents`}
    </button>
  );
}

function AnotherViewsAct() {
  const [ticked] = useAnotherViewsTickedGroups();

  return (
    <button type="button" disabled={ticked === undefined}>
      Narrow another view's documents
    </button>
  );
}

function ReviewView(properties: { readonly throwsOnATick: boolean }) {
  const [ticked, tick] = useTickedGroups();
  if (properties.throwsOnATick && ticked !== undefined) throw new Error("the view's own bug");

  return (
    <button type="button" onClick={() => tick(2)}>
      Tick two groups
    </button>
  );
}

const A_REVIEW_VIEW: ViewToolbar = {
  tabs: [
    { id: "review-open", name: "Open" },
    { id: "review-done", name: "Done" },
  ],
  /** Built once, the way a route's static data is, and live on every render all the same. */
  acts: (
    <>
      <NarrowAct />
      <AnotherViewsAct />
    </>
  ),
};

const drawReview = (throwsOnATick: boolean) =>
  render(
    <ViewTabsRoot tabs={A_REVIEW_VIEW.tabs}>
      <Toolbar name="Review" toolbar={A_REVIEW_VIEW} />
      <ViewPanel>
        <CatchBoundary
          getResetKey={() => "the panel's own subtree"}
          errorComponent={() => <p>The view failed to draw.</p>}
        >
          <ReviewView throwsOnATick={throwsOnATick} />
        </CatchBoundary>
      </ViewPanel>
    </ViewTabsRoot>,
  );

const narrowAct = () => screen.getByRole("button", { name: /^Narrow (these|\d)/ });

const anotherViewsAct = () =>
  screen.getByRole("button", { name: "Narrow another view's documents" });

const reviewTab = (name: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name, selected: false }));

describe("the toolbar the open view fills", () => {
  it("carries the view's tabs in order, the open one selected", async () => {
    await shellAt(ROUTES_AND_SPEND);

    expect(
      within(tabs())
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Routes", "Spend"]);
    expect(openTab()).toBe("Routes");
  });

  it("opens the picked tab, and says when it is unbuilt", async () => {
    await shellAt(ROUTES_AND_SPEND);

    pick("Spend");

    expect(openTab()).toBe("Spend");
    expect(screen.getByText("Spend is not built yet.")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Routes" })).toBeNull();
    // A tab divides a view and not the screen, so the view's own words stand either way.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("System");
  });

  it("opens another view on its own first tab", () => {
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

  it("gives the open tab its own panel, holding the view", async () => {
    await shellAt(ROUTES_AND_SPEND);

    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(
      within(tabs()).getByRole("tab", { name: "Routes" }).id,
    );
    expect(within(panel).getByRole("region", { name: "Routes" })).toBeDefined();
  });

  it("draws no toolbar or panel without tabs or acts", async () => {
    await shellAt("/system/health");

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("draws a view's tabs before its acts in the toolbar", () => {
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

  it("draws only the acts for a view without tabs", () => {
    render(<Toolbar name="Bindings" toolbar={{ acts: A_TABBED_VIEW.acts }} />);

    expect(screen.getByRole("button", { name: "Add a binding" })).toBeDefined();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

describe("the slot a view writes and its acts read", () => {
  it("gives an act what its own view wrote, not another's", () => {
    drawReview(false);

    expect(narrowAct().textContent).toBe("Narrow these documents");
    expect(narrowAct().hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Tick two groups" }));

    expect(narrowAct().textContent).toBe("Narrow 2 documents");
    expect(narrowAct().hasAttribute("disabled")).toBe(false);
    expect(anotherViewsAct().hasAttribute("disabled")).toBe(true);
  });

  it("empties the slot when a view that threw is reopened", () => {
    drawReview(true);

    fireEvent.click(screen.getByRole("button", { name: "Tick two groups" }));

    expect(screen.getByText("The view failed to draw.")).toBeDefined();
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Open");

    reviewTab("Done");
    reviewTab("Open");

    expect(screen.getByRole("button", { name: "Tick two groups" })).toBeDefined();
    expect(narrowAct().textContent).toBe("Narrow these documents");
    expect(narrowAct().hasAttribute("disabled")).toBe(true);
  });
});
