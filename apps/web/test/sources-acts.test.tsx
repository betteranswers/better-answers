import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { refusedFor } from "@/features/sources/refusal.tsx";
import {
  DismissAsNotSpecialCategoryAct,
  KeepInTextAct,
  NarrowDocumentsAct,
} from "@/features/sources/review-acts.tsx";
import type { FindingGroup } from "@/features/sources/sources-api.ts";
import { useTickedGroups } from "@/features/sources/sources-state.ts";
import { ViewStateSlot } from "@/shared/view-toolbar.tsx";

afterEach(cleanup);

const THE_BINDING = "01K5T0000000000000000BIND1";

const ANOTHER_BINDING = "01K5T0000000000000000BIND2";

const BANK_DETAILS: FindingGroup = {
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

const HEALTH_CUE: FindingGroup = {
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

const NOT_SPECIAL_CATEGORY =
  "Only a special category finding group can be dismissed as not special category. Untick the groups of another category.";

/** The review's half of the slot, standing in for the findings table a click writes through. */
function TicksIn(properties: { readonly bindingId: string }) {
  const [, tick] = useTickedGroups();
  const ticking = (groups: readonly FindingGroup[]) => () => {
    tick({ bindingId: properties.bindingId, groups });
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

const reviewing = (bindingId: string, tickedIn: string) =>
  render(
    <Providers clients={createAppClients()}>
      <ViewStateSlot>
        <TicksIn bindingId={tickedIn} />
        <KeepInTextAct bindingId={bindingId} />
        <NarrowDocumentsAct bindingId={bindingId} />
        <DismissAsNotSpecialCategoryAct bindingId={bindingId} />
      </ViewStateSlot>
    </Providers>,
  );

const act = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });

describe("the review's three bulk acts", () => {
  it("stand disabled until the review ticks a finding group", () => {
    reviewing(THE_BINDING, THE_BINDING);

    expect(act("Keep in text").disabled).toBe(true);
    expect(act("Narrow these documents").disabled).toBe(true);
    expect(act("Dismiss as not special category").disabled).toBe(true);
    expect(screen.queryByText(NOT_SPECIAL_CATEGORY)).toBeNull();
  });

  it("name the ticked groups kept and documents narrowed", () => {
    reviewing(THE_BINDING, THE_BINDING);

    fireEvent.click(act("Tick bank details"));

    expect(act("Keep 1 finding group in text").disabled).toBe(false);
    expect(act("Narrow 1 document").disabled).toBe(false);
  });

  it("never take groups another binding's review ticked", () => {
    reviewing(THE_BINDING, ANOTHER_BINDING);

    fireEvent.click(act("Tick the health cue"));

    expect(act("Keep in text").disabled).toBe(true);
    expect(act("Narrow these documents").disabled).toBe(true);
    expect(act("Dismiss as not special category").disabled).toBe(true);
  });
});

describe("the dismissal as not special category", () => {
  it("is offered over ticked special category groups alone", () => {
    reviewing(THE_BINDING, THE_BINDING);

    fireEvent.click(act("Tick the health cue"));

    expect(act("Dismiss 1 finding group as not special category").disabled).toBe(false);
    expect(screen.queryByText(NOT_SPECIAL_CATEGORY)).toBeNull();
  });

  it("stands disabled over a mixed selection, and says why", () => {
    reviewing(THE_BINDING, THE_BINDING);

    fireEvent.click(act("Tick both"));

    const dismissal = act("Dismiss as not special category");
    expect(dismissal.disabled).toBe(true);
    expect(dismissal.getAttribute("aria-describedby")).toBe(
      screen.getByText(NOT_SPECIAL_CATEGORY).id,
    );
    expect(act("Keep 2 finding groups in text").disabled).toBe(false);
  });

  it("opens on s, asking a reason and naming no finding", () => {
    reviewing(THE_BINDING, THE_BINDING);
    fireEvent.click(act("Tick the health cue"));

    fireEvent.keyDown(document.body, { key: "s" });

    const dialog = screen.getByRole("dialog", {
      name: "Dismiss 1 finding group as not special category",
    });
    expect(dialog.textContent).toContain(
      "special category by HEALTH_CUE in Pump service notes: 1 found",
    );
    expect(screen.getByLabelText("Reason")).toBeDefined();
    expect(dialog.textContent).not.toMatch(/\b[0-9A-HJKMNP-TV-Z]{26}\b/);
  });

  it("words the api's not-special-category refusal, with the next step", () => {
    const { container } = render(<p>{refusedFor("not-special-category", "inapplicable").words}</p>);

    expect(container.textContent).toBe(
      "Refused: not-special-category. Only a special category finding group can be dismissed as not special category. Untick the groups of another category.",
    );
  });
});
