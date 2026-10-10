// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ListedConnectedSource } from "@/features/sources/sources-api.ts";
import {
  CONNECT_WORDS,
  CONNECTOR_WORDS,
  destinationOf,
  instantWords,
  lastSyncedWords,
  retentionOf,
  REVIEW_WORDS,
  ROW_ACTIONS,
  ruleWordOf,
  sentenceCased,
  STATE_WORDS,
  termsThatChange,
  unreadableCounted,
} from "@/features/sources/words.ts";

type Sync = NonNullable<ListedConnectedSource["lastSync"]>;

const ENQUEUED = "2026-10-07T09:00:00.000Z";
const FINISHED = "2026-10-07T09:05:00.000Z";

const aSync = (status: Sync["status"], finishedAt: string | null): Sync => ({
  jobId: "01JZZZZZZZZZZZZZZZZZZZZZZZ",
  kind: "index",
  reason: "connected",
  status,
  attempts: 1,
  enqueuedAt: ENQUEUED,
  finishedAt,
});

describe("what a connected source's last sync says", () => {
  it("says a source with no sync is not synced yet", () => {
    expect(lastSyncedWords(null)).toBe("Not synced yet");
  });

  it("gives a finished sync's time alone", () => {
    expect(lastSyncedWords(aSync("done", FINISHED))).toBe(instantWords(FINISHED));
  });

  it("says a failed sync failed, and when", () => {
    expect(lastSyncedWords(aSync("failed", FINISHED))).toBe(
      `Sync failed · ${instantWords(FINISHED)}`,
    );
  });

  it("says a sync given up on failed too", () => {
    expect(lastSyncedWords(aSync("poisoned", FINISHED))).toBe(
      `Sync failed · ${instantWords(FINISHED)}`,
    );
  });

  it("says a queued sync is queued, since it was asked", () => {
    expect(lastSyncedWords(aSync("queued", null))).toBe(`Sync queued · ${instantWords(ENQUEUED)}`);
  });

  it("says a claimed sync is syncing, since it was asked", () => {
    expect(lastSyncedWords(aSync("claimed", null))).toBe(`Syncing · ${instantWords(ENQUEUED)}`);
  });
});

describe("what a destination says", () => {
  // The words test cannot see this label: a reader string equal to the kept wire value is skipped.
  it("names the bundle destination the knowledge base", () => {
    expect(destinationOf("bundle").word).toBe("knowledge base");
  });

  it("gives a sentence that no stored word leads", () => {
    for (const stored of ["passage-index", "bundle", "map"]) {
      const { word, means } = destinationOf(stored);
      expect(means).toMatch(/^\p{Lu}.+\.$/v);
      expect(means.startsWith(stored)).toBe(false);
      expect(means.toLowerCase().startsWith(word)).toBe(false);
    }
  });

  it("shows a destination it has not met as itself", () => {
    expect(destinationOf("archive").means).toBe("archive");
  });
});

describe("what a retention class says", () => {
  it("gives a sentence that no stored word leads", () => {
    for (const stored of ["mirror", "keep", "transient"]) {
      const { means } = retentionOf(stored);
      expect(means).toMatch(/^\p{Lu}.+\.$/v);
      expect(means.toLowerCase().startsWith(stored)).toBe(false);
    }
  });

  it("shows a retention class it has not met as itself", () => {
    expect(retentionOf("forever").means).toBe("forever");
  });
});

describe("what a connected source's stored values read as", () => {
  it("gives each state its word, capitalised", () => {
    expect(STATE_WORDS).toEqual({
      received: "Received",
      indexing: "Indexing",
      indexed: "Indexed",
      published: "Published",
    });
  });

  it("names the upload connector", () => {
    expect(CONNECTOR_WORDS.upload).toBe("Upload");
  });

  it("says each row action's effect in its label", () => {
    expect(ROW_ACTIONS).toEqual({
      review: "Review findings",
      publish: "Publish",
      narrow: "Narrow sensitivity",
      widen: "Widen sensitivity or audience",
    });
  });

  it("sentence-cases a category and a tier", () => {
    expect(sentenceCased("bank-details")).toBe("Bank details");
    expect(sentenceCased("default-on")).toBe("Default on");
    expect(sentenceCased("always")).toBe("Always");
  });
});

