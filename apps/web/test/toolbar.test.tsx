import { CatchBoundary } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Toolbar, PagePanel, PageTabsRoot } from "@/app/toolbar.tsx";
import { viewStateOf, type PageToolbar } from "@/shared/page-toolbar.tsx";

import { openApp } from "./open-app.tsx";

afterEach(cleanup);

const MODELS_AND_SPEND = "/models/models-and-spend";

const shellAt = async (path: string) => (await openApp(path)).router;

const tabs = () => screen.getByRole("tablist", { name: "Models and spend" });

const openTab = () => within(tabs()).getByRole("tab", { selected: true }).textContent;

/** The registry opens a tab where a pointer commits — the press — and not on the click. */
const pick = (name: string) => fireEvent.mouseDown(within(tabs()).getByRole("tab", { name }));

const A_TABBED_PAGE: PageToolbar = {
  tabs: [
    { id: "connected-sources-all", name: "All" },
    { id: "connected-sources-gone", name: "Gone at source" },
  ],
  actions: (
    <button type="button" className="border border-border px-3">
      Add a connected source
    </button>
  ),
};

const ANOTHER_TABBED_PAGE: PageToolbar = {
  tabs: [
    { id: "ceiling-spend", name: "Spend" },
    { id: "ceiling-limits", name: "Limits" },
  ],
};

/**
 * One helper of the feature's own, called by its content and by its actions: the shared slot
 * never learns the type.
 */
const useTickedGroups = viewStateOf<number>("/connected-sources/review");

const useAnotherPagesTickedGroups = viewStateOf<number>("/connected-sources/all");

function NarrowAction() {
  const [ticked] = useTickedGroups();

  // Inert on an empty slot, which is the action's own property and what makes a thrown page safe.
  return (
    <button type="button" disabled={ticked === undefined}>
      {ticked === undefined ? "Narrow these documents" : `Narrow ${ticked} documents`}
    </button>
  );
}

function AnotherPagesAction() {
  const [ticked] = useAnotherPagesTickedGroups();

  return (
    <button type="button" disabled={ticked === undefined}>
      Narrow another page's documents
    </button>
  );
}

function ReviewView(properties: { readonly throwsOnATick: boolean }) {
  const [ticked, tick] = useTickedGroups();
  if (properties.throwsOnATick && ticked !== undefined) throw new Error("the page's own bug");

  return (
    <button type="button" onClick={() => tick(2)}>
      Tick two groups
    </button>
  );
}

const A_REVIEW_VIEW: PageToolbar = {
  tabs: [
    { id: "review-open", name: "Open" },
    { id: "review-done", name: "Done" },
  ],
  /** Built once, the way a route's static data is, and live on every render all the same. */
  actions: (
    <>
      <NarrowAction />
      <AnotherPagesAction />
    </>
  ),
};

const drawReview = (throwsOnATick: boolean) =>
  render(
    <PageTabsRoot tabs={A_REVIEW_VIEW.tabs}>
      <Toolbar name="Review" toolbar={A_REVIEW_VIEW} />
      <PagePanel>
        <CatchBoundary
          getResetKey={() => "the panel's own subtree"}
          errorComponent={() => <p>The page failed to draw.</p>}
        >
          <ReviewView throwsOnATick={throwsOnATick} />
        </CatchBoundary>
      </PagePanel>
    </PageTabsRoot>,
  );

const narrowAction = () => screen.getByRole("button", { name: /^Narrow (these|\d)/ });

const anotherPagesAction = () =>
  screen.getByRole("button", { name: "Narrow another page's documents" });

const reviewTab = (name: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name, selected: false }));

describe("the toolbar the open page fills", () => {
  it("carries the page's tabs in order, the open one selected", async () => {
    await shellAt(MODELS_AND_SPEND);

    expect(
      within(tabs())
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Model choices", "Spend"]);
    expect(openTab()).toBe("Model choices");
  });

  it("opens the picked tab, and says when it is unbuilt", async () => {
    await shellAt(MODELS_AND_SPEND);

    pick("Spend");

    expect(openTab()).toBe("Spend");
    expect(screen.getByText("Spend is not built yet.")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Model choices" })).toBeNull();
    // A tab divides a page, so the page's own words stand either way.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Models");
  });

  it("opens another page on its own first tab", () => {
    const shell = (toolbar: PageToolbar, name: string) => (
      <PageTabsRoot tabs={toolbar.tabs}>
        <Toolbar name={name} toolbar={toolbar} />
      </PageTabsRoot>
    );
    const { rerender } = render(shell(A_TABBED_PAGE, "Connected sources"));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Gone at source" }));
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Gone at source");

    rerender(shell(ANOTHER_TABBED_PAGE, "Ceiling"));

    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Spend");
  });

  it("gives the open tab its own panel, holding the page", async () => {
    await shellAt(MODELS_AND_SPEND);

    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(
      within(tabs()).getByRole("tab", { name: "Model choices" }).id,
    );
    expect(within(panel).getByRole("region", { name: "Model choices" })).toBeDefined();
  });

  it("draws no toolbar or panel without tabs or actions", async () => {
    await shellAt("/ask");

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("draws a page's tabs before its actions in the toolbar", () => {
    render(
      <PageTabsRoot tabs={A_TABBED_PAGE.tabs}>
        <Toolbar name="Connected sources" toolbar={A_TABBED_PAGE} />
        <PagePanel>
          <p>The connected sources.</p>
        </PagePanel>
      </PageTabsRoot>,
    );

    const list = screen.getByRole("tablist", { name: "Connected sources" });
    const action = screen.getByRole("button", { name: "Add a connected source" });

    expect(list.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("draws only the actions for a page without tabs", () => {
    render(<Toolbar name="Connected sources" toolbar={{ actions: A_TABBED_PAGE.actions }} />);

    expect(screen.getByRole("button", { name: "Add a connected source" })).toBeDefined();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

describe("the slot a page writes and its actions read", () => {
  it("gives an action what its own page wrote, not another's", () => {
    drawReview(false);

    expect(narrowAction().textContent).toBe("Narrow these documents");
    expect(narrowAction().hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Tick two groups" }));

    expect(narrowAction().textContent).toBe("Narrow 2 documents");
    expect(narrowAction().hasAttribute("disabled")).toBe(false);
    expect(anotherPagesAction().hasAttribute("disabled")).toBe(true);
  });

  it("empties the slot when a page that threw is reopened", () => {
    drawReview(true);

    fireEvent.click(screen.getByRole("button", { name: "Tick two groups" }));

    expect(screen.getByText("The page failed to draw.")).toBeDefined();
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Open");

    reviewTab("Done");
    reviewTab("Open");

    expect(screen.getByRole("button", { name: "Tick two groups" })).toBeDefined();
    expect(narrowAction().textContent).toBe("Narrow these documents");
    expect(narrowAction().hasAttribute("disabled")).toBe(true);
  });
});
