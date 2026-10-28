// @vitest-environment node

import { describe, expect, it } from "vitest";

import { providerWordOf } from "@/features/model-choices/words.ts";

describe("a model choice's provider, in a reader's word", () => {
  it.each([
    ["anthropic", "Anthropic"],
    ["mistral", "Mistral AI"],
    ["voyage", "Voyage AI"],
    ["openai", "OpenAI"],
    ["google", "Google"],
  ])("names %s %s", (provider, word) => {
    expect(providerWordOf(provider)).toBe(word);
  });

  it("gives a local model's provider a word of its own", () => {
    expect(providerWordOf("local")).not.toBe("local");
  });

  it("shows a provider it has no word for as itself", () => {
    expect(providerWordOf("acme-inference")).toBe("acme-inference");
  });
});
