// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  bulkResentOutcome,
  INVITATIONS_WORDS,
  INVITE_WORDS,
  invitedOutcome,
} from "@/features/people/invitation-words.ts";
import type { InvitedOne } from "@/features/people/invitations-api.ts";
import { outcomeOfSendingFailure } from "@/features/people/refusal.tsx";

import { carrying } from "./stubbed-api.ts";

const AN_EXPIRY = "2026-10-09T12:00:00.000Z";

const THE_EXPIRY_SHOWN = "9 October 2026";

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

const formOf = (said: string): string => said.replaceAll(/\d+/g, "");

/** Each count a line shows, in order. A count of none may be a word, so no zero is read. */
const countsIn = (said: string): readonly string[] => said.match(/\b[1-9]\d*\b/g) ?? [];

describe("an invite's outcome", () => {
  it("names the one address invited, its role and its expiry", () => {
    const outcome = invitedOutcome([invited("ana@example.com")], "Editor");

    expect(outcome.tone).toBe("said");
    expect(outcome.words).toContain("ana@example.com");
    expect(outcome.words).toMatch(/\ban Editor\b/);
    expect(outcome.words).toContain(THE_EXPIRY_SHOWN);
  });

  it("says a waiting invitation was replaced", () => {
    const replaced = invitedOutcome([invited("ana@example.com", { replaced: true })], "Viewer");
    const fresh = invitedOutcome([invited("ana@example.com")], "Viewer");

    expect(replaced.words).toContain("ana@example.com");
    expect(replaced.words).toMatch(/\ba Viewer\b/);
    expect(replaced.words).not.toBe(fresh.words);
  });

  it("counts several and names only the ones re-sent", () => {
    const { tone, words } = invitedOutcome(
      [invited("ana@example.com", { replaced: true }), invited("ben@example.com")],
      "Admin",
    );

    expect(tone).toBe("said");
    expect(words).toMatch(/\b2\b/);
    expect(words).toContain("Admin");
    expect(words).toContain("ana@example.com");
    expect(words).not.toContain("ben@example.com");
    expect(words).toContain(THE_EXPIRY_SHOWN);
  });

  it("refuses, naming only the address whose email did not go", () => {
    const outcome = invitedOutcome(
      [invited("ana@example.com", { emailSent: false }), invited("ben@example.com")],
      "Editor",
    );

    expect(outcome.tone).toBe("refused");
    expect(outcome.words).toContain("ana@example.com");
    expect(outcome.words).not.toContain("ben@example.com");
  });
});

describe("a bulk action's outcome", () => {
  it("counts the invitations resent and gives their expiry", () => {
    const outcome = bulkResentOutcome([invited("a@example.com"), invited("b@example.com")]);

    expect(outcome.tone).toBe("said");
    expect(outcome.words).toMatch(/\b2\b/);
    expect(outcome.words).toContain(THE_EXPIRY_SHOWN);
  });

  it.each([
    [2, 0, ["2"]],
    [1, 1, ["1", "1"]],
    [3, 2, ["3", "2"]],
    [0, 2, ["2"]],
  ])("counts %i cancelled, then %i skipped", (changed, skipped, shown) => {
    expect(countsIn(INVITATIONS_WORDS.bulk.cancelled(changed, skipped))).toEqual(shown);
  });

  it("gives one cancelled or one skipped its own form", () => {
    const { cancelled } = INVITATIONS_WORDS.bulk;

    expect(formOf(cancelled(1, 0))).not.toBe(formOf(cancelled(2, 0)));
    expect(formOf(cancelled(2, 1))).not.toBe(formOf(cancelled(2, 2)));
  });
});

describe("the dialog's words", () => {
  it("counts the addresses on Send once there are several", () => {
    expect(INVITE_WORDS.send(0)).toBe(INVITE_WORDS.send(1));
    expect(countsIn(INVITE_WORDS.send(1))).toEqual([]);
    expect(countsIn(INVITE_WORDS.send(3))).toEqual(["3"]);
  });

  it("counts the flagged apart from the ready", () => {
    expect(countsIn(INVITE_WORDS.summary(2, 1))).toEqual(["2", "1"]);
    expect(countsIn(INVITE_WORDS.summary(1, 0))).toEqual(["1"]);
    expect(formOf(INVITE_WORDS.summary(1, 0))).not.toBe(formOf(INVITE_WORDS.summary(2, 0)));
  });

  it("counts the addresses a capped send left waiting", () => {
    expect(countsIn(INVITE_WORDS.waiting(1))).toEqual(["1"]);
    expect(countsIn(INVITE_WORDS.waiting(3))).toEqual(["3"]);
    expect(formOf(INVITE_WORDS.waiting(1))).not.toBe(formOf(INVITE_WORDS.waiting(3)));
  });

  it("names the wait a ceiling carried, rounded up", () => {
    const outcome = outcomeOfSendingFailure(carrying({ retryAfterSeconds: 61 }));

    expect(outcome.tone).toBe("refused");
    expect(outcome.words).toMatch(/\b2\b/);
  });
});
