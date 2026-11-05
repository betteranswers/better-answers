import { lazy, Suspense, useRef, useState, type ReactNode } from "react";

import { useKeystroke } from "@/shared/keystrokes.tsx";
import { Button } from "@/shared/ui/button.tsx";

import { EDITOR_KEYSTROKES } from "../knowledge-state.ts";
import { LAUNCH_WORDS as WORDS } from "../knowledge-words.ts";
import type { SessionOptions } from "./concept-session.tsx";

type Options = SessionOptions & { readonly startsOpen?: boolean };

export type ConceptEditing = { readonly actions: ReactNode; readonly editor: ReactNode };

const LazySession = lazy(() =>
  // oxlint-disable-next-line better-answers/import-statically -- Tiptap and CodeMirror stay out of the concept page's first chunk
  import("./concept-session.tsx").then((loaded) => ({ default: loaded.ConceptSession })),
);

export function useConceptEditing(options: Options): ConceptEditing {
  const { startsOpen, ...session } = options;
  const [launched, setLaunched] = useState(startsOpen === true);
  const [presses, setPresses] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const canOpen = session.standing !== undefined || session.target.kind === "new";

  const press = () => {
    if (launched) setPresses((current) => current + 1);
    else setLaunched(true);
  };
  useKeystroke(EDITOR_KEYSTROKES.edit, () => {
    if (canOpen) press();
  });

  return {
    actions: (
      <div className="flex min-w-0 flex-col items-start gap-1">
        {session.standing === undefined ? null : (
          <Button
            ref={buttonRef}
            type="button"
            variant="outline"
            aria-keyshortcuts={EDITOR_KEYSTROKES.edit.key}
            aria-expanded={expanded}
            onClick={press}
          >
            {session.standing === "commits" ? WORDS.edit : WORDS.suggest}
          </Button>
        )}
        <div ref={setSlot} />
      </div>
    ),
    editor: launched ? (
      <Suspense fallback={<p className="mt-6 text-muted-foreground">{WORDS.loading}</p>}>
        <LazySession
          {...session}
          presses={presses}
          slot={slot}
          buttonRef={buttonRef}
          onExpanded={setExpanded}
        />
      </Suspense>
    ) : null,
  };
}
