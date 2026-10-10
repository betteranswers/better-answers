import { act, cleanup, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Providers } from "@/app/providers.tsx";
import { usePasskeySignIn } from "@/features/auth/passkey-hooks.ts";
import { forgetThePasskeyOfferShown } from "@/features/auth/session-memory.ts";
import { HOMES } from "@/shared/navigation.ts";

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

/** A switch of workspace lands an Admin here again, at the address it left. */
const HOME = HOMES.Admin.path;

/** Confirmed and holding only an authenticator: the person the offer is for. */
const NO_PASSKEY = {
  ...BOTH_HELD,
  passkeys: [],
  thisSession: sessionStanding("confirmed", { confirmed: true }),
};

type Workspace = { readonly id: string; readonly name: string };

const NORTHERN_TOOLING: Workspace = { id: "w", name: "Northern Tooling" };

const HOLME_PRESSINGS: Workspace = { id: "x", name: "Holme Pressings" };

const adaIn = (workspace: Workspace) => ({
  workspace,
  person: { id: "p", name: "Ada", email: "ada@example.test" },
  role: "Admin",
});

const SHELL_READS = new Map<string, () => unknown>([
  ["session.member", () => adaIn(NORTHERN_TOOLING)],
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

const adaHoldingNoPasskey = (reads: ReadonlyMap<string, () => unknown> = SHELL_READS): void => {
  withPasskeysHere();
  adasApi(() => NO_PASSKEY, PASSKEY_SIGN_IN, reads);
};

/** A page load on a frame page, drawn as far as the offer. */
const loadedOnTheOffer = async () => {
  adaHoldingNoPasskey();
  const loaded = await openAsAda(FIRST_PAGE);
  await offerDrawn();
  return loaded;
};

/**
 * As a switch of workspace leaves her: her second factor's read dropped, her member read again,
 * and home asked for.
 */
const switchedOnTheOffer = async () => {
  let workspace = NORTHERN_TOOLING;
  adaHoldingNoPasskey(new Map([...SHELL_READS, ["session.member", () => adaIn(workspace)]]));
  const loaded = await openAsAda(HOME);
  await offerDrawn();
  const { queryClient } = loaded.clients;

  workspace = HOLME_PRESSINGS;
  queryClient.removeQueries({ queryKey: [["person", "secondFactor"]] });
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: [["session", "member"]] });
    await loaded.router.navigate({ href: "/" });
  });

  // The band names the workspace read, so the page beneath it has been drawn afresh for it.
  await within(screen.getByRole("banner")).findByRole("button", { name: HOLME_PRESSINGS.name });
  return loaded;
};

type Loaded = Awaited<ReturnType<typeof loadedOnTheOffer>>;

/** A move to another page: where it left her, and the offer drawn there, if any. */
const movedTo = async (router: Loaded["router"], href: string) => {
  await act(() => router.navigate({ href }));
  return { at: router.state.location.pathname, offer: offer() };
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

    expect(await movedTo(router, NEXT_PAGE)).toStrictEqual({ at: NEXT_PAGE, offer: null });
    expect(await movedTo(router, FIRST_PAGE)).toStrictEqual({ at: FIRST_PAGE, offer: null });
  });

  it("stays drawn when a switch draws its page afresh", async () => {
    const { router } = await switchedOnTheOffer();

    expect(router.state.location.pathname).toBe(HOME);
    expect(await offerDrawn()).toBeDefined();
  });

  it("ends on the next page after a switch, for good", async () => {
    const { router } = await switchedOnTheOffer();
    await offerDrawn();

    expect(await movedTo(router, FIRST_PAGE)).toStrictEqual({ at: FIRST_PAGE, offer: null });
    expect(await movedTo(router, HOME)).toStrictEqual({ at: HOME, offer: null });
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
