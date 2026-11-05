// @vitest-environment node

import { describe, expect, it } from "vitest";

import { MODEL_PROVIDERS } from "@better-answers/schema";

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

  it.each([...MODEL_PROVIDERS, "local"])("gives the %s provider a readable name", (provider) => {
    expect(providerWordOf(provider)).not.toBe(provider);
  });

  it("shows an unknown provider as its id", () => {
    expect(providerWordOf("acme-inference")).toBe("acme-inference");
  });
});
