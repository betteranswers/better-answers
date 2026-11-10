import { fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { INVITATIONS_WORDS } from "@/features/people/invitation-words.ts";
import { PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import {
  addressOf,
  anInvitation,
  asksOf,
  focused,
  holdingInvitations,
  invitationRows,
  invitationsRegion,
  menuItemChosen,
  openedWith,
  openInvitations,
  outcomeIn,
  pressedOn,
  pressEnter,
  refusalWithItems,
  rowsOf,
  selectionAction,
  selectionStatusText,
  shownUnder,
  statusChoice,
  tickOf,
  ticked,
} from "@test/people/invitations-stubbed.ts";
import { holdProcedure } from "@test/stubbed-api.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const NO_LONGER_WAITING = (invitationId: string) =>
  refusalWithItems("no-such-invitation", "absent", 404, { [invitationId]: "no-such-invitation" });

const saidInTheTab = (said: string | RegExp) =>
  within(invitationsRegion())
    .getAllByRole("status")
    .filter((status) =>
      typeof said === "string" ? status.textContent.includes(said) : said.test(status.textContent),
    );

const theHeading = () =>
  within(invitationsRegion()).getByRole("heading", { level: 2, name: "Invitations" });

describe("the People page's Invitations tab", () => {
  it("removes an address from Unsent Emails once its resend succeeds", async () => {
    const offline = addressOf("offline");
    const { api, reachable } = holdingInvitations([anInvitation("offline")], [offline]);
    await openInvitations(api);

    await ticked(offline);
    fireEvent.click(selectionAction("Resend"));
    const unsent = await within(invitationsRegion()).findByRole("region", {
      name: INVITATIONS_WORDS.unsent,
    });
    const resendName = INVITATIONS_WORDS.resendTo(offline);
    const resend = within(unsent).getByRole("button", { name: resendName });

    reachable(offline);
    fireEvent.click(resend);
    await waitFor(() => {
      expect(within(unsent).queryByRole("button", { name: resendName })).toBeNull();
    });
    expect(within(unsent).getByRole("status").textContent).toContain(offline);
    expect(document.activeElement, "focus did not move to the Unsent Emails heading").toBe(
      within(unsent).getByRole("heading", { name: INVITATIONS_WORDS.unsent }),
    );
  });

  it("the row menu's Resend moves an expired invitation to Waiting", async () => {
    const old = addressOf("old");
    const { api } = holdingInvitations([anInvitation("old", "expired")]);
    await openInvitations(api);
    await shownUnder("Expired");

    await menuItemChosen(old, "Resend");

    await waitFor(() => {
      expect(saidInTheTab(new RegExp(`${old}.*\\d{4}`))).toHaveLength(1);
    });
    await waitFor(() => {
      expect(rowsOf(old)).toHaveLength(0);
    });
    await focused(theHeading());
    await statusChoice("Expired", 0);
    await statusChoice("Waiting", 1);
    await shownUnder("Waiting");
    await waitFor(() => {
      expect(rowsOf(old)).toHaveLength(1);
    });
  });

  it("cancelling from a row's menu moves focus to the heading", async () => {
    const [ana, ben] = [addressOf("ana"), addressOf("ben")];
    await openedWith([anInvitation("ana"), anInvitation("ben")]);

    await menuItemChosen(ana, "Cancel");

    await waitFor(() => {
      expect(rowsOf(ana)).toHaveLength(0);
    });
    expect(rowsOf(ben)).toHaveLength(1);
    expect(saidInTheTab(ana)).toHaveLength(1);
    await focused(theHeading());
    await statusChoice("Cancelled", 1);
  });

  it("bulk Cancel over two waiting invitations moves both to Cancelled", async () => {
    const [ana, ben] = [addressOf("ana"), addressOf("ben")];
    await openedWith([anInvitation("ana"), anInvitation("ben")]);
    await statusChoice("Cancelled", 0);

    await ticked(ana);
    await ticked(ben);
    fireEvent.click(selectionAction("Cancel"));

    await waitFor(() => {
      expect(invitationRows()).toHaveLength(0);
    });
    await statusChoice("Cancelled", 2);
    expect(
      outcomeIn()?.textContent,
      "the outcome did not count two cancelled and none skipped",
    ).toMatch(/^\D*2\D*$/);
    expect(asksOf("members.bulkCancelInvitations")).toEqual([
      { invitationIds: [anInvitation("ana").invitationId, anInvitation("ben").invitationId] },
    ]);
    await statusChoice("Waiting", 0);
  });

  it("bulk Cancel counts an already cancelled invitation as skipped", async () => {
    const [ana, ben] = [addressOf("ana"), addressOf("ben")];
    const { api, moveTo } = holdingInvitations([anInvitation("ana"), anInvitation("ben")]);
    await openInvitations(api);

    await ticked(ana);
    await ticked(ben);
    moveTo(anInvitation("ana").invitationId, "cancelled");
    pressedOn(PEOPLE_KEYSTROKES.cancelSelected.key, true);

    await waitFor(() => {
      expect(
        outcomeIn()?.textContent,
        "the outcome did not count one cancelled and one skipped",
      ).toMatch(/\b1\b\D+\b1\b/);
    });
    await statusChoice("Cancelled", 2);
  });

  it("the bar's Resend moves an expired invitation to Waiting", async () => {
    const old = addressOf("old");
    const { api } = holdingInvitations([anInvitation("old", "expired")]);
    await openInvitations(api);
    await shownUnder("Expired");

    await ticked(old);
    fireEvent.click(selectionAction("Resend"));

    await waitFor(() => {
      expect(outcomeIn()?.textContent, "the outcome did not count one resent").toMatch(/\b1\b/);
    });
    await waitFor(() => {
      expect(rowsOf(old)).toHaveLength(0);
    });
    await statusChoice("Waiting", 1);
    await statusChoice("Expired", 0);
  });

  it("a refused bulk Resend names a hidden invitation", async () => {
    const [gone, kept] = [addressOf("gone"), addressOf("kept")];
    const TWO_TICKED_NEITHER_SHOWN = /\b2\b\D+\b2\b/;
    const { api } = holdingInvitations([anInvitation("gone"), anInvitation("kept")]);
    api.set("members.bulkResendInvitations", () =>
      NO_LONGER_WAITING(anInvitation("gone").invitationId),
    );
    await openInvitations(api);

    await ticked(gone);
    await ticked(kept);
    await shownUnder("Expired");
    await waitFor(() => {
      expect(selectionStatusText()).toMatch(TWO_TICKED_NEITHER_SHOWN);
    });
    fireEvent.click(selectionAction("Resend"));

    await waitFor(() => {
      expect(within(invitationsRegion()).getByRole("alert").textContent).not.toBe("");
    });
    expect(asksOf("members.bulkResendInvitations")).toEqual([
      { invitationIds: [anInvitation("gone").invitationId, anInvitation("kept").invitationId] },
    ]);
    const refusal = within(invitationsRegion()).getByRole("alert");
    expect(
      within(refusal).getByRole("paragraph").textContent,
      "the refusal did not count one invitation",
    ).toMatch(/\b1\b/);
    expect(
      within(refusal)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining(gone)]);
    await waitFor(() => {
      expect(selectionStatusText()).toMatch(TWO_TICKED_NEITHER_SHOWN);
    });
  });

  it("a second action waits until the first one finishes", async () => {
    const [ana, ben] = [addressOf("ana"), addressOf("ben")];
    const { api } = holdingInvitations([anInvitation("ana"), anInvitation("ben")]);
    const cancelling = holdProcedure(api, "members.bulkCancelInvitations");
    await openInvitations(api);

    await ticked(ana);
    fireEvent.click(selectionAction("Cancel"));
    await cancelling.asked;
    const saidPending = outcomeIn()?.textContent;
    expect(saidPending, "the pending message did not count one invitation").toMatch(/\b1\b/);
    expect(cancelling.pending).toBe(true);
    await ticked(ben);
    const action = selectionAction("Cancel");
    expect(action.getAttribute("aria-disabled")).toBe("true");
    action.focus();
    await pressEnter(action);
    const saidWaiting = outcomeIn()?.textContent;
    expect(saidWaiting).toMatch(/\S/);
    expect(saidWaiting, "the second press did not say that it is waiting").not.toBe(saidPending);

    cancelling.resolve();
    await waitFor(() => {
      expect(outcomeIn()?.textContent, "the first action's outcome never appeared").not.toBe(
        saidWaiting,
      );
    });
    expect(outcomeIn()?.textContent).not.toBe(saidPending);
    expect(
      outcomeIn()?.textContent,
      "the outcome did not count one cancelled and none skipped",
    ).toMatch(/^\D*1\D*$/);
    await waitFor(() => {
      expect(rowsOf(ana)).toHaveLength(0);
    });
    expect(
      asksOf("members.bulkCancelInvitations"),
      "the second press sent a second cancel request",
    ).toHaveLength(1);
    expect(tickOf(ben)?.getAttribute("aria-checked")).toBe("true");
    expect(selectionAction("Cancel").getAttribute("aria-disabled")).not.toBe("true");
  });

  it("a selection made during an action stays after a refusal", async () => {
    const [ana, ben] = [addressOf("ana"), addressOf("ben")];
    const { api } = holdingInvitations([anInvitation("ana"), anInvitation("ben")]);
    const resending = holdProcedure(api, "members.bulkResendInvitations");
    await openInvitations(api);

    await ticked(ana);
    fireEvent.click(selectionAction("Resend"));
    await resending.asked;
    await waitFor(() => {
      expect(tickOf(ana)?.getAttribute("aria-checked")).toBe("false");
    });
    await ticked(ben);
    resending.reject(NO_LONGER_WAITING(anInvitation("ana").invitationId));

    await waitFor(() => {
      expect(within(invitationsRegion()).getByRole("alert").textContent).not.toBe("");
    });
    expect(
      tickOf(ben)?.getAttribute("aria-checked"),
      "the selection made during the action was cleared",
    ).toBe("true");
    expect(selectionStatusText(), "the first selection was not restored after the refusal").toMatch(
      /\b2\b/,
    );
  });
});
