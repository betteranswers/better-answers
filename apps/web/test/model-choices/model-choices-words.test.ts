// @vitest-environment node

import { describe, expect, it } from "vitest";

import { providerWordOf } from "@/features/model-choices/words.ts";

describe("the provider name shown for a model choice", () => {
  it.each([
    ["anthropic", "Anthropic"],
    ["mistral", "Mistral AI"],
    ["voyage", "Voyage AI"],
    ["openai", "OpenAI"],
    ["google", "Google"],
  ])("shows %s as %s", (provider, word) => {
    expect(providerWordOf(provider)).toBe(word);
  });

  it("gives the local provider a readable name", () => {
    expect(providerWordOf("local")).not.toBe("local");
  });

  it("shows an unknown provider as its id", () => {
    expect(providerWordOf("acme-inference")).toBe("acme-inference");
  });
});
