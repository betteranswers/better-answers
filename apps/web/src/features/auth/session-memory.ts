import { z } from "zod";

import {
  forgetOnThisBrowser,
  inThisTab,
  keepInThisTab,
  keepOnThisBrowser,
  onThisBrowser,
} from "@/shared/browser-storage.ts";

const KEPT_UNDER = "better-answers.session";

/** What this browser last did with a session: held one, held one not yet confirmed, or signed out. */
const REMEMBERED = ["held", "pending", "signed-out"] as const;

type Remembered = (typeof REMEMBERED)[number];

const remembered = z.enum(REMEMBERED);

export const rememberTheSession = (memory: Remembered): void => {
  keepOnThisBrowser(KEPT_UNDER, memory);
};

/** Undefined when this browser never held a session here, or keeps nothing. */
export const sessionRemembered = (): Remembered | undefined =>
  remembered.safeParse(onThisBrowser()?.getItem(KEPT_UNDER)).data;

const UNSAVED_UNDER = "better-answers.change-unsaved";

/** The page of a change refused while the session waited on its second factor. */
export const rememberAChangeUnsaved = (pathname: string): void => {
  keepInThisTab(UNSAVED_UNDER, pathname);
};

export const unsavedChangeRefusedOn = (): string | undefined =>
  inThisTab()?.getItem(UNSAVED_UNDER) ?? undefined;

/** Said once: the page it names has lost a change only on the way straight back to it. */
export const forgetTheUnsavedChange = (): void => {
  inThisTab()?.removeItem(UNSAVED_UNDER);
};

const OFFER_SHOWN_UNDER = "better-answers.passkey-offer-shown";

const SHOWN = "shown";

/** Shown in this page load, which holds when the browser refuses to keep the mark. */
let offerShownHere = false;

/** Kept on the browser, not the tab, so a second tab of the same sign-in stays quiet. */
export const rememberThePasskeyOfferShown = (): void => {
  offerShownHere = true;
  keepOnThisBrowser(OFFER_SHOWN_UNDER, SHOWN);
};

export const passkeyOfferShown = (): boolean =>
  offerShownHere || onThisBrowser()?.getItem(OFFER_SHOWN_UNDER) === SHOWN;

/** Each sign-in is owed the offer once more. */
export const forgetThePasskeyOfferShown = (): void => {
  offerShownHere = false;
  forgetOnThisBrowser(OFFER_SHOWN_UNDER);
};

const SIGNED_IN = "better-answers.signed-in";

/** None where the browser has no channel between its tabs; a waiting one follows on being shown. */
const signInChannel = (): BroadcastChannel | undefined =>
  typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(SIGNED_IN);

/** Tells every other browser tab, so one waiting on its code follows the sign-in. */
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

/** What every way of signing in leaves behind on this browser, and tells its other tabs. */
export const signedInHere = (): void => {
  rememberTheSession("held");
  forgetThePasskeyOfferShown();
  announceTheSignIn();
};
