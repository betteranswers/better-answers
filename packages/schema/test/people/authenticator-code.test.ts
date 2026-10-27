import { describe, expect, it } from "vitest";

import { authenticatorCodeAt, keyIn } from "./authenticator-code.ts";

/** RFC 6238's SHA-1 seed, "12345678901234567890", in base32. */
const RFC_KEY = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("the authenticator code generator", () => {
  it.each([
    [59, "287082"],
    [1_111_111_109, "081804"],
    [1_111_111_111, "050471"],
    [1_234_567_890, "005924"],
    [2_000_000_000, "279037"],
    [20_000_000_000, "353130"],
  ])("answers RFC 6238's code at %i seconds", (seconds, code) => {
    expect(authenticatorCodeAt(RFC_KEY, new Date(seconds * 1000))).toBe(code);
  });

  it("reads a lower-case key with padding", () => {
    expect(authenticatorCodeAt(`${RFC_KEY.toLowerCase()}====`, new Date(59_000))).toBe("287082");
  });

  it("refuses a character outside base32", () => {
    expect(() => authenticatorCodeAt("GEZ1", new Date(59_000))).toThrow(
      "1 is not a base32 character",
    );
  });

  it("reads the key from an otpauth address", () => {
    expect(
      keyIn(
        "otpauth://totp/better-answers:priya%40acme.test?secret=GEZDGNBV&issuer=better-answers",
      ),
    ).toBe("GEZDGNBV");
  });
});
