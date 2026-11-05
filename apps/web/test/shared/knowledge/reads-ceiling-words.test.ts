// @vitest-environment node

import { describe, expect, it } from "vitest";

import { failedReadWords } from "@/shared/knowledge/refusal.tsx";
import { carrying } from "@test/stubbed-api.ts";

describe("the message for a rate-limited knowledge read", () => {
  it("gives the retry wait in minutes, rounded up", () => {
    expect(failedReadWords(carrying({ retryAfterSeconds: 61 }))).toMatch(/\b2\b/);
  });
});
