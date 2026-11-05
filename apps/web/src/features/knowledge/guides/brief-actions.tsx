import { useBlocker } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useId, useRef, useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog.tsx";
import { Button } from "@/shared/ui/button.tsx";

import type { SectionBrief } from "../knowledge-api.ts";
import type { Say } from "./brief-editing.ts";
import { actionNamed, GUIDE_KEYSTROKES, IN_THE_TEXT, SECTION_ACTIONS } from "./guide-state.ts";
import { BRIEF_WORDS as WORDS } from "./guide-words.ts";

const LazySession = lazy(() =>
  // oxlint-disable-next-line better-answers/import-statically -- Tiptap loads only when someone edits a Brief
  import("./brief-editor.tsx").then((loaded) => ({ default: loaded.BriefSession })),
);

type Options = {
  readonly sectionId: string;
  readonly writeUpId: string;
  readonly number: string;
  readonly brief: SectionBrief | undefined;
  readonly say: Say;
  readonly reportUnsaved: (sectionId: string, unsaved: boolean) => void;
};

export type BriefEditing = {
  readonly actions: ReactNode;
  readonly editor: ReactNode;
  readonly open: boolean;
};

export function useBriefEditing(options: Options): BriefEditing {
  const { sectionId, brief, reportUnsaved } = options;
  const editable = brief?.editable;
  const [launched, setLaunched] = useState(false);
  const editorId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const press = () => {
    if (launched)
      document.getElementById(editorId)?.querySelector<HTMLElement>(IN_THE_TEXT)?.focus();
    else setLaunched(true);
  };
  const onUnsaved = useCallback(
    (unsaved: boolean) => {
      reportUnsaved(sectionId, unsaved);
    },
    [reportUnsaved, sectionId],
  );
  const onClosed = useCallback(() => {
    setLaunched(false);
    buttonRef.current?.focus();
  }, []);

  if (brief === undefined || editable === undefined) {
    return { actions: null, editor: null, open: false };
  }
  return {
    open: launched,
    actions: (
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        {...actionNamed(SECTION_ACTIONS.editBrief)}
        aria-expanded={launched}
        aria-keyshortcuts={GUIDE_KEYSTROKES.editBrief.key}
        onClick={press}
      >
        {WORDS.edit}
      </Button>
    ),
    editor: launched ? (
      <Suspense fallback={<p className="mt-4 text-muted-foreground">{WORDS.loading}</p>}>
        <LazySession
          writeUpId={options.writeUpId}
          number={options.number}
          version={brief.version}
          editable={editable}
          id={editorId}
          say={options.say}
          onUnsaved={onUnsaved}
          onClosed={onClosed}
        />
      </Suspense>
    ) : null,
  };
}

export type Leaving = { readonly proceed: () => void; readonly reset: () => void };

export const useLeavingGuard = () => {
  const unsaved = useRef(new Set<string>());
  const shouldBlockFn = useCallback(() => unsaved.current.size > 0, []);
  const blocker = useBlocker({ shouldBlockFn, enableBeforeUnload: false, withResolver: true });
  const report = useCallback((sectionId: string, isUnsaved: boolean) => {
    if (isUnsaved) unsaved.current.add(sectionId);
    else unsaved.current.delete(sectionId);
  }, []);
  const leaving: Leaving | undefined =
    blocker.status === "blocked" ? { proceed: blocker.proceed, reset: blocker.reset } : undefined;
  return { report, leaving };
};

export function LeavingAsk(properties: { readonly leaving: Leaving | undefined }) {
  const { leaving } = properties;
  return (
    <AlertDialog
      open={leaving !== undefined}
      onOpenChange={(opened) => {
        if (!opened) leaving?.reset();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{WORDS.leaving}</AlertDialogTitle>
          <AlertDialogDescription>{WORDS.leavingDetail}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{WORDS.keepEditing}</AlertDialogCancel>
          <AlertDialogAction onClick={leaving?.proceed}>{WORDS.leave}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
