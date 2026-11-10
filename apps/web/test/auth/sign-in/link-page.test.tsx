import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UNKNOWN_PAGE } from "@/app/words.ts";
import { LINK_WORDS } from "@/features/auth/sign-in/link-words.ts";
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

const signInButton = () => screen.getByRole("button", { name: UNKNOWN_PAGE.signIn });

describe("signing in from a link with no response", () => {
  it("shows an alert and keeps Sign In available", async () => {
    const signIn = vi.fn<() => Promise<Response>>(() =>
      Promise.reject(new TypeError("the network is down")),
    );
    vi.stubGlobal("fetch", aLinkWhoseSignIn(signIn));
    globalThis.history.replaceState(null, "", `/sign-in/link#${TOKEN}`);
    await openApp("/sign-in/link");
    fireEvent.click(await screen.findByRole("button", { name: UNKNOWN_PAGE.signIn }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/\S/u);
    });
    expect(signInButton().getAttribute("aria-disabled")).toBe("false");

    fireEvent.click(signInButton());

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledTimes(2);
    });
  });
});

describe("a link opened in another browser", () => {
  it("shows the code to copy and does not sign in", async () => {
    const written = clipboardAnswering(() => Promise.resolve());
    const asked = vi.fn<(input: string | URL | Request) => Promise<Response>>(() =>
      answered(ELSEWHERE),
    );
    vi.stubGlobal("fetch", asked);
    globalThis.history.replaceState(null, "", `/sign-in/link#${TOKEN}`);
    await openApp("/sign-in/link");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: LINK_WORDS.elsewhereTitle,
      }),
    ).toBeDefined();
    expect(screen.getByText("482 916")).toBeDefined();
    expect(screen.queryByRole("button", { name: UNKNOWN_PAGE.signIn })).toBeNull();
    const saidOfTheCopy = screen.getAllByRole("status").at(-1);
    expect(saidOfTheCopy?.textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: LINK_WORDS.copy }));

    await waitFor(() => {
      expect(saidOfTheCopy?.textContent).toMatch(/\S/u);
    });
    expect(written).toEqual(["482916"]);
    expect(
      asked.mock.calls
        .map(([input]) => addressOf(input).pathname)
        .filter((path) => path.startsWith("/sign-in-link/")),
    ).toEqual(["/sign-in-link/describe"]);
  });
});
