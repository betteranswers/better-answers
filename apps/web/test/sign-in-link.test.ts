import { afterEach, describe, expect, it } from "vitest";

import { dropTheLinkToken, linkTokenOnThisPage } from "@/features/auth/auth-hooks.ts";
import { codeShown, codeSpelled } from "@/features/auth/link-words.ts";

const TOKEN = `${"aB3".repeat(14)}z`;

const at = (address: string, state: unknown = null) => {
  globalThis.history.replaceState(state, "", address);
};

describe("the sign-in link's token", () => {
  afterEach(() => {
    at("/");
  });

  it.each([
    ["43", TOKEN],
    ["128", "a".repeat(128)],
  ])("reads a token of %s characters from the fragment", (_, token) => {
    at(`/sign-in/link#${token}`);
    expect(linkTokenOnThisPage()).toBe(token);
  });

  it.each([
    ["missing", ""],
    ["empty", "#"],
    ["past what the api accepts", `#${"a".repeat(129)}`],
    ["not letters and digits", `#${TOKEN.slice(1)}-`],
  ])("reads none from a fragment %s", (_, fragment) => {
    at(`/sign-in/link${fragment}`);
    expect(linkTokenOnThisPage()).toBeUndefined();
  });

  it("drops the fragment, keeping the path, query and state", () => {
    at(`/sign-in/link?from=mail#${TOKEN}`, { key: "entry" });
    dropTheLinkToken();
    expect(globalThis.location.hash).toBe("");
    expect(`${globalThis.location.pathname}${globalThis.location.search}`).toBe(
      "/sign-in/link?from=mail",
    );
    expect(globalThis.history.state).toEqual({ key: "entry" });
  });
});

describe("the code typed where the person started", () => {
  it("shows in two groups of three", () => {
    expect(codeShown("123456")).toBe("123 456");
  });

  it("spells each digit apart for a screen reader", () => {
    expect(codeSpelled("123456")).toBe("1 2 3 4 5 6");
  });
});
