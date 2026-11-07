import { CatchBoundary } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Toolbar, PagePanel, PageTabsRoot } from "@/app/shell/toolbar.tsx";
import { viewStateOf, type PageToolbar } from "@/shared/page/page-toolbar.tsx";
import { openApp } from "@test/open-app.tsx";

afterEach(cleanup);

const MODELS_AND_SPEND = "/models/models-and-spend";

const shellAt = async (path: string) => (await openApp(path)).router;

const tabs = () => screen.getByRole("tablist", { name: "Models and Spend" });

const selectedTab = () => within(tabs()).getByRole("tab", { selected: true }).textContent;

/** Tabs open on mouse down, not on click. */
const chooseTab = (name: string) => fireEvent.mouseDown(within(tabs()).getByRole("tab", { name }));

const A_TABBED_PAGE: PageToolbar = {
  tabs: [
    { id: "connected-sources-all", name: "All" },
    { id: "connected-sources-gone", name: "Gone at source" },
  ],
};

const ANOTHER_TABBED_PAGE: PageToolbar = {
  tabs: [
    { id: "ceiling-spend", name: "Spend" },
    { id: "ceiling-limits", name: "Limits" },
  ],
};

const useTickedGroups = viewStateOf<number>("/connected-sources/review");

const useAnotherPagesTickedGroups = viewStateOf<number>("/connected-sources/all");

function NarrowAction() {
  const [ticked] = useTickedGroups();

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

function ReviewView(properties: { readonly throwsAfterTick: boolean }) {
  const [ticked, tick] = useTickedGroups();
  if (properties.throwsAfterTick && ticked !== undefined) throw new Error("review view failed");

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
};

const renderReview = (throwsAfterTick: boolean) =>
  render(
    <PageTabsRoot tabs={A_REVIEW_VIEW.tabs}>
      <Toolbar name="Review" toolbar={A_REVIEW_VIEW} />
      <NarrowAction />
      <AnotherPagesAction />
      <PagePanel>
        <CatchBoundary getResetKey={() => "panel"} errorComponent={() => <p>Error fallback</p>}>
          <ReviewView throwsAfterTick={throwsAfterTick} />
        </CatchBoundary>
      </PagePanel>
    </PageTabsRoot>,
  );

const narrowAction = () => screen.getByRole("button", { name: /^Narrow (these|\d)/ });

const anotherPagesAction = () =>
  screen.getByRole("button", { name: "Narrow another page's documents" });

const chooseReviewTab = (name: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name, selected: false }));

describe("the page toolbar", () => {
  it("shows the page's tabs in order, open one selected", async () => {
    await shellAt(MODELS_AND_SPEND);

    expect(
      within(tabs())
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Model Choices", "Spend"]);
    expect(selectedTab()).toBe("Model Choices");
  });

  it("opens the chosen tab and shows a placeholder when unbuilt", async () => {
    await shellAt(MODELS_AND_SPEND);

    chooseTab("Spend");

    expect(selectedTab()).toBe("Spend");
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(
      within(tabs()).getByRole("tab", { name: "Spend" }).id,
    );
    expect(panel.textContent).toMatch(/\S/v);
    expect(screen.queryByRole("region", { name: "Model Choices" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Models and Spend");
  });

  it("opens a different page on that page's first tab", () => {
    const toolbarFor = (toolbar: PageToolbar, name: string) => (
      <PageTabsRoot tabs={toolbar.tabs}>
        <Toolbar name={name} toolbar={toolbar} />
      </PageTabsRoot>
    );
    const { rerender } = render(toolbarFor(A_TABBED_PAGE, "Connected Sources"));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Gone at source" }));
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Gone at source");

    rerender(toolbarFor(ANOTHER_TABBED_PAGE, "Ceiling"));

    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Spend");
  });

  it("renders the page inside the open tab's panel", async () => {
    await shellAt(MODELS_AND_SPEND);

    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(
      within(tabs()).getByRole("tab", { name: "Model Choices" }).id,
    );
    expect(within(panel).getByRole("region", { name: "Model Choices" })).toBeDefined();
  });

  it("renders no toolbar or panel for a page without tabs", async () => {
    await shellAt("/ask");

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("renders the page heading before its tabs", async () => {
    await shellAt(MODELS_AND_SPEND);

    const page = screen.getByRole("main");
    const heading = await within(page).findByRole("heading", {
      level: 1,
      name: "Models and Spend",
    });

    expect(within(page).getByRole("tablist")).toBe(tabs());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(heading.compareDocumentPosition(tabs()) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
});

describe("page view state shared with toolbar actions", () => {
  it("gives an action its own page's state, not another page's", () => {
    renderReview(false);

    expect(narrowAction().textContent).toBe("Narrow these documents");
    expect(narrowAction().hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Tick two groups" }));

    expect(narrowAction().textContent).toBe("Narrow 2 documents");
    expect(narrowAction().hasAttribute("disabled")).toBe(false);
    expect(anotherPagesAction().hasAttribute("disabled")).toBe(true);
  });

  it("clears the state when a page that threw is reopened", () => {
    renderReview(true);

    fireEvent.click(screen.getByRole("button", { name: "Tick two groups" }));

    expect(screen.getByText("Error fallback")).toBeDefined();
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Open");

    chooseReviewTab("Done");
    chooseReviewTab("Open");

    expect(screen.getByRole("button", { name: "Tick two groups" })).toBeDefined();
    expect(narrowAction().textContent).toBe("Narrow these documents");
    expect(narrowAction().hasAttribute("disabled")).toBe(true);
  });
});
