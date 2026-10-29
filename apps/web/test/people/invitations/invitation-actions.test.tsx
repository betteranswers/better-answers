import { fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
  refusalNaming,
  rowsOf,
  selectionAction,
  selectionSaid,
  shownUnder,
  statusChoice,
  tickOf,
  ticked,
} from "@test/people/invitations-stubbed.ts";
import { heldBack } from "@test/stubbed-api.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const NO_LONGER_WAITING = (invitationId: string) =>
  refusalNaming("no-such-invitation", "absent", 404, { [invitationId]: "no-such-invitation" });

const saidInTheTab = (said: string | RegExp) =>
  within(invitationsRegion())
    .getAllByRole("status")
    .filter((status) =>
      typeof said === "string" ? status.textContent.includes(said) : said.test(status.textContent),
    );

const theHeading = () =>
  within(invitationsRegion()).getByRole("heading", { level: 2, name: "Invitations" });

describe("the People page's Invitations tab", () => {
  it("the tab's unsent list drops an address whose Resend went", async () => {
    const offline = addressOf("offline");
    const { api, reachable } = holdingInvitations([anInvitation("offline")], [offline]);
    await openInvitations(api);

    await ticked(offline);
    fireEvent.click(selectionAction("Resend"));
    const unsent = await within(invitationsRegion()).findByRole("region", {
      name: "Unsent Emails",
    });
    const resendName = `Resend Invitation to ${offline}`;
    const resend = within(unsent).getByRole("button", { name: resendName });

    reachable(offline);
    fireEvent.click(resend);
    await waitFor(() => {
      expect(within(unsent).queryByRole("button", { name: resendName })).toBeNull();
    });
    expect(within(unsent).getByRole("status").textContent).toContain(offline);
    expect(document.activeElement, "focus left with the row").toBe(
      within(unsent).getByRole("heading", { name: "Unsent Emails" }),
    );
  });

  it("an expired invitation resent from its menu waits again", async () => {
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

  it("cancelling from a row's menu hands focus to the list", async () => {
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
    await waitFor(() => {
      expect(outcomeIn()?.textContent).toMatch(/cancelled successfully/);
    });
    expect(
      outcomeIn()?.textContent,
      "the bulk cancel's outcome counts two, and none skipped",
    ).toMatch(/^\D*2\D*$/);
    expect(asksOf("members.bulkCancelInvitations")).toEqual([
      { invitationIds: [anInvitation("ana").invitationId, anInvitation("ben").invitationId] },
    ]);
    await statusChoice("Cancelled", 2);
    await statusChoice("Waiting", 0);
  });

  it("bulk Cancel counts a row cancelled meanwhile as skipped", async () => {
    const [ana, ben] = [addressOf("ana"), addressOf("ben")];
    const { api, moveTo } = holdingInvitations([anInvitation("ana"), anInvitation("ben")]);
    await openInvitations(api);

    await ticked(ana);
    await ticked(ben);
    moveTo(anInvitation("ana").invitationId, "cancelled");
    pressedOn(PEOPLE_KEYSTROKES.cancelSelected.key, true);

    await waitFor(() => {
      expect(outcomeIn()?.textContent).toMatch(/already cancelled/);
    });
    expect(outcomeIn()?.textContent, "the outcome counts one cancelled and one skipped").toMatch(
      /\b1\b\D+\b1\b/,
    );
    await statusChoice("Cancelled", 2);
  });

  it("an expired invitation resent from the bar waits again", async () => {
    const old = addressOf("old");
    const { api } = holdingInvitations([anInvitation("old", "expired")]);
    await openInvitations(api);
    await shownUnder("Expired");

    await ticked(old);
    fireEvent.click(selectionAction("Resend"));

    await waitFor(() => {
      expect(outcomeIn()?.textContent).toMatch(/resent successfully/);
    });
    expect(outcomeIn()?.textContent).toMatch(/\b1\b.*\d{4}/);
    await waitFor(() => {
      expect(rowsOf(old)).toHaveLength(0);
    });
    await statusChoice("Waiting", 1);
    await statusChoice("Expired", 0);
  });

  it("a refused bulk Resend names a row not shown", async () => {
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
      expect(selectionSaid()).toMatch(TWO_TICKED_NEITHER_SHOWN);
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
      "the refusal counts one refused",
    ).toMatch(/\b1\b/);
    expect(
      within(refusal)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining(gone)]);
    await waitFor(() => {
      expect(selectionSaid()).toMatch(TWO_TICKED_NEITHER_SHOWN);
    });
  });

  it("a second action waits on the first, whose answer lands", async () => {
    const [ana, ben] = [addressOf("ana"), addressOf("ben")];
    const { api } = holdingInvitations([anInvitation("ana"), anInvitation("ben")]);
    const cancelling = heldBack(api, "members.bulkCancelInvitations");
    await openInvitations(api);

    await ticked(ana);
    fireEvent.click(selectionAction("Cancel"));
    await cancelling.asked;
    const saidPending = outcomeIn()?.textContent;
    expect(saidPending, "the pending cancel counts its one invitation").toMatch(/\b1\b/);
    expect(cancelling.pending).toBe(true);
    await ticked(ben);
    const action = selectionAction("Cancel");
    expect(action.getAttribute("aria-disabled")).toBe("true");
    action.focus();
    pressEnter(action);
    const saidWaiting = outcomeIn()?.textContent;
    expect(saidWaiting).toMatch(/\S/);
    expect(saidWaiting, "the second press said nothing of its own").not.toBe(saidPending);
    expect(cancelling.asks, "the second press asked the api nothing").toBe(1);

    cancelling.resolve();
    await waitFor(() => {
      expect(outcomeIn()?.textContent, "the first action's outcome never landed").not.toBe(
        saidWaiting,
      );
    });
    expect(outcomeIn()?.textContent).not.toBe(saidPending);
    expect(outcomeIn()?.textContent, "the outcome counts one cancelled, and none skipped").toMatch(
      /^\D*1\D*$/,
    );
    await waitFor(() => {
      expect(rowsOf(ana)).toHaveLength(0);
    });
    expect(tickOf(ben)?.getAttribute("aria-checked")).toBe("true");
    expect(selectionAction("Cancel").getAttribute("aria-disabled")).not.toBe("true");
  });

  it("a tick made mid-act survives the bulk refusal", async () => {
    const [ana, ben] = [addressOf("ana"), addressOf("ben")];
    const { api } = holdingInvitations([anInvitation("ana"), anInvitation("ben")]);
    const resending = heldBack(api, "members.bulkResendInvitations");
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
    expect(tickOf(ben)?.getAttribute("aria-checked"), "the tick made meanwhile stays").toBe("true");
    expect(selectionSaid(), "the pressed tick comes back too").toMatch(/\b2\b/);
  });
});
