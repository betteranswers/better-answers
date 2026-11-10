import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { REQUEST_WORDS } from "@/features/people/invitation-words.ts";
import { PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import type { WaitingRequest } from "@/features/people/requests/requests-api.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { asksOf, blurred, found, openPeople, pressedOn } from "@test/people/invitations-stubbed.ts";
import { holdProcedure } from "@test/stubbed-api.ts";
import { adaAnAdmin, aRefusalAnswer, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const NAMES_AN_ORGANISATION = /organi[sz]ation/i;

const REASON = "I have joined the bids team and need the answer library.";

const aRequest = (id: string, name: string): WaitingRequest => ({
  id: z.string().brand<"AccessRequestId">().parse(id),
  requester: {
    id: z.string().brand<"UserId">().parse(`user-${id}`),
    name,
    email: `${id}@example.test`,
  },
  reason: REASON,
  askedAt: "2026-10-20T09:00:00.000Z",
});

const PRIYA = aRequest("priya", "Priya Shah");

const KEPT = aRequest("kept", "Kept Lee");

const requestsApi = (...waiting: readonly WaitingRequest[]) => {
  const api = adaAnAdmin();
  api.set("members.requests", () => read(waiting));
  return api;
};

const region = () => within(screen.getByRole("region", { name: "Requests" }));

const rowsOf = (name: string): HTMLElement[] =>
  region()
    .queryAllByRole("row")
    .filter((row) => row.textContent.includes(name));

const heading = () => region().getByRole("heading", { level: 2, name: "Requests" });

const said = (): HTMLElement => found(region().getAllByRole("status").at(-1));

const alert = (): HTMLElement => found(region().getAllByRole("alert").at(0));

const NAMED = { Approve: REQUEST_WORDS.approveFrom, Decline: REQUEST_WORDS.declineFrom };

const buttonOf = (action: keyof typeof NAMED, name: string) =>
  region().getByRole("button", { name: NAMED[action](name) });

const approveDialog = (name: string) =>
  screen.findByRole("dialog", { name: REQUEST_WORDS.approveFrom(name) });

describe("the People page's Requests tab", () => {
  it("restores a request when the api refuses its decline", async () => {
    const api = requestsApi(PRIYA);
    await openPeople(api, "Requests");
    await waitFor(() => {
      expect(rowsOf(PRIYA.requester.name)).toHaveLength(1);
    });
    const decline = holdProcedure(api, "members.declineRequest");
    const reread = holdProcedure(api, "members.requests");

    fireEvent.click(buttonOf("Decline", PRIYA.requester.name));
    await decline.asked;
    expect(
      rowsOf(PRIYA.requester.name),
      "the row stayed while the decline was pending",
    ).toHaveLength(0);

    decline.reject(aRefusalAnswer("role-forbids", "forbidden", 403));
    await reread.asked;
    expect(
      rowsOf(PRIYA.requester.name),
      "the row did not return after the refused decline",
    ).toHaveLength(1);

    reread.resolve();
    await waitFor(() => {
      expect(alert().textContent, "the refused decline showed no alert").not.toBe("");
    });
    expect(rowsOf(PRIYA.requester.name)).toHaveLength(1);
  });

  it("clears the select-first message once a key approves", async () => {
    await openPeople(requestsApi(KEPT), "Requests");
    await waitFor(() => {
      expect(rowsOf(KEPT.requester.name)).toHaveLength(1);
    });
    const line = said();
    blurred();

    pressedOn(PEOPLE_KEYSTROKES.approve.key);
    expect(line.textContent, "approving with no request in focus showed no message").not.toBe("");

    act(() => {
      buttonOf("Approve", KEPT.requester.name).focus();
    });
    pressedOn(PEOPLE_KEYSTROKES.approve.key);
    await approveDialog(KEPT.requester.name);
    expect(line.textContent, "the select-first message stayed after the approve").toBe("");
  });

  it("alerts when someone else already decided the request", async () => {
    const api = requestsApi(PRIYA);
    api.set("members.approveRequest", () => {
      api.set("members.requests", () => read([]));
      return aRefusalAnswer("already-decided", "conflict", 409);
    });
    await openPeople(api, "Requests");
    await waitFor(() => {
      expect(rowsOf(PRIYA.requester.name)).toHaveLength(1);
    });
    fireEvent.click(buttonOf("Approve", PRIYA.requester.name));
    const dialog = await approveDialog(PRIYA.requester.name);

    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(alert().textContent, "the already-decided refusal showed no alert").not.toBe("");
    });
    await waitFor(() => {
      expect(rowsOf(PRIYA.requester.name)).toHaveLength(0);
    });
    expect(asksOf("members.approveRequest")).toHaveLength(1);
    await waitFor(() => {
      expect(document.activeElement).toBe(heading());
    });
    expect(document.body.textContent, "the page says organisation, not workspace").not.toMatch(
      NAMES_AN_ORGANISATION,
    );
  });
});
