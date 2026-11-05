import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WAITING_ON_YOU } from "@/features/inbox/inbox-state.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { adaAnAdmin, openAt, read } from "@test/two-workspaces.ts";

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
});
