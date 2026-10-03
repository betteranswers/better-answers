import { describe, expect, it } from "vitest";

import type { Result } from "../src/result.ts";
import { storeOver, type Received, type Store } from "../src/store.ts";
import { d1StandIn } from "./d1.ts";

const NOW_MS = 1_791_000_000_000;
const DAY_MS = 86_400_000;

const valueOf = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`the store answered an error: ${result.error}`);
  return result.value;
};

const receivedAt = (receivedAtMs: number): Received => ({
  receivedAtMs,
  recipient: "admin@journeys.example",
  from: "Better Answers <sign-in@better-answers.example>",
  subject: `Sent at ${String(receivedAtMs)}`,
  raw: new TextEncoder().encode(`Subject: Sent at ${String(receivedAtMs)}\r\n\r\nYour code\r\n`),
});

/** The ids it minted, in the order given. */
const keptAt = async (store: Store, ...times: readonly number[]): Promise<readonly string[]> => {
  const ids: string[] = [];
  for (const receivedAtMs of times) ids.push(valueOf(await store.keep(receivedAt(receivedAtMs))));
  return ids;
};

const listedIds = async (store: Store, after?: string, limit = 100) => {
  const page = valueOf(await store.page({ after, limit }));
  return { ids: page.messages.map(({ id }) => id), hasMore: page.hasMore };
};

describe("the test inbox's store", () => {
  it("lists newest first, up to the limit, with more remaining", async () => {
    const store = storeOver(d1StandIn().database);
    const [oldest, middle, newest] = await keptAt(
      store,
      NOW_MS - 3000,
      NOW_MS - 2000,
      NOW_MS - 1000,
    );

    expect(await listedIds(store, undefined, 2)).toEqual({ ids: [newest, middle], hasMore: true });
    expect(await listedIds(store)).toEqual({ ids: [newest, middle, oldest], hasMore: false });
  });

  it("pages after an id, its last page with nothing more", async () => {
    const store = storeOver(d1StandIn().database);
    const [oldest, middle] = await keptAt(store, NOW_MS - 3000, NOW_MS - 2000, NOW_MS - 1000);

    expect(await listedIds(store, middle, 2)).toEqual({ ids: [oldest], hasMore: false });
  });

  it("pages past an id whose row is already gone", async () => {
    const d1 = d1StandIn();
    const store = storeOver(d1.database);
    const [oldest, middle] = await keptAt(store, NOW_MS - 3000, NOW_MS - 2000, NOW_MS - 1000);
    d1.forget(middle ?? "");

    expect(await listedIds(store, middle, 2)).toEqual({ ids: [oldest], hasMore: false });
  });

  it("answers an empty page while nothing is kept", async () => {
    expect(await listedIds(storeOver(d1StandIn().database))).toEqual({ ids: [], hasMore: false });
  });

  it("mints ids that sort by the time received", async () => {
    const store = storeOver(d1StandIn().database);
    const [earlier, later] = await keptAt(store, NOW_MS, NOW_MS + 1);

    expect(earlier).toMatch(/^0001791000000000-[0-9a-f]{16}$/);
    expect(later).toMatch(/^0001791000000001-[0-9a-f]{16}$/);
  });

  it("deletes rows more than a day old, keeping younger ones", async () => {
    const store = storeOver(d1StandIn().database);
    const [, dayOld, recent] = await keptAt(
      store,
      NOW_MS - DAY_MS - 1,
      NOW_MS - DAY_MS,
      NOW_MS - 1,
    );

    expect(valueOf(await store.prune(NOW_MS))).toBeUndefined();
    expect(await listedIds(store)).toEqual({ ids: [recent, dayOld], hasMore: false });
  });

  it("keeps each field, and the raw bytes byte for byte", async () => {
    const store = storeOver(d1StandIn().database);
    const everyByte = Uint8Array.from({ length: 256 }, (_, byte) => byte);
    const id = valueOf(await store.keep({ ...receivedAt(NOW_MS), raw: everyByte }));

    expect(valueOf(await store.message(id))).toEqual({
      id,
      receivedAtMs: NOW_MS,
      recipient: "admin@journeys.example",
      from: "Better Answers <sign-in@better-answers.example>",
      subject: "Sent at 1791000000000",
      raw: everyByte,
    });
  });

  it("answers no message for an id it never kept", async () => {
    const store = storeOver(d1StandIn().database);

    expect(valueOf(await store.message("0001791000000000-0000000000000000"))).toBeUndefined();
  });

  it("writes one probe row and deletes it", async () => {
    const d1 = d1StandIn();
    const store = storeOver(d1.database);

    expect(valueOf(await store.probe(NOW_MS))).toBeUndefined();
    expect(d1.ran.map((query) => query.split(" ")[0])).toEqual(["INSERT", "DELETE"]);
    expect(await listedIds(store)).toEqual({ ids: [], hasMore: false });
  });
});

describe("the test inbox's store over a failing D1", () => {
  const failing = (): Store => storeOver(d1StandIn(/./).database);

  it.each([
    ["keep", (store: Store) => store.keep(receivedAt(NOW_MS))],
    ["prune", (store: Store) => store.prune(NOW_MS)],
    ["page", (store: Store) => store.page({ after: undefined, limit: 100 })],
    ["message", (store: Store) => store.message("0001791000000000-0000000000000000")],
    ["probe", (store: Store) => store.probe(NOW_MS)],
  ])("answers %s's failure as an error, never a throw", async (_, asked) => {
    expect(await asked(failing())).toEqual({
      ok: false,
      error: "D1_ERROR: the stand-in refuses this statement",
    });
  });

  it("deletes nothing when the probe cannot write", async () => {
    const d1 = d1StandIn(/^INSERT/);

    expect((await storeOver(d1.database).probe(NOW_MS)).ok).toBe(false);
    expect(d1.ran.map((query) => query.split(" ")[0])).toEqual(["INSERT"]);
  });
});
