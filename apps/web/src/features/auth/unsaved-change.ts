import { useDeferredValue, useEffect, useState } from "react";

import type { Outcome } from "@/shared/outcome.tsx";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { UNSAVED_AFTER_CONFIRMING } from "./second-factor-words.ts";
import { forgetTheUnsavedChange, unsavedChangeRefusedOn } from "./session-memory.ts";

const SAID: Outcome = { tone: "said", words: sentenceOf(UNSAVED_AFTER_CONFIRMING) };

/**
 * Said a render after the frame mounts, so the band's standing region announces it, and only on
 * the page the change was refused on.
 */
export const useUnsavedChangeSaid = (pathname: string): Outcome | undefined => {
  const [refusedOn, setRefusedOn] = useState(unsavedChangeRefusedOn);
  const said = useDeferredValue(refusedOn, undefined);
  useEffect(forgetTheUnsavedChange, []);
  // Moving on lets it go, so coming back to the page later says nothing.
  if (refusedOn !== undefined && refusedOn !== pathname) setRefusedOn(undefined);
  return said === pathname ? SAID : undefined;
};
