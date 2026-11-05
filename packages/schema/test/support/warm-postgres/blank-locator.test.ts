import { describe, expect, it } from "vitest";

import { startInChild } from "./child.ts";

describe("the warm harness with a blank TEST_POSTGRES_URI", () => {
  it("starts a container of its own", async () => {
    const started = await startInChild(" ");

    expect(started.source).toBe("container");
  }, 300_000);
});
