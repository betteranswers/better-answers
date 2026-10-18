// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ListedConnectedSource } from "@/features/sources/sources-api.ts";
import {
  AUDIENCE_WORDS,
  CONNECT_WORDS,
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

const formOf = (said: string): string => said.replaceAll(/\d+/g, "");

const countsIn = (said: string): readonly string[] => said.match(/\b\d+\b/g) ?? [];

const spoken = (word: string): string => word.toLowerCase().replaceAll("’", "'");

describe("a connected source's last sync", () => {
  it("shows no time for a source never synced", () => {
    expect(lastSyncedWords(null)).not.toBe("");
    expect(lastSyncedWords(null)).not.toMatch(/\d/);
  });

  it("gives a finished sync's time alone", () => {
    expect(lastSyncedWords(aSync("done", FINISHED))).toBe(instantWords(FINISHED));
  });

  it("marks a failed sync beside the time it finished", () => {
    const failed = lastSyncedWords(aSync("failed", FINISHED));

    expect(failed).toContain(instantWords(FINISHED));
    expect(failed).not.toBe(instantWords(FINISHED));
  });

  it("shows a sync given up on as a failed one", () => {
    expect(lastSyncedWords(aSync("poisoned", FINISHED))).toBe(
      lastSyncedWords(aSync("failed", FINISHED)),
    );
  });

  it("tells a queued sync from a claimed one, since asked", () => {
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
  it("gives each destination it knows a meaning of its own", () => {
    for (const stored of ["passage-index", "bundle", "map"]) {
      const { word, means } = destinationOf(stored);
      expect(means).not.toBe(stored);
      expect(means).not.toBe(word);
    }
    expect(destinationOf("bundle").word).not.toBe("bundle");
  });

  it("shows a destination it has not met as itself", () => {
    expect(destinationOf("archive").means).toBe("archive");
  });
});

describe("a retention class", () => {
  it("gives each retention class it knows its own meaning", () => {
    for (const stored of ["mirror", "keep", "transient"]) {
      expect(retentionOf(stored).means).not.toBe(stored);
    }
  });

  it("shows a retention class it has not met as itself", () => {
    expect(retentionOf("forever").means).toBe("forever");
  });
});

describe("a connected source's stored values", () => {
  it("gives each state its own word, whatever its case", () => {
    const words = Object.values(STATE_WORDS);

    expect(STATE_WORDS.received).toMatch(/^received$/iv);
    expect(STATE_WORDS.indexing).toMatch(/^indexing$/iv);
    expect(STATE_WORDS.indexed).toMatch(/^indexed$/iv);
    expect(STATE_WORDS.published).toMatch(/^published$/iv);
    expect(new Set(words).size).toBe(words.length);
  });

  it("gives each row action a label no other has", () => {
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
  it("gives every rule the worker raises its own word", () => {
    const ruleIds = Object.keys(RULES_RAISED);
    const read = Object.fromEntries(ruleIds.map((ruleId) => [ruleId, spoken(ruleWordOf(ruleId))]));

    expect(read).toEqual(RULES_RAISED);
    expect(new Set(Object.values(read)).size).toBe(ruleIds.length);
  });

  it("shows a rule it has not met as its id", () => {
    expect(ruleWordOf("UK_PASSPORT")).toBe("UK_PASSPORT");
  });
});

describe("how many documents a sync left unreadable", () => {
  it("counts the unreadable alone while none needs OCR", () => {
    expect(countsIn(unreadableCounted(4, 0))).toEqual(["4"]);
    expect(formOf(unreadableCounted(1, 0))).not.toBe(formOf(unreadableCounted(4, 0)));
  });

  it("counts the scans needing OCR beside the unreadable", () => {
    expect(countsIn(unreadableCounted(4, 2))).toEqual(["4", "2"]);
    expect(countsIn(unreadableCounted(1, 1))).toEqual(["1", "1"]);
    expect(formOf(unreadableCounted(4, 1))).not.toBe(formOf(unreadableCounted(4, 2)));
  });
});

describe("what the review counts", () => {
  it("counts the findings in each line", () => {
    expect(countsIn(REVIEW_WORDS.keep.done(1, 3))).toEqual(["1", "3"]);
    expect(countsIn(REVIEW_WORDS.dismissed.says(1))).toEqual(["1"]);
    expect(countsIn(REVIEW_WORDS.keptStillWithheld.says(2))).toEqual(["2"]);
  });

  it("names a group's checkbox by category, rule and document", () => {
    const named = REVIEW_WORDS.select({
      category: "bank-details",
      ruleId: "UK_BANK_ACCOUNT",
      title: "Form",
    });

    expect(named).toMatch(/bank details/i);
    expect(named).toContain(ruleWordOf("UK_BANK_ACCOUNT"));
    expect(named).toContain("Form");
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
    const said = changes[1]?.says.toLowerCase() ?? "";
    const from = said.indexOf(AUDIENCE_WORDS.groups.toLowerCase());

    expect(changes.map((change) => change.term)).toEqual(["Sensitivity", "Audience"]);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(said.indexOf(AUDIENCE_WORDS.everyone.toLowerCase())).toBeGreaterThan(from);
  });

  it("lists nothing where neither term moves", () => {
    expect(termsThatChange(present, present)).toEqual([]);
  });
});

describe("the connect dialog's audience hint", () => {
  it("sends the reader to no page", () => {
    expect(CONNECT_WORDS.audienceHint).not.toMatch(/People/v);
  });
});
