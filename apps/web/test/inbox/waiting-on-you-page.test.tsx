import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WAITING_ON_YOU } from "@/features/inbox/inbox-state.ts";
import { WAITING_WORDS } from "@/features/inbox/inbox-words.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { settlingAfter } from "@test/stubbed-api.ts";
import { ADA, adaAnAdmin, NORTHERN, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const waitingItem = (suggestionId: string, title: string) => ({
  suggestionId,
  title,
  proposer: { id: "01JOWEN000000000000000000A", name: "Owen Price" },
  proposedAt: "2026-10-20T09:00:00.000Z",
  target: null,
  collection: "policy",
  owner: null,
  baseMoved: false,
  places: 0,
});

const LEAVE = waitingItem("01JXSGGST0000000000000000A", "Annual leave");
const CLAIMS = waitingItem("01JXSGGST0000000000000000B", "Expense claims");

const acceptedAlone = async (item: { readonly title: string }) => {
  fireEvent.click(await screen.findByRole("checkbox", { name: `Select ${item.title}` }));
  await settlingAfter(() => {
    fireEvent.click(screen.getByRole("button", { name: "Accept Selected" }));
  });
};

const mainAlertText = () =>
  within(screen.getByRole("main"))
    .getAllByRole("alert")
    .map((alert) => alert.textContent)
    .join(" ");

describe("Waiting on You", () => {
  it("alerts by title when an acceptance is unconfirmed", async () => {
    const api = adaAnAdmin();
    api.set("inbox.waiting", () => read({ items: [LEAVE, CLAIMS] }));
    api.set("inbox.accept", () =>
      read({
        outcomes: [
          { suggestionId: LEAVE.suggestionId, outcome: "accepted" },
          { suggestionId: CLAIMS.suggestionId, outcome: "unconfirmed" },
        ],
      }),
    );
    await openAt(WAITING_ON_YOU.path, api);

    for (const title of [LEAVE.title, CLAIMS.title]) {
      fireEvent.click(await screen.findByRole("checkbox", { name: `Select ${title}` }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Accept Selected" }));

    await waitFor(() =>
      expect(mainAlertText(), "no alert named the unconfirmed suggestion").toContain(CLAIMS.title),
    );
    expect(screen.getAllByRole("checkbox", { name: `Select ${CLAIMS.title}` })).toHaveLength(1);
  });

  it("alerts and keeps the suggestion while an earlier change saves", async () => {
    const api = adaAnAdmin();
    api.set("inbox.waiting", () => read({ items: [CLAIMS] }));
    api.set("inbox.accept", () =>
      read({ outcomes: [{ suggestionId: CLAIMS.suggestionId, outcome: "unrecorded-head" }] }),
    );
    await openAt(WAITING_ON_YOU.path, api);

    fireEvent.click(await screen.findByRole("checkbox", { name: `Select ${CLAIMS.title}` }));
    fireEvent.click(screen.getByRole("button", { name: "Accept Selected" }));

    await waitFor(() =>
      expect(mainAlertText(), "no alert appeared for the pending save").toMatch(/\S/v),
    );
    expect(screen.getAllByRole("checkbox", { name: `Select ${CLAIMS.title}` })).toHaveLength(1);
  });

  it("calls an edit orphaned by a retitle changed, not new", async () => {
    const api = adaAnAdmin();
    const orphaned = { ...CLAIMS, baseMoved: true };
    api.set("inbox.waiting", () => read({ items: [LEAVE, orphaned] }));
    await openAt(WAITING_ON_YOU.path, api);

    await screen.findByRole("checkbox", { name: `Select ${CLAIMS.title}` });
    const row = (title: string) => within(screen.getByRole("listitem", { name: title }));

    expect(row(LEAVE.title).queryByText(WAITING_WORDS.newConcept)).not.toBeNull();
    expect(row(CLAIMS.title).queryByText(WAITING_WORDS.baseMoved)).not.toBeNull();
    expect(row(CLAIMS.title).queryByText(WAITING_WORDS.newConcept)).toBeNull();
  });

  it("leaves the page once a second ownership loss ends ownership", async () => {
    const api = adaAnAdmin();
    const person = { id: ADA.personId, name: ADA.displayName, email: ADA.address };
    const anOwnerOf = (collections: string[]) => () =>
      read({ workspace: NORTHERN, person, role: "Editor", owns: { collections, concepts: 0 } });
    const lost = (item: { readonly suggestionId: string }) => () =>
      read({ outcomes: [{ suggestionId: item.suggestionId, outcome: "owner-forbids" }] });
    api.set("session.member", anOwnerOf(["policy", "hr"]));
    api.set("inbox.waiting", () => read({ items: [LEAVE, CLAIMS] }));
    await openAt(WAITING_ON_YOU.path, api);

    api.set("session.member", anOwnerOf(["hr"]));
    api.set("inbox.accept", lost(LEAVE));
    await acceptedAlone(LEAVE);
    expect(mainAlertText(), "the first loss said nothing").toMatch(/\S/v);
    expect(screen.queryByRole("heading", { name: WAITING_ON_YOU.name })).not.toBeNull();

    api.set("session.member", anOwnerOf([]));
    api.set("inbox.accept", lost(CLAIMS));
    await acceptedAlone(CLAIMS);

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: WAITING_ON_YOU.name })).toBeNull(),
    );
  });
});
