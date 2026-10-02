// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  bulkResentOutcome,
  INVITATIONS_WORDS,
  INVITE_WORDS,
  invitedOutcome,
} from "@/features/people/invitation-words.ts";
import type { InvitedOne } from "@/features/people/invitations-api.ts";
import { invitationsCeiling } from "@/features/people/refusal-words.ts";

const AN_EXPIRY = "2026-10-09T12:00:00.000Z";

const invited = (address: string, sent: Partial<InvitedOne> = {}): InvitedOne => ({
  invitationId: `id-${address}`,
  address,
  role: "Editor",
  invitedAt: "2026-10-02T12:00:00.000Z",
  expiresAt: AN_EXPIRY,
  replaced: false,
  emailSent: true,
  ...sent,
});

describe("what an invite's outcome says", () => {
  it("names the one address invited, and its expiry", () => {
    expect(invitedOutcome([invited("ana@example.com")], "Editor")).toEqual({
      tone: "said",
      words:
        "Invited ana@example.com as an Editor. The email went, and the invitation lasts until 9 October 2026.",
    });
  });

  it("says a waiting invitation was replaced", () => {
    const { words } = invitedOutcome([invited("ana@example.com", { replaced: true })], "Viewer");

    expect(words).toContain(
      "Re-sent the invitation to ana@example.com as a Viewer, replacing the one waiting.",
    );
  });

  it("counts several and names the ones re-sent", () => {
    const { words } = invitedOutcome(
      [invited("ana@example.com", { replaced: true }), invited("ben@example.com")],
      "Admin",
    );

    expect(words).toBe(
      "Invited 2 people as Admins. Re-sent to ana@example.com, replacing the invitation waiting. The emails went, and the invitations last until 9 October 2026.",
    );
  });

  it("says loudly which emails did not go", () => {
    const outcome = invitedOutcome(
      [invited("ana@example.com", { emailSent: false }), invited("ben@example.com")],
      "Editor",
    );

    expect(outcome.tone).toBe("refused");
    expect(outcome.words).toContain(
      "The email to ana@example.com did not go, but its invitation stands.",
    );
  });
});

describe("what a bulk act's outcome says", () => {
  it("says each resent invitation's expiry", () => {
    expect(bulkResentOutcome([invited("a@example.com"), invited("b@example.com")])).toEqual({
      tone: "said",
      words: "Sent 2 invitations again. Each lasts until 9 October 2026.",
    });
  });

  it.each([
    [2, 0, "Cancelled 2 invitations; their links no longer work."],
    [1, 1, "Cancelled 1 invitation; its link no longer works. 1 invitation was already cancelled."],
    [0, 2, "Nothing was cancelled. 2 invitations were already cancelled."],
  ])("says %i cancelled and %i skipped", (changed, skipped, said) => {
    expect(INVITATIONS_WORDS.bulk.cancelled(changed, skipped)).toBe(said);
  });
});

describe("the dialog's words", () => {
  it.each([
    [0, "Send the invitation"],
    [1, "Send the invitation"],
    [3, "Send 3 invitations"],
  ])("names %i addresses on Send", (count, said) => {
    expect(INVITE_WORDS.send(count)).toBe(said);
  });

  it("counts the flagged apart from the ready", () => {
    expect(INVITE_WORDS.summary(2, 1)).toBe("2 addresses ready, 1 to fix or remove.");
    expect(INVITE_WORDS.summary(1, 0)).toBe("1 address ready.");
  });

  it("counts the addresses a capped send left waiting", () => {
    expect(INVITE_WORDS.waiting(1)).toBe("1 more address waits: invite it next.");
    expect(INVITE_WORDS.waiting(3)).toBe("3 more addresses wait: invite them next.");
  });

  it("names the wait a ceiling carried, rounded up", () => {
    expect(invitationsCeiling(61).next).toBe("Try again in 2 minutes.");
  });

  it("names the workspace and an address as either ceiling", () => {
    expect(invitationsCeiling(61).why).toMatch(/^This workspace, or an address here, has had/);
  });
});
