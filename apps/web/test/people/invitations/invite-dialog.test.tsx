import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { INVITE_WORDS } from "@/features/people/invitation-words.ts";
import { MOST_AT_ONCE } from "@/features/people/invitations/invite-addresses.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import {
  addressField,
  addressOf,
  asksOf,
  dialogClosed,
  dialogOpened,
  doneButton,
  firstAlertIn,
  focused,
  heldAddresses,
  holdingInvitations,
  INVITE,
  inviteAction,
  inviteDialog,
  invitationRows,
  invitationsRegion,
  openedWith,
  openInvitations,
  openPeople,
  pressedOn,
  pressEnter,
  PRIYA,
  refusalWithItems,
  removeOf,
  rowsOf,
  sendButton,
  sentTyped,
  statusChoice,
  tooManyAttempts,
  typed,
  anInvitation,
} from "@test/people/invitations-stubbed.ts";
import { holdProcedure } from "@test/stubbed-api.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const JOINED_MEANWHILE = refusalWithItems("already-a-member", "conflict", 409, {
  1: "already-a-member",
});

const alertIn = (where: HTMLElement) => firstAlertIn(where).textContent;

const sentSaid = () => within(inviteDialog()).getAllByRole("status")[0]?.textContent ?? "";

describe("the People page's Invitations tab", () => {
  it("flags a member's address before anything is sent", async () => {
    await openedWith();
    const member = PRIYA.address.toUpperCase();

    await dialogOpened();
    typed(member);
    await pressEnter(addressField());

    expect(heldAddresses()).toHaveLength(1);
    expect(removeOf(member, INVITE_WORDS.flag["already-a-member"])).toBeDefined();
    expect(sendButton().getAttribute("aria-disabled")).toBe("true");
    await pressEnter(addressField());
    await focused(removeOf(member));
    expect(alertIn(inviteDialog()), "no alert asked to fix the flagged address").toMatch(/\S/);
    pressedOn("Escape");
    await dialogClosed();
    await focused(inviteAction());
    expect(invitationRows()).toHaveLength(0);
    expect(asksOf("members.invite")).toEqual([]);
  });

  it("flags an address that became a member during the send", async () => {
    const { api } = holdingInvitations([]);
    api.set("members.invite", () => JOINED_MEANWHILE);
    await openInvitations(api);
    const [other, joined] = [addressOf("other"), addressOf("joined")];

    await sentTyped(`${other}, ${joined}`);

    await waitFor(() => {
      expect(alertIn(inviteDialog()), "no alert asked to fix the flagged address").toMatch(/\S/);
    });
    expect(asksOf("members.invite")).toEqual([{ addresses: [other, joined], role: "Viewer" }]);
    await focused(removeOf(joined));
    expect(removeOf(joined, INVITE_WORDS.flag["already-a-member"])).toBeDefined();
    expect(removeOf(other, INVITE_WORDS.flag.ready)).toBeDefined();
  });

  it("flags an invalid address and sends nothing", async () => {
    await openedWith();
    const [ana, ben] = [addressOf("ana"), addressOf("ben")];

    await dialogOpened();
    typed(`${ana}, not-an-address, ${ben}`);
    await pressEnter(addressField());

    expect(heldAddresses()).toHaveLength(3);
    expect(removeOf("not-an-address", INVITE_WORDS.flag.malformed)).toBeDefined();
    expect(
      within(inviteDialog())
        .getAllByRole("status")
        .map((status) => status.textContent),
      "the dialog did not count two ready and one flagged",
    ).toContainEqual(expect.stringMatching(/\b2\b\D+\b1\b/));
    expect(sendButton().getAttribute("aria-disabled")).toBe("true");
    await pressEnter(addressField());
    await focused(removeOf("not-an-address"));
    expect(alertIn(inviteDialog()), "no alert asked to fix the flagged address").toMatch(/\S/);
    expect(asksOf("members.invite"), "the flagged send called the api").toEqual([]);

    await pressEnter(removeOf("not-an-address"));
    expect(heldAddresses()).toHaveLength(2);
    await focused(removeOf(ben));
    expect(sendButton().getAttribute("aria-disabled")).toBe("false");
    expect(sendButton().textContent).toBe("Send 2 Invitations");
    fireEvent.click(sendButton());

    await screen.findByRole("button", { name: "Done" });
    expect(sentSaid()).toMatch(/\b2\b/);
    expect(asksOf("members.invite")).toEqual([{ addresses: [ana, ben], role: "Viewer" }]);
    fireEvent.click(doneButton());
    await dialogClosed();
    await waitFor(() => {
      expect(invitationRows()).toHaveLength(2);
    });
  });

  it("removing addresses moves focus up, then to the field", async () => {
    await openedWith();
    const [ana, ben] = [addressOf("ana"), addressOf("ben")];

    await dialogOpened();
    typed(`${ana}, ${ben}`);
    await pressEnter(addressField());
    expect(heldAddresses()).toHaveLength(2);

    await pressEnter(removeOf(ben));
    await focused(removeOf(ana));
    await pressEnter(removeOf(ana));

    expect(heldAddresses()).toHaveLength(0);
    await focused(addressField());
  });

  it("sends 50 at once and keeps the 51st typed", async () => {
    await openedWith();
    const fifty = Array.from({ length: MOST_AT_ONCE }, (_, at) =>
      addressOf(`person-${String(at)}`),
    );
    const late = addressOf(`person-${String(MOST_AT_ONCE)}`);

    await dialogOpened();
    typed([...fifty, late].join(", "));
    await pressEnter(addressField());

    expect(heldAddresses()).toHaveLength(MOST_AT_ONCE);
    expect(addressField().value).toBe(late);
    expect(alertIn(inviteDialog()), "the alert did not give the limit").toMatch(/\b50\b/);
    expect(sendButton().textContent).toBe("Send 50 Invitations");
    fireEvent.click(sendButton());

    await waitFor(() => {
      expect(sentSaid(), "the outcome did not count 50 sent and 1 waiting").toMatch(
        /\b50\b.*\b1\b/,
      );
    });
    const sentFifty = sentSaid();
    expect(asksOf("members.invite"), "the 51st address was sent with the first 50").toEqual([
      { addresses: fifty, role: "Viewer" },
    ]);
    const next = within(inviteDialog()).getByRole("button", { name: INVITE });
    await focused(next);
    await pressEnter(next);
    await focused(addressField());
    expect(addressField().value, "the next invite did not start with the 51st address").toBe(late);
    fireEvent.click(sendButton());

    await waitFor(() => {
      expect(sentSaid()).toContain(late);
    });
    expect(sentSaid(), "the outcome still describes the first 50").not.toBe(sentFifty);
    await focused(doneButton());
    fireEvent.click(doneButton());
    await dialogClosed();
    await statusChoice("Waiting", 51);
  });

  it("inviting a waiting address replaces its invitation", async () => {
    const sam = addressOf("sam");
    const { api } = holdingInvitations([anInvitation("sam")]);
    await openInvitations(api);
    await statusChoice("Waiting", 1);

    await dialogOpened();
    typed(sam);
    fireEvent.click(sendButton());

    await waitFor(() => {
      expect(sentSaid()).toContain(sam);
    });
    fireEvent.click(doneButton());
    await dialogClosed();
    await statusChoice("Waiting", 1);
    await statusChoice("Cancelled", 1);
  });

  it("shows an unsent email with a Resend button", async () => {
    const offline = addressOf("offline");
    const { api } = holdingInvitations([], [offline]);
    await openInvitations(api);

    await dialogOpened();
    typed(offline);
    fireEvent.click(sendButton());

    const unsent = await within(inviteDialog()).findByRole("region", { name: "Unsent Emails" });
    expect(alertIn(inviteDialog())).toContain(offline);
    expect(sentSaid()).toBe("");
    const resend = within(unsent).getByRole("button", { name: `Resend Invitation to ${offline}` });
    resend.focus();
    fireEvent.click(resend);
    await waitFor(() => {
      expect(alertIn(unsent)).toContain(offline);
    });
    expect(within(unsent).getByRole("status").textContent).toBe("");
    await focused(resend);
    fireEvent.click(doneButton());
    await dialogClosed();
    expect(rowsOf(offline), "the invitation was not listed after its email failed").toHaveLength(1);
  });

  for (const tab of ["Members", "Invitations", "Requests"] as const) {
    it(`shows unsent emails on ${tab} after the dialog closes mid-send`, async () => {
      const offline = addressOf("offline");
      const { api } = holdingInvitations([], [offline]);
      const invite = holdProcedure(api, "members.invite");
      await openPeople(api, tab);
      const region = screen.getByRole("region", { name: tab });

      await dialogOpened();
      typed(offline);
      fireEvent.click(sendButton());
      await invite.asked;
      pressedOn("Escape");
      await dialogClosed();
      invite.resolve();

      expect(
        await within(region).findByRole("button", { name: `Resend Invitation to ${offline}` }),
      ).toBeDefined();
      expect(alertIn(region)).toContain(offline);
    });
  }

  it("a refusal after the dialog closes names the refused address", async () => {
    const { api } = holdingInvitations([]);
    const invite = holdProcedure(api, "members.invite");
    await openInvitations(api);
    const [other, joined] = [addressOf("other"), addressOf("joined")];

    await sentTyped(`${other}, ${joined}`);
    await invite.asked;
    pressedOn("Escape");
    await dialogClosed();
    invite.reject(JOINED_MEANWHILE);

    await waitFor(() => {
      const said = firstAlertIn(invitationsRegion());
      expect(
        within(said)
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual([expect.stringContaining(joined)]);
    });
    fireEvent.click(inviteAction());
    await screen.findByRole("dialog", { name: INVITE });
    expect(addressField().value, "the dialog lost the addresses that were not sent").toBe(
      `${other}, ${joined}`,
    );
  });

  it("the dialog removes an address once its resend succeeds", async () => {
    const [offline, other] = [addressOf("offline"), addressOf("other")];
    const { api, reachable } = holdingInvitations([], [offline, other]);
    await openInvitations(api);

    await dialogOpened();
    typed(`${offline}, ${other}`);
    fireEvent.click(sendButton());
    const unsent = await within(inviteDialog()).findByRole("region", { name: "Unsent Emails" });
    expect(within(unsent).getAllByRole("listitem")).toHaveLength(2);

    reachable(offline);
    fireEvent.click(
      within(unsent).getByRole("button", { name: `Resend Invitation to ${offline}` }),
    );
    await waitFor(() => {
      expect(within(unsent).getAllByRole("listitem")).toHaveLength(1);
    });
    expect(within(unsent).getByRole("status").textContent).toContain(offline);
    expect(
      within(unsent).getByRole("button", { name: `Resend Invitation to ${other}` }),
    ).toBeDefined();
    expect(document.activeElement, "focus did not move to the Unsent Emails heading").toBe(
      within(unsent).getByRole("heading", { name: "Unsent Emails" }),
    );
  });

  it("says when to try again after too many emails", async () => {
    const capped = addressOf("capped");
    const { api } = holdingInvitations([anInvitation("capped")]);
    api.set("members.invite", () => tooManyAttempts(150));
    await openInvitations(api);

    await dialogOpened();
    typed(capped);
    sendButton().focus();
    fireEvent.click(sendButton());

    await waitFor(() => {
      expect(alertIn(inviteDialog())).toMatch(/\b3\b/);
    });
    expect(asksOf("members.invite")).toEqual([{ addresses: [capped], role: "Viewer" }]);
    await focused(sendButton());
  });
});
