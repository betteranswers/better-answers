import { z } from "zod";

import {
  forgetOnThisBrowser,
  inThisTab,
  keepInThisTab,
  keepOnThisBrowser,
  onThisBrowser,
} from "@/shared/browser-storage.ts";

const KEPT_UNDER = "better-answers.session";

const REMEMBERED = ["held", "pending", "signed-out"] as const;

type Remembered = (typeof REMEMBERED)[number];

const remembered = z.enum(REMEMBERED);

export const rememberTheSession = (memory: Remembered): void => {
  keepOnThisBrowser(KEPT_UNDER, memory);
};

export const sessionRemembered = (): Remembered | undefined =>
  remembered.safeParse(onThisBrowser()?.getItem(KEPT_UNDER)).data;

const UNSAVED_UNDER = "better-answers.change-unsaved";

export const rememberAChangeUnsaved = (pathname: string): void => {
  keepInThisTab(UNSAVED_UNDER, pathname);
};

export const unsavedChangeRefusedOn = (): string | undefined =>
  inThisTab()?.getItem(UNSAVED_UNDER) ?? undefined;

export const forgetTheUnsavedChange = (): void => {
  inThisTab()?.removeItem(UNSAVED_UNDER);
};

const OFFER_SHOWN_UNDER = "better-answers.passkey-offer-shown";

const SHOWN = "shown";

let offerShownHere = false;

export const rememberThePasskeyOfferShown = (): void => {
  offerShownHere = true;
  keepOnThisBrowser(OFFER_SHOWN_UNDER, SHOWN);
};

export const passkeyOfferShown = (): boolean =>
  offerShownHere || onThisBrowser()?.getItem(OFFER_SHOWN_UNDER) === SHOWN;

export const forgetThePasskeyOfferShown = (): void => {
  offerShownHere = false;
  forgetOnThisBrowser(OFFER_SHOWN_UNDER);
};

const SIGNED_IN = "better-answers.signed-in";

const signInChannel = (): BroadcastChannel | undefined =>
  typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(SIGNED_IN);

const announceTheSignIn = (): void => {
  const channel = signInChannel();
  channel?.postMessage(null);
  channel?.close();
};

/** A browser tab hears its own announcement too, so `heard` must ignore a sign-in made in it. */
export const hearASignInElsewhere = (heard: () => void): (() => void) => {
  const channel = signInChannel();
  channel?.addEventListener("message", heard);
  return () => {
    channel?.close();
  };
};

export const signedInHere = (): void => {
  rememberTheSession("held");
  forgetThePasskeyOfferShown();
  announceTheSignIn();
};
