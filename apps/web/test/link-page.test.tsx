import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SIGN_IN_UNCONFIRMED } from "@/features/auth/link-words.ts";
import { STOCK } from "@/shared/refusal-words.ts";

import { openApp } from "./open-app.tsx";
import { addressOf, answered } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.history.replaceState(null, "", "/");
});

const TOKEN = `${"aB3".repeat(14)}z`;

const BOUND = { state: "bound", address: "ada@example.test", carried: "" };

/** The link read as this browser's own; its sign-in answers as `signIn` does. */
const aLinkWhoseSignIn =
  (signIn: () => Promise<Response>) =>
  (input: string | URL | Request): Promise<Response> =>
    addressOf(input).pathname === "/sign-in-link/sign-in" ? signIn() : answered(BOUND);

const signInButton = () => screen.getByRole("button", { name: "Sign in" });

describe("a link's sign-in that got no response", () => {
  it("says to try again, its Sign in button still pressable", async () => {
    const signIn = vi.fn<() => Promise<Response>>(() =>
      Promise.reject(new TypeError("the network is down")),
    );
    vi.stubGlobal("fetch", aLinkWhoseSignIn(signIn));
    globalThis.history.replaceState(null, "", `/sign-in/link#${TOKEN}`);
    await openApp("/sign-in/link");
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

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
