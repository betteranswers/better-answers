import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WAITING_ON_YOU } from "@/features/inbox/inbox-state.ts";
import { EDIT_WORDS } from "@/features/inbox/inbox-words.ts";
import { detailAt } from "@/shared/navigation.ts";
import { openedWhereTheApiNamesNone } from "@test/detail/not-found-detail.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { adaAnAdmin, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const SUGGESTION_ID = "01JXSGGST0000000000000000A";

const A_SUGGESTION = detailAt(WAITING_ON_YOU, SUGGESTION_ID);

const orphanedEdit = {
  item: {
    suggestionId: SUGGESTION_ID,
    title: "Annual leave",
    proposer: { id: "01JOWEN000000000000000000A", name: "Owen Price" },
    proposedAt: "2026-10-20T09:00:00.000Z",
    target: null,
    collection: "policy",
    owner: null,
    baseMoved: true,
    places: 0,
  },
  current: { state: "orphaned" },
  proposed: { title: "Annual leave", body: "Everyone takes 28 days.", sources: undefined },
};

describe("a suggestion on Waiting on You", () => {
  it("shows Page Not Found when the suggestion does not exist", async () => {
    const drawn = await openedWhereTheApiNamesNone(A_SUGGESTION, "inbox.item");

    expect(drawn.notFound).toBeDefined();
    expect(drawn.alerts).toHaveLength(0);
  });

  it("tells the owner an orphaned edit's concept has changed", async () => {
    const api = adaAnAdmin();
    api.set("inbox.item", () => read(orphanedEdit));
    await openAt(A_SUGGESTION, api);

    const current = await screen.findByRole("region", { name: EDIT_WORDS.current });

    expect(current.textContent).toContain(EDIT_WORDS.noCurrent.orphaned);
    expect(current.textContent).not.toContain(EDIT_WORDS.noCurrent.withheld);
  });

  it.each([
    {
      reader: "a named proposer",
      proposer: orphanedEdit.item.proposer,
      said: EDIT_WORDS.reasonShownTo("Owen Price"),
    },
    { reader: "a former member", proposer: null, said: "" },
  ])("says who reads a decline reason: $reader", async ({ proposer, said }) => {
    const api = adaAnAdmin();
    api.set("inbox.item", () =>
      read({ ...orphanedEdit, item: { ...orphanedEdit.item, proposer } }),
    );
    await openAt(A_SUGGESTION, api);

    fireEvent.click(await screen.findByRole("button", { name: EDIT_WORDS.decline }));
    const reason = await screen.findByRole("textbox", { name: EDIT_WORDS.reason });

    const described = String(reason.getAttribute("aria-describedby"))
      .split(" ")
      .flatMap((id) => [...document.querySelectorAll(`[id="${id}"]`)])
      .map((node) => node.textContent)
      .join(" ");

    expect(described).toBe(said);
  });
});
