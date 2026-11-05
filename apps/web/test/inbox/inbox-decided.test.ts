import { describe, expect, it } from "vitest";
import { z } from "zod";

import { saidOfAccepting, saidOfEach, stillWaitingAfter } from "@/features/inbox/decided.ts";
import type { WaitingItem } from "@/features/inbox/inbox-api.ts";

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

describe("the message after accepting a suggestion", () => {
  it("names the proposer of an accepted change", () => {
    const said = saidOfAccepting("accepted", OWEN);

    expect(said.refused).toBe(false);
    expect(said.words).toContain("Owen Price");
  });

  it("reports a moved concept as returned, not refused", () => {
    const accepted = saidOfAccepting("accepted", OWEN).words;
    for (const word of ["stale-precondition", "resolution-moved"] as const) {
      const said = saidOfAccepting(word, OWEN);

      expect(said.refused, `${word} was reported as refused`).toBe(false);
      expect(said.words).toContain("Owen Price");
      expect(said.words, `${word} gave the same message as accepted`).not.toBe(accepted);
    }
  });

  it("marks any other outcome as refused", () => {
    const said = saidOfAccepting("owner-forbids", OWEN);

    expect(said.refused).toBe(true);
    expect(said.words).toMatch(/\S/v);
  });

  it("describes a missing proposer without a blank name", () => {
    const { words } = saidOfAccepting("accepted", null);

    expect(words).not.toMatch(/\bnull\b|\bundefined\b/v);
    expect(words, "the message left a gap where the name goes").not.toContain("  ");
  });

  it("reports each item's outcome under its title", () => {
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

  it("treats only unresolved refusals as still waiting", () => {
    expect(
      (["accepted", "resolution-moved", "already-decided", "no-such-suggestion"] as const).map(
        stillWaitingAfter,
      ),
    ).toEqual([false, false, false, false]);
    expect(stillWaitingAfter("path-taken")).toBe(true);
    expect(stillWaitingAfter("unconfirmed")).toBe(true);
  });
});
