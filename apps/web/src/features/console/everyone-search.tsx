import { useId, useRef, useState, type RefObject } from "react";

import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import type { Asked } from "./people-api.ts";
import { PEOPLE_KEYSTROKES } from "./people-keystrokes.ts";

/** A pause in typing asks the api once, rather than once a key under its per-address ceiling. */
const SEARCH_PAUSE_MS = 200;

export function useAsking(initial: string) {
  const [typed, setTyped] = useState(initial);
  const [asked, setAsked] = useState<Asked>({ search: initial, offset: 0 });
  const pause = useRef<ReturnType<typeof setTimeout>>(undefined);

  const type = (value: string) => {
    setTyped(value);
    clearTimeout(pause.current);
    pause.current = setTimeout(() => {
      setAsked({ search: value.trim(), offset: 0 });
    }, SEARCH_PAUSE_MS);
  };
  const clear = () => {
    clearTimeout(pause.current);
    setTyped("");
    setAsked({ search: "", offset: 0 });
  };
  const turnTo = (offset: number) => {
    setAsked((was) => ({ ...was, offset }));
  };
  return { typed, asked, type, clear, turnTo };
}

export function SearchField(properties: {
  readonly searchRef: RefObject<HTMLInputElement | null>;
  readonly typed: string;
  readonly type: (value: string) => void;
  readonly clear: () => void;
}) {
  const { searchRef, typed, clear } = properties;
  const searchId = useId();
  return (
    <div className="grid gap-1.5 border-b border-border p-3">
      <Label htmlFor={searchId}>Search by name or address</Label>
      <Input
        id={searchId}
        ref={searchRef}
        type="search"
        aria-keyshortcuts={PEOPLE_KEYSTROKES.search.key}
        className="max-w-sm"
        value={typed}
        onChange={(event) => {
          properties.type(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || typed === "") return;
          event.preventDefault();
          clear();
        }}
      />
    </div>
  );
}
