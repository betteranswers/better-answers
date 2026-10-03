import { describe, expect, it } from "vitest";

import { TEST_INBOX_MESSAGE, TEST_INBOX_PAGE } from "@better-answers/schema/test-inbox";

import { storeOver } from "../src/store.ts";
import { d1StandIn, type D1StandIn } from "./d1.ts";
import { asked, NOW_MS, PERSON, PRODUCTION, receivedAt, TOKEN } from "./fixtures.ts";

const RECEIVING = "/emails/receiving";

/** Every answer is JSON, so no answer is a redirect or an HTML page. */
const answered = async (response: Response) => {
  expect(response.headers.get("content-type")).toMatch(/^application\/json\b/);
  expect(response.headers.get("location")).toBeNull();
  return { status: response.status, body: fields(await response.json()) };
};

/** Read as JSON, typed only as far as a test asserts on it. */
const fields = (body: unknown): Readonly<Record<string, unknown>> =>
  typeof body === "object" && body !== null ? Object.fromEntries(Object.entries(body)) : {};

const keptAt = async (d1: D1StandIn, ...times: readonly number[]): Promise<readonly string[]> => {
  const store = storeOver(d1.database);
  const ids: string[] = [];
  for (const receivedAtMs of times) {
    const kept = await store.keep(receivedAt(receivedAtMs));
    if (!kept.ok) throw new Error(kept.error);
    ids.push(kept.value);
  }
  return ids;
};

const pageAt = async (d1: D1StandIn, query: string) => {
  const { status, body } = await answered(await asked(d1, `${RECEIVING}${query}`));
  expect(status).toBe(200);
  const page = TEST_INBOX_PAGE.parse(body);
  return { ids: page.data.map(({ id }) => id), hasMore: page.has_more };
};

describe("the test inbox's read API, refusing a caller", () => {
  it.each([
    ["no token", null],
    ["an empty bearer token", "Bearer "],
    ["a shorter token", "Bearer 0123"],
    ["a same-length token", `Bearer ${"f".repeat(TOKEN.length)}`],
    ["a Basic token", `Basic ${TOKEN}`],
  ])("refuses %s with 401 JSON, reading nothing", async (_, authorization) => {
    const d1 = d1StandIn();

    for (const [method, path] of [
      ["GET", RECEIVING],
      ["GET", `${RECEIVING}/0001791000000000-0000000000000000`],
      ["POST", "/probe"],
      ["GET", "/elsewhere"],
    ] as const) {
      expect(await answered(await asked(d1, path, { method, authorization }))).toEqual({
        status: 401,
        body: { name: "unauthorized" },
      });
    }
    expect(d1.ran).toEqual([]);
  });

  it.each([
    ["unset", null],
    ["under 32 characters", TOKEN.slice(1)],
  ])("answers 503 JSON while the token is %s", async (_, token) => {
    const d1 = d1StandIn();

    for (const path of [RECEIVING, "/probe"]) {
      expect(await answered(await asked(d1, path, { token }))).toEqual({
        status: 503,
        body: { name: "not_configured" },
      });
    }
    expect(d1.ran).toEqual([]);
  });
});

describe("the test inbox's list", () => {
  it("answers newest first, under the shared list shape", async () => {
    const d1 = d1StandIn();
    const [older, newer] = await keptAt(d1, NOW_MS - 1000, NOW_MS);
    const { status, body } = await answered(await asked(d1, `${RECEIVING}?limit=100`));

    expect(status).toBe(200);
    expect(TEST_INBOX_PAGE.parse(body)).toEqual({
      object: "list",
      has_more: false,
      data: [
        {
          id: newer,
          to: [PERSON],
          from: PRODUCTION,
          created_at: "2026-10-03T04:00:00.000Z",
          subject: "Sent at 1791000000000",
        },
        {
          id: older,
          to: [PERSON],
          from: PRODUCTION,
          created_at: "2026-10-03T03:59:59.000Z",
          subject: "Sent at 1790999999000",
        },
      ],
    });
  });

  it("honours limit and after, setting has_more while rows remain", async () => {
    const d1 = d1StandIn();
    const [oldest, middle, newest] = await keptAt(d1, NOW_MS - 2, NOW_MS - 1, NOW_MS);

    expect(await pageAt(d1, "?limit=2")).toEqual({ ids: [newest, middle], hasMore: true });
    expect(await pageAt(d1, `?limit=2&after=${middle ?? ""}`)).toEqual({
      ids: [oldest],
      hasMore: false,
    });
  });

  it("holds a limit above 100 to 100", async () => {
    const d1 = d1StandIn();
    await keptAt(d1, ...Array.from({ length: 101 }, (_, at) => NOW_MS + at));
    const page = await pageAt(d1, "?limit=500");

    expect(page.ids).toHaveLength(100);
    expect(page.hasMore).toBe(true);
  });

  it.each([
    ["0", 1],
    ["-5", 1],
    ["1.9", 1],
    ["many", 3],
    ["", 3],
  ])("reads a limit of %j as %i", async (limit, expected) => {
    const d1 = d1StandIn();
    await keptAt(d1, NOW_MS - 2, NOW_MS - 1, NOW_MS);

    expect((await pageAt(d1, `?limit=${limit}`)).ids).toHaveLength(expected);
  });

  it("answers 503 JSON, never an empty list, when D1 fails", async () => {
    expect(await answered(await asked(d1StandIn(/^SELECT/), RECEIVING))).toEqual({
      status: 503,
      body: { name: "store_unavailable" },
    });
  });
});

