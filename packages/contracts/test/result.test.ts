import { describe, expect, it } from "vitest";

import { attempt, normalizeError } from "../src/index.ts";

describe("attempt", () => {
  it("hands the caller the value when the operation succeeds", async () => {
    const result = await attempt(async () => "ok");

    expect(result).toEqual({ ok: true, value: "ok" });
  });

  it("hands the caller the thrown Error rather than throwing it", async () => {
    const thrown = new Error("the driver refused the connection");

    const result = await attempt(async () => {
      throw thrown;
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe(thrown);
  });
});

describe("normalizeError", () => {
  it("keeps an Error as it was thrown", () => {
    const thrown = new Error("permission denied");

    expect(normalizeError(thrown)).toBe(thrown);
  });

  it("turns a thrown string into an Error carrying it as the message", () => {
    expect(normalizeError("permission denied").message).toBe("permission denied");
  });

  it("turns any other thrown value into an Error that keeps it as the cause", () => {
    const thrown = { status: 500 };

    const error = normalizeError(thrown);

    expect(error.message).toBe("non-Error thrown: [object Object]");
    expect(error.cause).toBe(thrown);
  });
});
