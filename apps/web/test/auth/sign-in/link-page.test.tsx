import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LINK_WORDS, SIGN_IN_UNCONFIRMED } from "@/features/auth/sign-in/link-words.ts";
import { STOCK } from "@/shared/refusal-words.ts";
import { clipboardAnswering } from "@test/clipboard-stand-in.ts";
import { openApp } from "@test/open-app.tsx";
import { addressOf, answered } from "@test/stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.history.replaceState(null, "", "/");
});

const TOKEN = `${"aB3".repeat(14)}z`;

const BOUND = { state: "bound", address: "ada@example.test", carried: "" };

const aLinkWhoseSignIn =
  (signIn: () => Promise<Response>) =>
  (input: string | URL | Request): Promise<Response> =>
    addressOf(input).pathname === "/sign-in-link/sign-in" ? signIn() : answered(BOUND);

const ELSEWHERE = { state: "elsewhere", code: "482916", until: "2026-10-29T10:05:00.000Z" };

const signInButton = () => screen.getByRole("button", { name: "Sign In" });

describe("a link's sign-in that got no response", () => {
  it("says to try again, its Sign in button still pressable", async () => {
    const signIn = vi.fn<() => Promise<Response>>(() =>
      Promise.reject(new TypeError("the network is down")),
    );
    vi.stubGlobal("fetch", aLinkWhoseSignIn(signIn));
    globalThis.history.replaceState(null, "", `/sign-in/link#${TOKEN}`);
    await openApp("/sign-in/link");
    fireEvent.click(await screen.findByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(SIGN_IN_UNCONFIRMED);
    });
    expect(SIGN_IN_UNCONFIRMED).not.toBe(STOCK.unconfirmed);
    expect(signInButton().getAttribute("aria-disabled")).toBe("false");

    fireEvent.click(signInButton());

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledTimes(2);
    });
  });
});

describe("a link opened in another browser", () => {
  it("another device shows the code and stays signed out", async () => {
    const written = clipboardAnswering(() => Promise.resolve());
    const asked = vi.fn<(input: string | URL | Request) => Promise<Response>>(() =>
      answered(ELSEWHERE),
    );
    vi.stubGlobal("fetch", asked);
    globalThis.history.replaceState(null, "", `/sign-in/link#${TOKEN}`);
    await openApp("/sign-in/link");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Enter This Code Where You Started" }),
    ).toBeDefined();
    expect(screen.getByText("482 916")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sign In" })).toBeNull();
    const saidOfTheCopy = screen.getAllByRole("status").at(-1);
    expect(saidOfTheCopy?.textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Copy Code" }));

    await waitFor(() => {
      expect(saidOfTheCopy?.textContent).toBe(LINK_WORDS.copied);
    });
    expect(written).toEqual(["482916"]);
    expect(
      asked.mock.calls
        .map(([input]) => addressOf(input).pathname)
        .filter((path) => path.startsWith("/sign-in-link/")),
    ).toEqual(["/sign-in-link/describe"]);
  });
});
