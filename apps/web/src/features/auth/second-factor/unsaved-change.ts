import { useDeferredValue, useEffect, useState } from "react";

import type { Outcome } from "@/shared/outcome.tsx";

import { forgetTheUnsavedChange, unsavedChangeRefusedOn } from "../session-memory.ts";
import { UNSAVED_AFTER_CONFIRMING } from "./second-factor-words.ts";

const SAID: Outcome = { tone: "said", words: UNSAVED_AFTER_CONFIRMING };

export const useUnsavedChangeSaid = (pathname: string): Outcome | undefined => {
  const [refusedOn, setRefusedOn] = useState(unsavedChangeRefusedOn);
  const said = useDeferredValue(refusedOn, undefined);
  useEffect(forgetTheUnsavedChange, []);
  if (refusedOn !== undefined && refusedOn !== pathname) setRefusedOn(undefined);
  return said === pathname ? SAID : undefined;
};
