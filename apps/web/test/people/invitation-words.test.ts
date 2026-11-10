// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  bulkResentOutcome,
  INVITATIONS_WORDS,
  INVITE_WORDS,
  invitedOutcome,
  resentOutcome,
} from "@/features/people/invitation-words.ts";
import type { InvitedOne } from "@/features/people/invitations/invitations-api.ts";
import { outcomeOfSendingFailure } from "@/features/people/refusal.tsx";
import type { Outcome } from "@/shared/outcome.tsx";
import { carrying } from "@test/stubbed-api.ts";

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

const countsIn = (said: string): readonly string[] => said.match(/\b[1-9]\d*\b/g) ?? [];

const sentencesIn = (said: string): number => (said.match(/[.?!](?=\s|$)/g) ?? []).length;

const unsent = (address: string): InvitedOne => invited(address, { emailSent: false });

const plain = ({ words }: Outcome): string => {
  if (typeof words !== "string") throw new Error("the outcome is not plain words");
  return words;
};

const refused = (outcome: Outcome): string => {
  expect(outcome.tone).toBe("refused");
  return plain(outcome);
};

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

  it("counts several and names none of them", () => {
    const { tone, words } = invitedOutcome(
      [invited("ana@example.com", { replaced: true }), invited("ben@example.com")],
      "Admin",
    );

    expect(tone).toBe("said");
    expect(words).toMatch(/\b2\b/);
    expect(words).toContain("Admin");
    expect(words).not.toContain("ana@example.com");
    expect(words).not.toContain("ben@example.com");
    expect(words).toContain(THE_EXPIRY_SHOWN);
  });

  it("refuses, naming only the address whose email did not go", () => {
    const outcome = invitedOutcome(
      [unsent("ana@example.com"), invited("ben@example.com")],
      "Editor",
    );

    expect(outcome.tone).toBe("refused");
    expect(outcome.words).toContain("ana@example.com");
    expect(outcome.words).not.toContain("ben@example.com");
    expect(sentencesIn(plain(outcome))).toBe(2);
  });

  it("says in two sentences that one email did not go", () => {
    const words = refused(invitedOutcome([unsent("ana@example.com")], "Editor"));

    expect(words.split("ana@example.com")).toHaveLength(2);
    expect(words).toMatch(/\ban Editor\b/);
    expect(words).not.toContain(THE_EXPIRY_SHOWN);
    expect(sentencesIn(words)).toBe(2);
  });

  it("gives one unsent email among several its own form", () => {
    const one = refused(
      invitedOutcome([unsent("a@example.com"), invited("b@example.com")], "Editor"),
    );
    const two = refused(
      invitedOutcome([unsent("a@example.com"), unsent("b@example.com")], "Editor"),
    );

    expect(formOf(one.replace("a@example.com", ""))).not.toBe(
      formOf(two.replace("a@example.com, b@example.com", "")),
    );
    expect(sentencesIn(two)).toBe(2);
  });
});

describe("a bulk action's outcome", () => {
  it("counts the invitations resent", () => {
    const outcome = bulkResentOutcome([invited("a@example.com"), invited("b@example.com")]);

    expect(outcome.tone).toBe("said");
    expect(countsIn(plain(outcome))).toEqual(["2"]);
    expect(sentencesIn(plain(outcome))).toBe(1);
  });

  it("counts only emails that went, and names the rest", () => {
    const words = refused(
      bulkResentOutcome([
        invited("a@example.com"),
        invited("b@example.com"),
        unsent("c@example.com"),
      ]),
    );

    expect(countsIn(words)).toEqual(["2"]);
    expect(words).toContain("c@example.com");
    expect(words).not.toContain("a@example.com");
    expect(sentencesIn(words)).toBe(2);
  });

  it("gives one resent and one unsent their own form", () => {
    const one = refused(bulkResentOutcome([invited("a@example.com"), unsent("c@example.com")]));
    const many = refused(
      bulkResentOutcome([
        invited("a@example.com"),
        invited("b@example.com"),
        unsent("c@example.com"),
        unsent("d@example.com"),
      ]),
    );

    expect(countsIn(one)).toEqual(["1"]);
    expect(formOf(one.replace("c@example.com", ""))).not.toBe(
      formOf(many.replace("c@example.com, d@example.com", "")),
    );
  });

  it("claims no invitation resent when no email went", () => {
    const words = refused(bulkResentOutcome([unsent("c@example.com")]));
    const [notSent] = refused(resentOutcome(unsent("c@example.com"))).split(". ");

    expect(countsIn(words)).toEqual([]);
    expect(words).toContain("c@example.com");
    expect(words.startsWith(`${String(notSent)}. `)).toBe(true);
    expect(sentencesIn(words)).toBe(2);
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