/** Each id the worker's redaction descriptors raise, beside the word a reader meets. */
const RULES_RAISED = {
  HEALTH_CUE: "Health wording",
  UK_BANK_ACCOUNT: "Sort code and account number",
  UK_NHS: "NHS number",
  UK_NINO: "National Insurance number",
  DATE_OF_BIRTH: "Date of birth",
  UK_HOME_ADDRESS: "Home address",
  EMAIL_ADDRESS: "Personal email address",
  PHONE_NUMBER: "Phone number",
  PERSON: "Person’s name",
  JOB_TITLE: "Job title",
};

describe("what a finding's rule reads as", () => {
  it("gives every rule the worker raises its word", () => {
    const read = Object.fromEntries(
      Object.keys(RULES_RAISED).map((ruleId) => [ruleId, ruleWordOf(ruleId)]),
    );

    expect(read).toEqual(RULES_RAISED);
  });

  it("shows a rule it has not met as its id", () => {
    expect(ruleWordOf("UK_PASSPORT")).toBe("UK_PASSPORT");
  });
});

describe("how many documents a sync left unreadable", () => {
  it("says nothing of OCR while no document needs it", () => {
    expect(unreadableCounted(4, 0)).toMatch(/^4 documents unreadable\b/v);
    expect(unreadableCounted(4, 0)).not.toMatch(/OCR/v);
  });

  it("says once how many are scans needing OCR", () => {
    expect(unreadableCounted(4, 2).match(/OCR/gv)).toHaveLength(1);
    expect(unreadableCounted(4, 2)).toMatch(/\b2 are\b/v);
    expect(unreadableCounted(1, 1)).toMatch(/^1 document unreadable\b.*\b1 is\b/v);
  });
});

describe("what the review counts", () => {
  it("counts findings, never spans, and names no seam", () => {
    const said = [
      REVIEW_WORDS.lead,
      REVIEW_WORDS.alreadyNarrowed.says,
      REVIEW_WORDS.dismissed.says(1),
      REVIEW_WORDS.keptStillWithheld.says(2),
      REVIEW_WORDS.keep.consequence,
      REVIEW_WORDS.keep.done(1, 3),
      REVIEW_WORDS.dismiss.consequence,
    ];
    for (const sentence of said) expect(sentence).not.toMatch(/\bspans?\b|\bseam\b/v);

    expect(REVIEW_WORDS.keep.done(1, 3)).toContain("3 findings restored");
    expect(REVIEW_WORDS.dismissed.says(1)).toMatch(/^1 finding /v);
    expect(REVIEW_WORDS.keptStillWithheld.says(2)).toMatch(/^2 kept findings /v);
  });

  it("names a group's checkbox by its rule's word", () => {
    expect(
      REVIEW_WORDS.select({ category: "bank-details", ruleId: "UK_BANK_ACCOUNT", title: "Form" }),
    ).toBe(`Select bank details by ${ruleWordOf("UK_BANK_ACCOUNT")} in Form`);
  });
});

describe("the terms a narrowing or widening changes", () => {
  const present = { sensitivity: "Restricted", audience: "groups" } as const;

  it("lists the sensitivity alone while the audience stands", () => {
    const changes = termsThatChange(present, { sensitivity: "Internal", audience: "groups" });

    expect(changes.map((change) => change.term)).toEqual(["Sensitivity"]);
    expect(changes[0]?.says).toMatch(/Restricted.+Internal/v);
  });

  it("adds the audience once it moves too", () => {
    const changes = termsThatChange(present, { sensitivity: "Internal", audience: "everyone" });

    expect(changes.map((change) => change.term)).toEqual(["Sensitivity", "Audience"]);
    expect(changes[1]?.says).toMatch(/named groups.+everyone in the workspace/v);
  });

  it("lists nothing where neither term moves", () => {
    expect(termsThatChange(present, present)).toEqual([]);
  });
});

describe("what Connect a document says", () => {
  it("says named groups cannot be chosen yet, naming no page", () => {
    expect(CONNECT_WORDS.audienceHint).toMatch(/Named groups cannot be chosen here yet/v);
    expect(CONNECT_WORDS.audienceHint).not.toMatch(/People/v);
  });

  it("says when the sync starts without a retired word", () => {
    expect(CONNECT_WORDS.consequence).not.toMatch(/\bland(?:s|ed)?\b/v);
    expect(REVIEW_WORDS.noPassages).not.toMatch(/\bland(?:s|ed)?\b/v);
  });
});
