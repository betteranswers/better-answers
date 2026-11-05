import { expect } from "vitest";

/** Vitest types each asymmetric matcher as `any`. These return the same matcher typed as `unknown`. */
export const matching = {
  any: (type: unknown): unknown => expect.any(type),
  anything: (): unknown => expect.anything(),
  stringMatching: (pattern: string | RegExp): unknown => expect.stringMatching(pattern),
  stringContaining: (part: string): unknown => expect.stringContaining(part),
  objectContaining: (part: Readonly<Record<string, unknown>>): unknown =>
    expect.objectContaining(part),
  arrayContaining: (part: readonly unknown[]): unknown => expect.arrayContaining([...part]),
  closeTo: (expected: number, precision?: number): unknown => expect.closeTo(expected, precision),
  not: {
    stringContaining: (part: string): unknown => expect.not.stringContaining(part),
  },
};