describe("the test inbox's retrieve", () => {
  it("answers the raw bytes base64, decoding to those received", async () => {
    const d1 = d1StandIn();
    const everyByte = Uint8Array.from({ length: 256 }, (_, byte) => byte);
    const kept = await storeOver(d1.database).keep({ ...receivedAt(NOW_MS), raw: everyByte });
    if (!kept.ok) throw new Error(kept.error);
    const { status, body } = await answered(await asked(d1, `${RECEIVING}/${kept.value}`));
    const message = TEST_INBOX_MESSAGE.parse(body);

    expect(status).toBe(200);
    expect(message).toEqual({
      id: kept.value,
      to: [PERSON],
      from: PRODUCTION,
      created_at: "2026-10-03T04:00:00.000Z",
      subject: "Sent at 1791000000000",
      raw: expect.any(String),
    });
    expect(new Uint8Array(Buffer.from(message.raw, "base64"))).toEqual(everyByte);
  });

  it("answers 404 JSON for an id it never kept", async () => {
    const path = `${RECEIVING}/0001791000000000-0000000000000000`;

    expect(await answered(await asked(d1StandIn(), path))).toEqual({
      status: 404,
      body: { name: "not_found" },
    });
  });

  it("answers 503 JSON when D1 fails", async () => {
    const path = `${RECEIVING}/0001791000000000-0000000000000000`;

    expect(await answered(await asked(d1StandIn(/^SELECT/), path))).toEqual({
      status: 503,
      body: { name: "store_unavailable" },
    });
  });
});

describe("the test inbox's other answers", () => {
  it.each([
    ["POST", RECEIVING, "GET"],
    ["DELETE", RECEIVING, "GET"],
    ["PUT", `${RECEIVING}/0001791000000000-0000000000000000`, "GET"],
    ["GET", "/probe", "POST"],
  ])("answers %s %s with 405 JSON", async (method, path, allowed) => {
    const d1 = d1StandIn();
    const response = await asked(d1, path, { method });

    expect(response.headers.get("allow")).toBe(allowed);
    expect(await answered(response)).toEqual({
      status: 405,
      body: { name: "method_not_allowed" },
    });
    expect(d1.ran).toEqual([]);
  });

  it.each(["/", "/emails", `${RECEIVING}/`, `${RECEIVING}/one/two`])(
    "answers %s with 404 JSON, never a redirect",
    async (path) => {
      expect(await answered(await asked(d1StandIn(), path))).toEqual({
        status: 404,
        body: { name: "not_found" },
      });
    },
  );
});

describe("the test inbox's probe", () => {
  it("writes and deletes one row, answering 200 JSON", async () => {
    const d1 = d1StandIn();

    expect(await answered(await asked(d1, "/probe", { method: "POST" }))).toEqual({
      status: 200,
      body: { probed: true },
    });
    expect(d1.ran.map((query) => query.split(" ")[0])).toEqual(["INSERT", "DELETE"]);
    expect(await pageAt(d1, "")).toEqual({ ids: [], hasMore: false });
  });

  it("answers 503 JSON when the store cannot write", async () => {
    expect(await answered(await asked(d1StandIn(/^INSERT/), "/probe", { method: "POST" }))).toEqual(
      { status: 503, body: { name: "store_unavailable" } },
    );
  });
});
