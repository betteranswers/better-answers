import { useRef, useState } from "react";

import type { Asked } from "./people-api.ts";

/** A pause in typing asks the api once, rather than once a key under its per-address ceiling. */
const SEARCH_PAUSE_MS = 200;

export function useAsking(initial: string) {
  const [typed, setTyped] = useState(initial);
  const [asked, setAsked] = useState<Asked>({ search: initial, offset: 0 });
  const pause = useRef<ReturnType<typeof setTimeout>>(undefined);

  const clear = () => {
    clearTimeout(pause.current);
    setTyped("");
    setAsked({ search: "", offset: 0 });
  };
  /** An emptied box waits on no further key, so Escape and a clear ask at once. */
  const type = (value: string) => {
    if (value === "") {
      clear();
      return;
    }
    setTyped(value);
    clearTimeout(pause.current);
    pause.current = setTimeout(() => {
      setAsked({ search: value.trim(), offset: 0 });
    }, SEARCH_PAUSE_MS);
  };
  const turnTo = (offset: number) => {
    setAsked((was) => ({ ...was, offset }));
  };
  return { typed, asked, type, clear, turnTo };
}
