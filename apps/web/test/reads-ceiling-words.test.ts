// @vitest-environment node

import { describe, expect, it } from "vitest";

import { failedReadWords } from "@/shared/knowledge/refusal.tsx";

import { carrying } from "./stubbed-api.ts";

describe("what a knowledge read past a ceiling says", () => {
  it("names the wait the ceiling carried, rounded up", () => {
    expect(failedReadWords(carrying({ retryAfterSeconds: 61 }))).toMatch(/\b2\b/);
  });
});
