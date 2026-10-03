import { z } from "zod";

import {
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

const SIGNED_IN = "better-answers.signed-in";

/** None where the browser has no channel between its tabs; a waiting one follows on being shown. */
const signInChannel = (): BroadcastChannel | undefined =>
  typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(SIGNED_IN);

/** Tells every other browser tab, so one waiting on its code follows the sign-in. */
export const announceTheSignIn = (): void => {
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
