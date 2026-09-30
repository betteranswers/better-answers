import { CatchBoundary } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Toolbar, ScreenPanel, ScreenTabsRoot } from "@/app/toolbar.tsx";
import { viewStateOf, type ScreenToolbar } from "@/shared/screen-toolbar.tsx";

import { openApp } from "./open-app.tsx";

afterEach(cleanup);

const ROUTES_AND_SPEND = "/agent-operations/routes-and-spend";

const shellAt = async (path: string) => (await openApp(path)).router;

const tabs = () => screen.getByRole("tablist", { name: "Routes and spend" });

const openTab = () => within(tabs()).getByRole("tab", { selected: true }).textContent;

/** The registry opens a tab where a pointer commits — the press — and not on the click. */
const pick = (name: string) => fireEvent.mouseDown(within(tabs()).getByRole("tab", { name }));

const A_TABBED_SCREEN: ScreenToolbar = {
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

const ANOTHER_TABBED_SCREEN: ScreenToolbar = {
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

const useAnotherScreensTickedGroups = viewStateOf<number>("/bindings/all");

function NarrowAct() {
  const [ticked] = useTickedGroups();

  // Inert on an empty slot, which is the act's own property and what makes a thrown screen safe.
  return (
    <button type="button" disabled={ticked === undefined}>
      {ticked === undefined ? "Narrow these documents" : `Narrow ${ticked} documents`}
    </button>
  );
}

function AnotherScreensAct() {
  const [ticked] = useAnotherScreensTickedGroups();

  return (
    <button type="button" disabled={ticked === undefined}>
      Narrow another screen's documents
    </button>
  );
}

function ReviewView(properties: { readonly throwsOnATick: boolean }) {
  const [ticked, tick] = useTickedGroups();
  if (properties.throwsOnATick && ticked !== undefined) throw new Error("the screen's own bug");

  return (
    <button type="button" onClick={() => tick(2)}>
      Tick two groups
    </button>
  );
}

const A_REVIEW_VIEW: ScreenToolbar = {
  tabs: [
    { id: "review-open", name: "Open" },
    { id: "review-done", name: "Done" },
  ],
  /** Built once, the way a route's static data is, and live on every render all the same. */
  acts: (
    <>
      <NarrowAct />
      <AnotherScreensAct />
    </>
  ),
};

const drawReview = (throwsOnATick: boolean) =>
  render(
    <ScreenTabsRoot tabs={A_REVIEW_VIEW.tabs}>
      <Toolbar name="Review" toolbar={A_REVIEW_VIEW} />
      <ScreenPanel>
        <CatchBoundary
          getResetKey={() => "the panel's own subtree"}
          errorComponent={() => <p>The screen failed to draw.</p>}
        >
          <ReviewView throwsOnATick={throwsOnATick} />
        </CatchBoundary>
      </ScreenPanel>
    </ScreenTabsRoot>,
  );

const narrowAct = () => screen.getByRole("button", { name: /^Narrow (these|\d)/ });

const anotherScreensAct = () =>
  screen.getByRole("button", { name: "Narrow another screen's documents" });

const reviewTab = (name: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name, selected: false }));

describe("the toolbar the open screen fills", () => {
  it("carries the screen's tabs in order, the open one selected", async () => {
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
    // A tab divides a screen, so the screen's own words stand either way.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Agent Operations");
  });

  it("opens another screen on its own first tab", () => {
    const shell = (toolbar: ScreenToolbar, name: string) => (
      <ScreenTabsRoot tabs={toolbar.tabs}>
        <Toolbar name={name} toolbar={toolbar} />
      </ScreenTabsRoot>
    );
    const { rerender } = render(shell(A_TABBED_SCREEN, "Bindings"));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Gone at source" }));
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Gone at source");

    rerender(shell(ANOTHER_TABBED_SCREEN, "Ceiling"));

    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Spend");
  });

  it("gives the open tab its own panel, holding the screen", async () => {
    await shellAt(ROUTES_AND_SPEND);

    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(
      within(tabs()).getByRole("tab", { name: "Routes" }).id,
    );
    expect(within(panel).getByRole("region", { name: "Routes" })).toBeDefined();
  });

  it("draws no toolbar or panel without tabs or acts", async () => {
    await shellAt("/ask");

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("draws a screen's tabs before its acts in the toolbar", () => {
    render(
      <ScreenTabsRoot tabs={A_TABBED_SCREEN.tabs}>
        <Toolbar name="Bindings" toolbar={A_TABBED_SCREEN} />
        <ScreenPanel>
          <p>The bindings.</p>
        </ScreenPanel>
      </ScreenTabsRoot>,
    );

    const list = screen.getByRole("tablist", { name: "Bindings" });
    const act = screen.getByRole("button", { name: "Add a binding" });

    expect(list.compareDocumentPosition(act) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("draws only the acts for a screen without tabs", () => {
    render(<Toolbar name="Bindings" toolbar={{ acts: A_TABBED_SCREEN.acts }} />);

    expect(screen.getByRole("button", { name: "Add a binding" })).toBeDefined();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

describe("the slot a screen writes and its acts read", () => {
  it("gives an act what its own screen wrote, not another's", () => {
    drawReview(false);

    expect(narrowAct().textContent).toBe("Narrow these documents");
    expect(narrowAct().hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Tick two groups" }));

    expect(narrowAct().textContent).toBe("Narrow 2 documents");
    expect(narrowAct().hasAttribute("disabled")).toBe(false);
    expect(anotherScreensAct().hasAttribute("disabled")).toBe(true);
  });

  it("empties the slot when a screen that threw is reopened", () => {
    drawReview(true);

    fireEvent.click(screen.getByRole("button", { name: "Tick two groups" }));

    expect(screen.getByText("The screen failed to draw.")).toBeDefined();
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Open");

    reviewTab("Done");
    reviewTab("Open");

    expect(screen.getByRole("button", { name: "Tick two groups" })).toBeDefined();
    expect(narrowAct().textContent).toBe("Narrow these documents");
    expect(narrowAct().hasAttribute("disabled")).toBe(true);
  });
});
