// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ListedConnectedSource } from "@/features/sources/sources-api.ts";
import { destinationOf, instantWords, lastSyncedWords } from "@/features/sources/words.ts";

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
});
