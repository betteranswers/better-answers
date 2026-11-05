import { afterEach, describe, expect, it } from "vitest";

import { dropTheLinkToken, linkTokenOnThisPage } from "@/features/auth/auth-hooks.ts";
import { codeShown, codeSpelled } from "@/features/auth/sign-in/link-words.ts";

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
    ["that is missing", ""],
    ["that is empty", "#"],
    ["over 128 characters", `#${"a".repeat(129)}`],
    ["with other characters", `#${TOKEN.slice(1)}-`],
  ])("finds no token in a fragment %s", (_, fragment) => {
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

describe("the code shown for another browser", () => {
  it("shows in two groups of three", () => {
    expect(codeShown("123456")).toBe("123 456");
  });

  it("reads each digit separately to a screen reader", () => {
    expect(codeSpelled("123456")).toBe("1 2 3 4 5 6");
  });
});
