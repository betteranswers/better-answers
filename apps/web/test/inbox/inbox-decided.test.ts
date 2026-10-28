import { describe, expect, it } from "vitest";
import { z } from "zod";

import { saidOfAccepting, saidOfEach, stillWaitingAfter } from "@/features/inbox/decided.ts";
import type { WaitingItem } from "@/features/inbox/inbox-api.ts";
import { DECIDED_WORDS, SAID_OF_ACCEPTING } from "@/features/inbox/inbox-words.ts";

const OWEN = { id: z.string().brand<"UserId">().parse("u-owen"), name: "Owen Price" };

const anItem = (suggestionId: string, title: string): WaitingItem => ({
  suggestionId,
  title,
  proposer: OWEN,
  proposedAt: "2026-10-20T09:00:00.000Z",
  target: null,
  collection: "policy",
  owner: null,
  baseMoved: false,
  places: 0,
});

describe("what accepting a suggestion says", () => {
  it("names the proposer as author of an accepted change", () => {
    expect(saidOfAccepting("accepted", OWEN)).toEqual({
      words: DECIDED_WORDS.accepted("Owen Price"),
      refused: false,
    });
  });

  it("says a moved concept returned the suggestion, unrefused", () => {
    for (const word of ["stale-precondition", "resolution-moved"] as const) {
      expect(saidOfAccepting(word, OWEN)).toEqual({
        words: DECIDED_WORDS.returned("Owen Price"),
        refused: false,
      });
    }
  });

  it("refuses any other word in its own sentence", () => {
    expect(saidOfAccepting("owner-forbids", OWEN)).toEqual({
      words: SAID_OF_ACCEPTING["owner-forbids"],
      refused: true,
    });
  });

  it("reads a proposer with no person as a former member", () => {
    expect(saidOfAccepting("accepted", null).words).toBe(DECIDED_WORDS.accepted("a former member"));
  });

  it("says each item's outcome by its title", () => {
    const items = [anItem("s1", "Annual leave"), anItem("s2", "Expense claims")];

    const said = saidOfEach(
      [
        { suggestionId: "s2", outcome: "already-decided" },
        { suggestionId: "s1", outcome: "accepted" },
      ],
      items,
    );

    expect(said.map(({ title, refused }) => [title, refused])).toEqual([
      ["Expense claims", true],
      ["Annual leave", false],
    ]);
  });

  it("keeps a refusal on its page only while still waiting", () => {
    expect(
      (["accepted", "resolution-moved", "already-decided", "no-such-suggestion"] as const).map(
        stillWaitingAfter,
      ),
    ).toEqual([false, false, false, false]);
    expect(stillWaitingAfter("path-taken")).toBe(true);
  });
});
