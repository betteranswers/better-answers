import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { KeepInTextAct, NarrowDocumentsAct } from "@/features/sources/review-acts.tsx";
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
};

// The review's half of the slot, standing in for the findings table a click writes through.
function TicksIn(properties: { readonly bindingId: string }) {
  const [, tick] = useTickedGroups();
  return (
    <button
      type="button"
      onClick={() => {
        tick({ bindingId: properties.bindingId, groups: [BANK_DETAILS] });
      }}
    >
      Tick bank details
    </button>
  );
}

const reviewing = (bindingId: string, tickedIn: string) =>
  render(
    <Providers clients={createAppClients()}>
      <ViewStateSlot>
        <TicksIn bindingId={tickedIn} />
        <KeepInTextAct bindingId={bindingId} />
        <NarrowDocumentsAct bindingId={bindingId} />
      </ViewStateSlot>
    </Providers>,
  );

const act = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });

describe("the review's two bulk acts", () => {
  it("stand inert, and read as such, until the review ticks a finding group", () => {
    reviewing(THE_BINDING, THE_BINDING);

    expect(act("Keep in text").disabled).toBe(true);
    expect(act("Narrow these documents").disabled).toBe(true);
  });

  it("read what the review ticked, naming the groups kept and the documents narrowed", () => {
    reviewing(THE_BINDING, THE_BINDING);

    fireEvent.click(act("Tick bank details"));

    expect(act("Keep 1 finding group in text").disabled).toBe(false);
    expect(act("Narrow 1 document").disabled).toBe(false);
  });

  it("never take groups another binding's review ticked", () => {
    reviewing(THE_BINDING, ANOTHER_BINDING);

    fireEvent.click(act("Tick bank details"));

    expect(act("Keep in text").disabled).toBe(true);
    expect(act("Narrow these documents").disabled).toBe(true);
  });
});
