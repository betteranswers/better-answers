import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { TEST_INBOX_MESSAGE, TEST_INBOX_PAGE } from "@better-answers/schema/test-inbox";

import worker from "../src/index.ts";
import { storeOver } from "../src/store.ts";
import { d1StandIn, type D1StandIn } from "./d1.ts";
import { asked, DAY_MS, emailOf, NOW_MS, PERSON, PRODUCTION, receivedAt } from "./fixtures.ts";

let log: MockInstance<(...data: unknown[]) => void>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW_MS });
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const RAW_MOST_BYTES = 256 * 1024;

/** Every message kept, newest first, read back through the store. */
const keptIn = async (d1: D1StandIn) => {
  const store = storeOver(d1.database);
  const page = await store.page({ after: undefined, limit: 100 });
  if (!page.ok) throw new Error(page.error);
  return Promise.all(
    page.value.messages.map(async ({ id }) => {
      const message = await store.message(id);
      if (!message.ok || message.value === undefined) throw new Error(`no message ${id}`);
      return message.value;
    }),
  );
};

const loggedEvents = (): readonly string[] =>
  log.mock.calls.map(([line]) => String(JSON.parse(String(line)).event));

const erroring = (): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start: (controller) => {
      controller.error(new Error("the connection reset"));
    },
  });

describe("the test inbox's email handler", () => {
  it("keeps From, subject and bytes as sent; recipient lower-cased", async () => {
    const d1 = d1StandIn();
    const raw = Uint8Array.from({ length: 256 }, (_, byte) => byte);
    const message = emailOf({
      to: "Admin@Journeys.Example",
      headers: { from: "Better Answers <Sign-In@Better-Answers.Example>", subject: "Sign in" },
      raw,
    });

    await worker.email(message, { DB: d1.database });

    expect(await keptIn(d1)).toEqual([
      {
        id: expect.stringMatching(/^0001791000000000-[0-9a-f]{16}$/),
        receivedAtMs: NOW_MS,
        recipient: "admin@journeys.example",
        from: "Better Answers <Sign-In@Better-Answers.Example>",
        subject: "Sign in",
        raw,
      },
    ]);
  });

  it("keeps empty strings for a missing From and subject", async () => {
    const d1 = d1StandIn();

    await worker.email(emailOf({ headers: {} }), { DB: d1.database });
    const listed = TEST_INBOX_PAGE.parse(await (await asked(d1, "/emails/receiving")).json());

    expect(listed.data.map(({ from, subject }) => ({ from, subject }))).toEqual([
      { from: "", subject: "" },
    ]);
  });

  it("keeps a message of exactly 256 KiB", async () => {
    const d1 = d1StandIn();

    await worker.email(emailOf({ raw: new Uint8Array(RAW_MOST_BYTES) }), { DB: d1.database });

    expect((await keptIn(d1)).map(({ raw }) => raw.byteLength)).toEqual([RAW_MOST_BYTES]);
  });

  it("drops a message over 256 KiB, storing nothing", async () => {
    const d1 = d1StandIn();
    const message = emailOf({ raw: new Uint8Array(RAW_MOST_BYTES + 1) });

    await expect(worker.email(message, { DB: d1.database })).resolves.toBeUndefined();

    expect(d1.ran).toEqual([]);
    expect(loggedEvents()).toEqual(["dropped"]);
  });

  it("logs an unreadable message and returns", async () => {
    const d1 = d1StandIn();

    await expect(
      worker.email(emailOf({ stream: erroring() }), { DB: d1.database }),
    ).resolves.toBeUndefined();

    expect(d1.ran).toEqual([]);
    expect(loggedEvents()).toEqual(["unread"]);
  });

  it("logs a failed insert and returns without throwing", async () => {
    const d1 = d1StandIn(/^INSERT/);

    await expect(worker.email(emailOf(), { DB: d1.database })).resolves.toBeUndefined();

    expect(loggedEvents()).toEqual(["unstored"]);
  });

  it("deletes rows more than a day old on each insert", async () => {
    const d1 = d1StandIn();
    const store = storeOver(d1.database);
    await store.keep(receivedAt(NOW_MS - DAY_MS - 1));
    await store.keep(receivedAt(NOW_MS - DAY_MS));

    await worker.email(emailOf(), { DB: d1.database });

    expect((await keptIn(d1)).map(({ receivedAtMs }) => receivedAtMs)).toEqual([
      NOW_MS,
      NOW_MS - DAY_MS,
    ]);
  });

  it("keeps the message when the prune fails, logging it", async () => {
    const d1 = d1StandIn(/^DELETE/);

    await expect(worker.email(emailOf(), { DB: d1.database })).resolves.toBeUndefined();

    expect(await keptIn(d1)).toHaveLength(1);
    expect(loggedEvents()).toEqual(["unpruned"]);
  });

  it.each([
    ["a kept message", () => d1StandIn(), {}],
    ["an oversized message", () => d1StandIn(), { rawSize: RAW_MOST_BYTES + 1 }],
    ["an unreadable message", () => d1StandIn(), { stream: erroring() }],
    ["a failed insert", () => d1StandIn(/^INSERT/), {}],
    ["a failed prune", () => d1StandIn(/^DELETE/), {}],
  ])("never rejects or forwards %s", async (_, standIn, emailed) => {
    const message = emailOf(emailed);

    await worker.email(message, { DB: standIn().database });

    expect(message.setReject).not.toHaveBeenCalled();
    expect(message.forward).not.toHaveBeenCalled();
    expect(message.reply).not.toHaveBeenCalled();
  });
});

describe("the test inbox from receipt to read", () => {
  it("lists and retrieves a received message through the read API", async () => {
    const d1 = d1StandIn();
    const raw = new TextEncoder().encode(
      "DKIM-Signature: v=1; d=better-answers.example\r\n\r\n482913\r\n",
    );

    await worker.email(emailOf({ to: "Admin@Journeys.Example", raw }), { DB: d1.database });
    const [listed] = TEST_INBOX_PAGE.parse(
      await (await asked(d1, "/emails/receiving")).json(),
    ).data;
    const message = TEST_INBOX_MESSAGE.parse(
      await (await asked(d1, `/emails/receiving/${listed?.id ?? ""}`)).json(),
    );

    expect(listed).toEqual({
      id: message.id,
      to: [PERSON],
      from: PRODUCTION,
      created_at: "2026-10-03T04:00:00.000Z",
      subject: "Sign in",
    });
    expect(new Uint8Array(Buffer.from(message.raw, "base64"))).toEqual(raw);
  });
});
