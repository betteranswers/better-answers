import { act, cleanup, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Providers } from "@/app/providers.tsx";
import { usePasskeySignIn } from "@/features/auth/passkey-hooks.ts";
import { forgetThePasskeyOfferShown } from "@/features/auth/session-memory.ts";

import { openApp } from "./open-app.tsx";
import {
  A_CHALLENGE,
  adasApi,
  answering,
  BOTH_HELD,
  openAsAda,
  sessionStanding,
  withPasskeysHere,
} from "./second-factor-api.ts";

const SHOWN_UNDER = "better-answers.passkey-offer-shown";

const FIRST_PAGE = "/people/groups";

const NEXT_PAGE = "/people/members";

/** Confirmed and holding only an authenticator: the person the offer is for. */
const NO_PASSKEY = {
  ...BOTH_HELD,
  passkeys: [],
  thisSession: sessionStanding("confirmed", { confirmed: true }),
};

const SHELL_READS = new Map<string, () => unknown>([
  [
    "session.member",
    () => ({
      workspace: { id: "w", name: "Northern Tooling" },
      person: { id: "p", name: "Ada", email: "ada@example.test" },
      role: "Admin",
    }),
  ],
  ["session.operator", () => ({ operator: false, name: "Ada" })],
]);

const PASSKEY_SIGN_IN = new Map([
  ["/passkeys/sign-in-options", answering(A_CHALLENGE)],
  ["/passkeys/sign-in", answering({ displayNameGiven: true })],
]);

const kept = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (kept !== undefined) Object.defineProperty(globalThis, "localStorage", kept);
  // The module remembers a page load's offer, and one module serves every test here.
  forgetThePasskeyOfferShown();
  globalThis.localStorage.clear();
  globalThis.history.replaceState(null, "", "/");
});

/** By its dismissal, which the Account page's own passkeys region does not hold. */
const DISMISSAL = { name: "Dismiss the passkey offer" };

const offer = () => screen.queryByRole("button", DISMISSAL);

const offerDrawn = () => screen.findByRole("button", DISMISSAL);

const adaHoldingNoPasskey = (): void => {
  withPasskeysHere();
  adasApi(() => NO_PASSKEY, PASSKEY_SIGN_IN, SHELL_READS);
};

/** A page load on a frame page, drawn as far as the offer. */
const loadedOnTheOffer = async () => {
  adaHoldingNoPasskey();
  const loaded = await openAsAda(FIRST_PAGE);
  await offerDrawn();
  return loaded;
};

/** As a browser told to block storage answers the page that asks for it. */
const refuseStorage = (): void => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => {
      throw new DOMException("refused", "SecurityError");
    },
  });
};

describe("the passkey offer", () => {
  it("draws on the first page, and on no page after", async () => {
    const { router } = await loadedOnTheOffer();

    await act(() => router.navigate({ href: NEXT_PAGE }));

    expect(router.state.location.pathname).toBe(NEXT_PAGE);
    expect(offer()).toBeNull();

    await act(() => router.navigate({ href: FIRST_PAGE }));

    expect(router.state.location.pathname).toBe(FIRST_PAGE);
    expect(offer()).toBeNull();
  });

  it("stays quiet on a page load after another showed it", async () => {
    adaHoldingNoPasskey();
    // Account reads the second factor and draws no offer, so the next load finds the read held.
    const { clients, rendered } = await openAsAda("/account");
    await screen.findByRole("button", { name: "Add a passkey" });
    rendered.unmount();
    globalThis.localStorage.setItem(SHOWN_UNDER, "shown");

    await openApp(FIRST_PAGE, clients);

    expect(await screen.findByRole("main")).toBeDefined();
    expect(offer()).toBeNull();
  });

  it("is marked shown as it draws, not on mount", async () => {
    adaHoldingNoPasskey();
    const { router } = await openAsAda("/account");
    expect(await screen.findByRole("heading", { level: 1, name: "Account" })).toBeDefined();
    expect(offer()).toBeNull();
    expect(globalThis.localStorage.getItem(SHOWN_UNDER)).toBeNull();

    await act(() => router.navigate({ href: FIRST_PAGE }));

    expect(await offerDrawn()).toBeDefined();
    expect(globalThis.localStorage.getItem(SHOWN_UNDER)).not.toBeNull();
  });

  it("draws once on each page load where storage is refused", async () => {
    refuseStorage();
    const { router, rendered } = await loadedOnTheOffer();

    await act(() => router.navigate({ href: NEXT_PAGE }));

    expect(offer()).toBeNull();
    rendered.unmount();
    // A page load starts the modules afresh, and with them what this one remembered.
    vi.resetModules();
    const nextLoad = await import("./second-factor-api.ts");

    await nextLoad.openAsAda(FIRST_PAGE);

    expect(await offerDrawn()).toBeDefined();
  });

  it("is owed again after a sign-in by passkey", async () => {
    const { clients, rendered } = await loadedOnTheOffer();
    rendered.unmount();
    const signedIn = vi.fn<() => void>();
    const wrapper = (properties: { readonly children: ReactNode }) => (
      <Providers clients={clients}>{properties.children}</Providers>
    );
    const signingIn = renderHook(() => usePasskeySignIn(false, signedIn), { wrapper });

    act(() => {
      signingIn.result.current.signIn();
    });

    await waitFor(() => {
      expect(signedIn).toHaveBeenCalledOnce();
    });
    signingIn.unmount();
    await openApp(FIRST_PAGE, clients);

    expect(await offerDrawn()).toBeDefined();
  });
});
