import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { startApp, type TestApp } from "./harness.ts";

/**
 * The library's count is a run, not a window, reported upstream. When an upgrade turns the
 * first red, look again at what the api took.
 */
describe("Better Auth's own count", () => {
  /** Ten tries in ten minutes: the rule the api names for `/sign-in/email-otp`. */
  const MAX = 10;
  const WINDOW_MS = 600_000;
  const MINUTE_MS = 60_000;

  let app: TestApp;

  beforeAll(async () => {
    app = await startApp();
  });

  afterAll(async () => {
    await app.stop();
  });

  /** The limiter reads the wall clock, not the api's, so the date alone is faked. */
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  type Client = ReturnType<TestApp["client"]>;

  /** A wrong code for nobody's address: the limiter counts it before the endpoint refuses it. */
  const aTry = (client: Client): Promise<Response> =>
    client.json("/sign-in/email-otp", { email: "nobody@example.invalid", otp: "000000" });

  /** Each try, then the date moved on by `gapMs`. */
  const tries = async (client: Client, count: number, gapMs: number): Promise<number[]> => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < count; attempt += 1) {
      statuses.push((await aTry(client)).status);
      vi.setSystemTime(Date.now() + gapMs);
    }
    return statuses;
  };

  it("refuses a run past its max, however slowly it arrives", async () => {
    const client = app.client();
    const underTheRate = WINDOW_MS - MINUTE_MS;

    const within = await tries(client, MAX, underTheRate);
    const past = await aTry(client);

    expect(within).not.toContain(429);
    expect(past.status).toBe(429);
    expect(await past.json()).toEqual({ message: "Too many requests. Please try again later." });
    expect(Number(past.headers.get("x-retry-after"))).toBeGreaterThan(0);
    expect(past.headers.get("retry-after")).toBeNull();
  });

  it("forgets a run after a whole window with no request", async () => {
    const client = app.client();

    const run = await tries(client, MAX + 1, MINUTE_MS);
    vi.setSystemTime(Date.now() + WINDOW_MS);
    const afterTheWindow = await aTry(client);

    expect(run.at(-1)).toBe(429);
    expect(afterTheWindow.status).not.toBe(429);
  });

  it("keeps the library's own rule where the api names none", async () => {
    const client = app.client();
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const answer = await client.json("/email-otp/verify-email", {
        email: "nobody@example.invalid",
        otp: "000000",
      });
      statuses.push(answer.status);
    }

    expect(statuses.slice(0, 3)).not.toContain(429);
    expect(statuses[3]).toBe(429);
  });
});
