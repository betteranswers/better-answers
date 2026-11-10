import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WAITING_ON_YOU } from "@/features/inbox/inbox-state.ts";
import { EDIT_WORDS, SAID_OF_DECIDING } from "@/features/inbox/inbox-words.ts";
import { detailAt } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { openedWhereTheApiNamesNone } from "@test/not-found-detail.ts";
import { aRefusalAnswer, adaAnAdmin, openAt, read } from "@test/two-workspaces.ts";

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
  proposed: {
    title: "Annual leave",
    conceptType: "Policy",
    body: "Everyone takes 28 days.",
    sources: undefined,
  },
};

const editOf = (current: string, proposed: string) => ({
  ...orphanedEdit,
  item: {
    ...orphanedEdit.item,
    target: "https://example.invalid/concepts/annual-leave",
    baseMoved: false,
  },
  current: {
    state: "shown",
    version: { ...orphanedEdit.proposed, conceptType: current, body: "Everyone takes 25 days." },
  },
  proposed: { ...orphanedEdit.proposed, conceptType: proposed },
});

const typeShownIn = async (version: string): Promise<string | undefined> => {
  const region = await screen.findByRole("region", { name: version });
  const term = within(region).queryByText(EDIT_WORDS.type, { selector: "dt" });
  return term?.nextElementSibling?.textContent ?? undefined;
};

const describedText = (field: HTMLElement): string =>
  String(field.getAttribute("aria-describedby"))
    .split(" ")
    .flatMap((id) => [...document.querySelectorAll(`[id="${id}"]`)])
    .map((node) => node.textContent)
    .join(" ");

describe("a suggestion on Waiting on You", () => {
  it("shows Page Not Found when the suggestion does not exist", async () => {
    const drawn = await openedWhereTheApiNamesNone(A_SUGGESTION, "inbox.item");

    expect(drawn.notFound).toBeDefined();
    expect(drawn.alerts).toHaveLength(0);
  });

  it("shows both types when the suggestion changes the type", async () => {
    const api = adaAnAdmin();
    api.set("inbox.item", () => read(editOf("Policy", "Guideline")));
    await openAt(A_SUGGESTION, api);

    expect(await typeShownIn(EDIT_WORDS.current)).toBe(`${EDIT_WORDS.changed}Policy`);
    expect(await typeShownIn(EDIT_WORDS.proposed)).toBe(`${EDIT_WORDS.changed}Guideline`);
  });

  it("shows no type when the suggestion keeps the type", async () => {
    const api = adaAnAdmin();
    api.set("inbox.item", () => read(editOf("Policy", "Policy")));
    await openAt(A_SUGGESTION, api);

    expect(await typeShownIn(EDIT_WORDS.current)).toBeUndefined();
    expect(await typeShownIn(EDIT_WORDS.proposed)).toBeUndefined();
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
      said: EDIT_WORDS.reasonShownTo(orphanedEdit.item.proposer.name),
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

    expect(describedText(reason)).toBe(said);
  });

  it("keeps a too-long reason in focus with its message", async () => {
    const api = adaAnAdmin();
    api.set("inbox.item", () => read(orphanedEdit));
    api.set("inbox.decline", () => aRefusalAnswer("malformed", "invalid", 400));
    await openAt(A_SUGGESTION, api);
    const typed = "x".repeat(2001);

    fireEvent.click(await screen.findByRole("button", { name: EDIT_WORDS.decline }));
    const reason = await screen.findByRole("textbox", { name: EDIT_WORDS.reason });
    fireEvent.change(reason, { target: { value: typed } });
    fireEvent.click(screen.getByRole("button", { name: EDIT_WORDS.declineSuggestion }));

    await waitFor(() => {
      expect(describedText(reason)).toContain(SAID_OF_DECIDING.malformed);
    });
    expect(reason).toHaveProperty("value", typed);
    expect(document.activeElement).toBe(reason);
  });
});
