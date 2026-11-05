import { act, cleanup, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Providers } from "@/app/providers.tsx";
import { useSignInEmailOtp } from "@/features/auth/auth-hooks.ts";
import { usePasskeySignIn } from "@/features/auth/passkey-hooks.ts";
import { forgetThePasskeyOfferShown } from "@/features/auth/session-memory.ts";
import { HOMES } from "@/shared/navigation.ts";
import { openApp } from "@test/open-app.tsx";
import {
  A_CHALLENGE,
  adasApi,
  answering,
  BOTH_HELD,
  openAsAda,
  sessionStanding,
  withPasskeysHere,
} from "@test/second-factor-api.ts";

await vi.hoisted(() => import("@test/forwarding-fetch.ts"));

const SHOWN_UNDER = "better-answers.passkey-offer-shown";

const FIRST_PAGE = "/people/groups";

const NEXT_PAGE = "/people/members";

const HOME = HOMES.Admin.path;

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
  ["/sign-in/email-otp", answering({ user: { name: "Ada" } })],
]);

const kept = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (kept !== undefined) Object.defineProperty(globalThis, "localStorage", kept);
  forgetThePasskeyOfferShown();
  globalThis.localStorage.clear();
  globalThis.history.replaceState(null, "", "/");
});

const DISMISSAL = { name: "Dismiss Passkey Offer" };

const offer = () => screen.queryByRole("button", DISMISSAL);

const offerShown = () => screen.findByRole("button", DISMISSAL);

const adaHoldingNoPasskey = (reads: ReadonlyMap<string, () => unknown> = SHELL_READS): void => {
  withPasskeysHere();
  adasApi(() => NO_PASSKEY, PASSKEY_SIGN_IN, reads);
};

const loadedOnTheOffer = async () => {
  adaHoldingNoPasskey();
  const loaded = await openAsAda(FIRST_PAGE);
  await offerShown();
  return loaded;
};

const switchedOnTheOffer = async () => {
  let workspace = NORTHERN_TOOLING;
  adaHoldingNoPasskey(new Map([...SHELL_READS, ["session.member", () => adaIn(workspace)]]));
  const loaded = await openAsAda(HOME);
  await offerShown();
  const { queryClient } = loaded.clients;

  workspace = HOLME_PRESSINGS;
  queryClient.removeQueries({ queryKey: [["person", "secondFactor"]] });
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: [["session", "member"]] });
    await loaded.router.navigate({ href: "/" });
  });

  await within(screen.getByRole("banner")).findByRole("button", { name: HOLME_PRESSINGS.name });
  return loaded;
};

type Loaded = Awaited<ReturnType<typeof loadedOnTheOffer>>;

const providedWith = (clients: Loaded["clients"]) =>
  function Provided(properties: { readonly children: ReactNode }) {
    return <Providers clients={clients}>{properties.children}</Providers>;
  };

const movedTo = async (router: Loaded["router"], href: string) => {
  await act(() => router.navigate({ href }));
  return { at: router.state.location.pathname, offer: offer() };
};

const refuseStorage = (): void => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => {
      throw new DOMException("refused", "SecurityError");
    },
  });
};

describe("the passkey offer", () => {
  it("shows on the first page and on no later page", async () => {
    const { router } = await loadedOnTheOffer();

    expect(await movedTo(router, NEXT_PAGE)).toStrictEqual({ at: NEXT_PAGE, offer: null });
    expect(await movedTo(router, FIRST_PAGE)).toStrictEqual({ at: FIRST_PAGE, offer: null });
  });

  it("stays visible when a workspace switch reloads the page", async () => {
    const { router } = await switchedOnTheOffer();

    expect(router.state.location.pathname).toBe(HOME);
    expect(await offerShown()).toBeDefined();
  });

  it("disappears for good on the next page after a switch", async () => {
    const { router } = await switchedOnTheOffer();
    await offerShown();

    expect(await movedTo(router, FIRST_PAGE)).toStrictEqual({ at: FIRST_PAGE, offer: null });
    expect(await movedTo(router, HOME)).toStrictEqual({ at: HOME, offer: null });
  });

  it("stays hidden after another page load showed it", async () => {
    adaHoldingNoPasskey();
    const { clients, rendered } = await openAsAda("/account");
    await screen.findByRole("button", { name: "Add a Passkey" });
    rendered.unmount();
    globalThis.localStorage.setItem(SHOWN_UNDER, "shown");

    await openApp(FIRST_PAGE, clients);

    expect(await screen.findByRole("main")).toBeDefined();
    expect(offer()).toBeNull();
  });

  it("is marked shown when it appears, not on mount", async () => {
    adaHoldingNoPasskey();
    const { router } = await openAsAda("/account");
    expect(await screen.findByRole("heading", { level: 1, name: "Account" })).toBeDefined();
    expect(offer()).toBeNull();
    expect(globalThis.localStorage.getItem(SHOWN_UNDER)).toBeNull();

    await act(() => router.navigate({ href: FIRST_PAGE }));

    expect(await offerShown()).toBeDefined();
    expect(globalThis.localStorage.getItem(SHOWN_UNDER)).not.toBeNull();
  });

  it("shows once per page load when storage is blocked", async () => {
    refuseStorage();
    const { router, rendered } = await loadedOnTheOffer();

    await act(() => router.navigate({ href: NEXT_PAGE }));

    expect(offer()).toBeNull();
    rendered.unmount();
    vi.resetModules();
    const nextLoad = await import("@test/second-factor-api.ts");

    await nextLoad.openAsAda(FIRST_PAGE);

    expect(await offerShown()).toBeDefined();
  });

  it("shows again after a passkey sign-in", async () => {
    const { clients, rendered } = await loadedOnTheOffer();
    rendered.unmount();
    const signedIn = vi.fn<() => void>();
    const signingIn = renderHook(() => usePasskeySignIn(false, signedIn), {
      wrapper: providedWith(clients),
    });

    act(() => {
      signingIn.result.current.signIn();
    });

    await waitFor(() => {
      expect(signedIn).toHaveBeenCalledOnce();
    });
    signingIn.unmount();
    await openApp(FIRST_PAGE, clients);

    expect(await offerShown()).toBeDefined();
  });

  it("a Viewer is offered a passkey once per sign-in", async () => {
    const { clients, router, rendered } = await loadedOnTheOffer();
    expect(globalThis.localStorage.getItem(SHOWN_UNDER)).not.toBeNull();
    expect(await movedTo(router, NEXT_PAGE)).toStrictEqual({ at: NEXT_PAGE, offer: null });
    rendered.unmount();
    const signingIn = renderHook(() => useSignInEmailOtp(), { wrapper: providedWith(clients) });

    act(() => {
      signingIn.result.current.mutate({ email: "ada@example.test", otp: "123456" });
    });

    await waitFor(() => {
      expect(signingIn.result.current.isSuccess).toBe(true);
    });
    signingIn.unmount();
    await openApp(FIRST_PAGE, clients);

    expect(await offerShown()).toBeDefined();
  });
});
