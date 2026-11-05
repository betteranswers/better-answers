// @vitest-environment node

import { assert, describe, expect, it } from "vitest";

import { DESTINATIONS, RETENTION_CLASSES } from "@better-answers/schema";

import type { ListedConnectedSource } from "@/features/sources/sources-api.ts";
import {
  AUDIENCE_WORDS,
  DESTINATION_MEANS,
  instantWords,
  lastSyncedWords,
  RETENTION_MEANS,
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

const withoutNumbers = (text: string): string => text.replaceAll(/\d+/g, "");

const numbersIn = (text: string): readonly string[] => text.match(/\b\d+\b/g) ?? [];

const lowerCased = (word: string): string => word.toLowerCase().replaceAll("’", "'");

describe("a connected source's last sync", () => {
  it("shows no time for a source that has never synced", () => {
    expect(lastSyncedWords(null)).not.toBe("");
    expect(lastSyncedWords(null)).not.toMatch(/\d/);
  });

  it("shows only the time of a finished sync", () => {
    expect(lastSyncedWords(aSync("done", FINISHED))).toBe(instantWords(FINISHED));
  });

  it("marks a failed sync next to the time it finished", () => {
    const failed = lastSyncedWords(aSync("failed", FINISHED));

    expect(failed).toContain(instantWords(FINISHED));
    expect(failed).not.toBe(instantWords(FINISHED));
  });

  it("shows an abandoned sync as failed", () => {
    expect(lastSyncedWords(aSync("poisoned", FINISHED))).toBe(
      lastSyncedWords(aSync("failed", FINISHED)),
    );
  });

  it("tells a queued sync apart from a running one", () => {
    const queued = lastSyncedWords(aSync("queued", null));
    const claimed = lastSyncedWords(aSync("claimed", null));

    for (const waiting of [queued, claimed]) {
      expect(waiting).toContain(instantWords(ENQUEUED));
      expect(waiting).not.toBe(instantWords(ENQUEUED));
    }
    expect(queued).not.toBe(claimed);
  });
});

describe("a destination", () => {
  it.each(DESTINATIONS)("describes %s in its own words", (stored) => {
    expect(DESTINATION_MEANS[stored]).not.toBe(stored);
  });
});

describe("a retention class", () => {
  it.each(RETENTION_CLASSES)("describes %s in its own words", (stored) => {
    expect(RETENTION_MEANS[stored]).not.toBe(stored);
  });
});

describe("a connected source's stored values", () => {
  it("gives each state its own label", () => {
    const words = Object.values(STATE_WORDS);

    expect(STATE_WORDS.received).toMatch(/^received$/iv);
    expect(STATE_WORDS.indexing).toMatch(/^indexing$/iv);
    expect(STATE_WORDS.indexed).toMatch(/^indexed$/iv);
    expect(STATE_WORDS.published).toMatch(/^published$/iv);
    expect(new Set(words).size).toBe(words.length);
  });

  it("gives each row action a unique label", () => {
    const labels = Object.values(ROW_ACTIONS);

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain("");
  });

  it("sentence-cases a category and a tier", () => {
    expect(sentenceCased("bank-details")).toBe("Bank details");
    expect(sentenceCased("default-on")).toBe("Default on");
    expect(sentenceCased("always")).toBe("Always");
  });
});

const RULES_RAISED = {
  HEALTH_CUE: "health wording",
  UK_BANK_ACCOUNT: "sort code and account number",
  UK_NHS: "nhs number",
  UK_NINO: "national insurance number",
  DATE_OF_BIRTH: "date of birth",
  UK_HOME_ADDRESS: "home address",
  EMAIL_ADDRESS: "personal email address",
  PHONE_NUMBER: "phone number",
  PERSON: "person's name",
  JOB_TITLE: "job title",
};

describe("a finding's rule", () => {
  it("gives every rule the worker raises a readable name", () => {
    const ruleIds = Object.keys(RULES_RAISED);
    const read = Object.fromEntries(
      ruleIds.map((ruleId) => [ruleId, lowerCased(ruleWordOf({ category: "any", ruleId }))]),
    );

    expect(read).toEqual(RULES_RAISED);
    expect(new Set(Object.values(read)).size).toBe(ruleIds.length);
  });

  it("names an unknown rule by the category it found", () => {
    expect(ruleWordOf({ category: "government-identifier", ruleId: "UK_PASSPORT" })).toBe(
      sentenceCased("government-identifier"),
    );
  });
});

describe("the count of documents a sync could not read", () => {
  it("counts unreadable documents when none needs OCR", () => {
    expect(numbersIn(unreadableCounted(4, 0))).toEqual(["4"]);
    expect(withoutNumbers(unreadableCounted(1, 0))).not.toBe(
      withoutNumbers(unreadableCounted(4, 0)),
    );
  });

  it("counts scans that need OCR separately", () => {
    expect(numbersIn(unreadableCounted(4, 2))).toEqual(["4", "2"]);
    expect(numbersIn(unreadableCounted(1, 1))).toEqual(["1", "1"]);
    expect(withoutNumbers(unreadableCounted(4, 1))).not.toBe(
      withoutNumbers(unreadableCounted(4, 2)),
    );
  });
});

describe("the numbers in review messages", () => {
  it("includes the counts of groups and findings", () => {
    expect(numbersIn(REVIEW_WORDS.keep.done(1, 3))).toEqual(["1", "3"]);
    expect(numbersIn(REVIEW_WORDS.dismissed.says(1))).toEqual(["1"]);
    expect(numbersIn(REVIEW_WORDS.keptStillWithheld.says(2))).toEqual(["2"]);
  });

  it("names a group's checkbox by category, rule and document", () => {
    const named = REVIEW_WORDS.select({
      category: "bank-details",
      ruleId: "UK_BANK_ACCOUNT",
      title: "Form",
    });

    expect(named).toMatch(/bank details/i);
    expect(named).toContain(ruleWordOf({ category: "bank-details", ruleId: "UK_BANK_ACCOUNT" }));
    expect(named).toContain("Form");
  });
});

describe("the terms a narrowing or widening changes", () => {
  const present = { sensitivity: "Restricted", audience: "groups" } as const;

  it("lists only the sensitivity when the audience is unchanged", () => {
    const changes = termsThatChange(present, { sensitivity: "Internal", audience: "groups" });

    expect(changes.map((change) => change.term)).toEqual(["Sensitivity"]);
    expect(changes[0]?.says).toMatch(/Restricted.+Internal/v);
  });

  it("adds the audience when it changes too", () => {
    const changes = termsThatChange(present, { sensitivity: "Internal", audience: "everyone" });
    const [, audience] = changes;
    assert(audience !== undefined, "the audience change is missing from the list");
    const said = audience.says.toLowerCase();
    const from = said.indexOf(AUDIENCE_WORDS.groups.toLowerCase());

    expect(changes.map((change) => change.term)).toEqual(["Sensitivity", "Audience"]);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(said.indexOf(AUDIENCE_WORDS.everyone.toLowerCase())).toBeGreaterThan(from);
  });

  it("lists nothing when neither term changes", () => {
    expect(termsThatChange(present, present)).toEqual([]);
  });
});
