import type { z } from "zod";

export type WireRequest = {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

export type TokensSpent = { readonly tokensIn: number; readonly tokensOut: number };

export type WireRead<Said> =
  | { readonly read: "answered"; readonly said: Said; readonly spent: TokensSpent }
  | { readonly read: "refused"; readonly spent: TokensSpent }
  | { readonly read: "cut-off"; readonly spent: TokensSpent }
  | { readonly read: "rate-limited"; readonly retryAfterMs: number | undefined }
  | { readonly read: "spend-cap" }
  | { readonly read: "unavailable" }
  | { readonly read: "failed" };

/** `text` read as JSON of `shape`, or `undefined`: a parse error quotes the text, so none leaves. */
export const jsonAs = <T>(shape: z.ZodType<T>, text: string): T | undefined => {
  try {
    const parsed = shape.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const SECOND_MS = 1000;

/** `retry-after` is whole seconds, as `Headers` hands it over trimmed; anything else is none. */
export const retryAfterMsOf = (header: string | null): number | undefined =>
  /^\d+$/.test(header ?? "") ? Number(header) * SECOND_MS : undefined;
