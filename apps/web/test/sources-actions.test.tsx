import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { SAID_OF_A_CONNECTED_SOURCE } from "@/features/sources/refusal-words.ts";
import { refusedFor } from "@/features/sources/refusal.tsx";
import {
  DismissAsNotSpecialCategoryAction,
  KeepInTextAction,
  NarrowDocumentsAction,
} from "@/features/sources/review-actions.tsx";
import type { GroupOfFindings } from "@/features/sources/sources-api.ts";
import { useTickedGroups } from "@/features/sources/sources-state.ts";
import { ViewStateSlot } from "@/shared/page-toolbar.tsx";

afterEach(cleanup);

const THE_CONNECTED_SOURCE = "01K5T0000000000000000BIND1";

const ANOTHER_CONNECTED_SOURCE = "01K5T0000000000000000BIND2";

const BANK_DETAILS: GroupOfFindings = {
  documentId: "01K5T00000000000000000DOC1",
  title: "Supplier form",
  sensitivity: "Internal",
  category: "bank-details",
  ruleId: "UK_BANK_ACCOUNT",
  tier: "always",
  specialCategory: false,
  found: 2,
  overriddenByErasure: 0,
  dismissed: 0,
};

const HEALTH_CUE: GroupOfFindings = {
  documentId: "01K5T00000000000000000DOC2",
  title: "Pump service notes",
  sensitivity: "Restricted",
  category: "special-category",
  ruleId: "HEALTH_CUE",
  tier: "always",
  specialCategory: true,
  found: 1,
  overriddenByErasure: 0,
  dismissed: 0,
};

const { why, next } = SAID_OF_A_CONNECTED_SOURCE["not-special-category"];

const NOT_SPECIAL_CATEGORY = `${why} ${next}`;

/** The review's half of the slot, standing in for the findings table a click writes through. */
function TicksIn(properties: { readonly connectedSourceId: string }) {
  const [, tick] = useTickedGroups();
  const ticking = (groups: readonly GroupOfFindings[]) => () => {
    tick({ connectedSourceId: properties.connectedSourceId, groups });
  };
  return (
    <>
      <button type="button" onClick={ticking([BANK_DETAILS])}>
        Tick bank details
      </button>
      <button type="button" onClick={ticking([HEALTH_CUE])}>
        Tick the health cue
      </button>
      <button type="button" onClick={ticking([HEALTH_CUE, BANK_DETAILS])}>
        Tick both
      </button>
    </>
  );
}

const reviewing = (connectedSourceId: string, tickedIn: string) =>
  render(
    <Providers clients={createAppClients()}>
      <ViewStateSlot>
        <TicksIn connectedSourceId={tickedIn} />
        <KeepInTextAction connectedSourceId={connectedSourceId} />
        <NarrowDocumentsAction connectedSourceId={connectedSourceId} />
        <DismissAsNotSpecialCategoryAction connectedSourceId={connectedSourceId} />
      </ViewStateSlot>
    </Providers>,
  );

const action = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });

describe("the review's three bulk actions", () => {
  it("stand disabled until the review ticks a group of findings", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);

    expect(action("Keep in text").disabled).toBe(true);
    expect(action("Narrow these documents").disabled).toBe(true);
    expect(action("Dismiss as not special category").disabled).toBe(true);
    expect(screen.queryByText(NOT_SPECIAL_CATEGORY)).toBeNull();
  });

  it("name the ticked groups kept and documents narrowed", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);

    fireEvent.click(action("Tick bank details"));

    expect(action("Keep 1 group of findings in text").disabled).toBe(false);
    expect(action("Narrow 1 document").disabled).toBe(false);
  });

  it("never take groups another connected source's review ticked", () => {
    reviewing(THE_CONNECTED_SOURCE, ANOTHER_CONNECTED_SOURCE);

    fireEvent.click(action("Tick the health cue"));

    expect(action("Keep in text").disabled).toBe(true);
    expect(action("Narrow these documents").disabled).toBe(true);
    expect(action("Dismiss as not special category").disabled).toBe(true);
  });
});

describe("the dismissal as not special category", () => {
  it("is offered over ticked special category groups alone", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);

    fireEvent.click(action("Tick the health cue"));

    expect(action("Dismiss 1 group of findings as not special category").disabled).toBe(false);
    expect(screen.queryByText(NOT_SPECIAL_CATEGORY)).toBeNull();
  });

  it("stands disabled over a mixed selection, and says why", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);

    fireEvent.click(action("Tick both"));

    const dismissal = action("Dismiss as not special category");
    expect(dismissal.disabled).toBe(true);
    expect(dismissal.getAttribute("aria-describedby")).toBe(
      screen.getByText(NOT_SPECIAL_CATEGORY).id,
    );
    expect(action("Keep 2 groups of findings in text").disabled).toBe(false);
  });

  it("opens on s, asking a reason and naming no finding", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);
    fireEvent.click(action("Tick the health cue"));

    fireEvent.keyDown(document.body, { key: "s" });

    const dialog = screen.getByRole("dialog", {
      name: "Dismiss 1 group of findings as not special category",
    });
    expect(dialog.textContent).toContain(
      "special category by HEALTH_CUE in Pump service notes: 1 found",
    );
    expect(screen.getByLabelText("Reason")).toBeDefined();
    expect(dialog.textContent).not.toMatch(/\b[0-9A-HJKMNP-TV-Z]{26}\b/);
  });

  it("says the api's not-special-category refusal as the hint does", () => {
    const { container } = render(<p>{refusedFor("not-special-category", "inapplicable").words}</p>);

    expect(container.textContent).toBe(NOT_SPECIAL_CATEGORY);
  });
});
