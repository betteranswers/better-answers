import { z } from "zod";

import { keepOnThisBrowser, onThisBrowser } from "@/shared/browser-storage.ts";

const KEPT_UNDER = "better-answers.session";

/** What this browser last did with a session: held one, or signed out of it. */
const REMEMBERED = ["held", "signed-out"] as const;

type Remembered = (typeof REMEMBERED)[number];

const remembered = z.enum(REMEMBERED);

export const rememberTheSession = (memory: Remembered): void => {
  keepOnThisBrowser(KEPT_UNDER, memory);
};

/** Undefined when this browser never held a session here, or keeps nothing. */
export const sessionRemembered = (): Remembered | undefined =>
  remembered.safeParse(onThisBrowser()?.getItem(KEPT_UNDER)).data;
