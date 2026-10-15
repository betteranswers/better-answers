import { MODEL_PROVIDERS } from "@better-answers/schema";

type SubProcessor = { readonly processor: string; readonly country: string };

/** The DPIA's list, keyed by model provider: a provider absent here can be no model choice. */
export const SUB_PROCESSORS: ReadonlyMap<string, SubProcessor> = new Map([
  ["anthropic", { processor: "Anthropic", country: "United States" }],
  ["mistral", { processor: "Mistral AI", country: "European Union" }],
  ["local", { processor: "no sub-processor", country: "the platform's own estate" }],
]);

/** A model choice needs a price, and a price names only a model provider, so `local` is none. */
export const CHOOSABLE_PROVIDERS: ReadonlySet<string> = new Set(
  MODEL_PROVIDERS.filter((provider) => SUB_PROCESSORS.has(provider)),
);
