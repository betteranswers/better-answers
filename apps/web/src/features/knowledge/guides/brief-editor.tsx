import { useEffect, useReducer, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { refusalOf } from "@/shared/api/trpc.ts";
import { useMember } from "@/shared/member/member.ts";
import { Button } from "@/shared/ui/button.tsx";

import { useSaveBrief, type BriefSaved, type SectionBrief } from "../knowledge-api.ts";
import { BriefBody } from "./brief-body.tsx";
import { draftKeyOf, forgetBrief, keptBriefOf, useKeptBrief } from "./brief-draft.ts";
import {
  briefReducer,
  CLOSED,
  hasUnsaved,
  isLocked,
  openedWith,
  placedIn,
  savedAs,
  type BriefState,
  type Say,
} from "./brief-editing.ts";
import { EarlierDraft } from "./earlier-draft.tsx";
import { failed, said, type Failure } from "./guide-outcome.ts";
import { GUIDE_KEYSTROKES, IN_THE_TEXT } from "./guide-state.ts";
import { BRIEF_WORDS as WORDS } from "./guide-words.ts";

export type BriefSessionProps = {
  readonly writeUpId: string;
  readonly number: string;
  readonly version: number;
  readonly editable: NonNullable<SectionBrief["editable"]>;
  readonly id: string;
  readonly say: Say;
  readonly onUnsaved: (unsaved: boolean) => void;
  readonly onClosed: () => void;
};

const startOf = (properties: BriefSessionProps, key: string | undefined): BriefState =>
  briefReducer(CLOSED, {
    type: "open",
    open: openedWith(properties.version, properties.editable.markdown, keptBriefOf(key)),
  });

const useReportedUnsaved = (unsaved: boolean, report: (unsaved: boolean) => void) => {
  useEffect(() => {
    report(unsaved);
    return () => {
      report(false);
    };
  }, [unsaved, report]);
};

type Session = {
  readonly state: BriefState;
  readonly draftKey: string | undefined;
  readonly save: () => Promise<void>;
  readonly reload: () => void;
  readonly discard: () => void;
  readonly edit: (markdown: string) => void;
  readonly close: () => void;
  readonly generation: number;
};

const useSession = (properties: BriefSessionProps): Session => {
  const { writeUpId, say, onClosed } = properties;
  const person = useMember().data?.person.id;
  const [state, dispatch] = useReducer(briefReducer, undefined, () =>
    startOf(properties, draftKeyOf(person, writeUpId, properties.version)),
  );
  const draftKey = draftKeyOf(
    person,
    writeUpId,
    "open" in state ? state.open.base : properties.version,
  );
  const [generation, setGeneration] = useState(0);
  const saveBrief = useSaveBrief();

  const answered = (answer: BriefSaved) => {
    dispatch({ type: "saved", changed: answer.saved });
    if (!answer.saved) {
      say(said(WORDS.unchanged(answer.version)));
      return;
    }
    forgetBrief(draftKey);
    say(said(WORDS.saved(answer.version)));
    onClosed();
  };

  const refused = (failure: Failure) => {
    if (refusalOf(failure)?.word === "stale-precondition") {
      dispatch({ type: "stale" });
      say(said(WORDS.stale));
    } else {
      dispatch({ type: "refused" });
      say(failed(failure));
    }
  };

  const save = async () => {
    if (state.stage !== "editing") return;
    const asked = savedAs(writeUpId, state.open);
    dispatch({ type: "save" });
    say(said(WORDS.saving));
    try {
      answered(await saveBrief(asked));
    } catch (thrown) {
      refused(thrown instanceof Error ? thrown : new Error(String(thrown)));
    }
  };

  return {
    state,
    draftKey,
    save,
    generation,
    edit: (markdown) => {
      dispatch({ type: "edit", markdown });
    },
    reload: () => {
      forgetBrief(draftKey);
      setGeneration((current) => current + 1);
      say(hasUnsaved(state) ? said(WORDS.reloaded) : undefined);
      dispatch({
        type: "reload",
        open: openedWith(properties.version, properties.editable.markdown, undefined),
      });
    },
    discard: () => {
      dispatch({ type: "discard" });
    },
    close: () => {
      if (state.stage === "saving") return;
      dispatch({ type: "close" });
      onClosed();
    },
  };
};

function Actions(properties: {
  readonly state: BriefState;
  readonly saveRef: RefObject<HTMLButtonElement | null>;
  readonly session: Session;
}) {
  const { state, saveRef, session } = properties;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {state.stage === "stale" ? (
        <Button type="button" variant="accent" onClick={session.reload}>
          {WORDS.reload}
        </Button>
      ) : (
        <Button
          ref={saveRef}
          type="button"
          aria-disabled={state.stage === "saving"}
          aria-keyshortcuts={GUIDE_KEYSTROKES.saveBrief.key}
          onClick={() => {
            void session.save();
          }}
        >
          {WORDS.save}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        aria-disabled={state.stage === "saving"}
        onClick={session.close}
      >
        {WORDS.close}
      </Button>
    </div>
  );
}

export function BriefSession(properties: BriefSessionProps) {
  const { number, editable } = properties;
  const session = useSession(properties);
  const { state } = session;
  const saveRef = useRef<HTMLButtonElement>(null);
  useKeptBrief(session.draftKey, state);
  useReportedUnsaved(hasUnsaved(state), properties.onUnsaved);

  const onKeys = (event: KeyboardEvent<HTMLElement>) => {
    const { target } = event;
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      void session.save();
    } else if (event.key === "Escape" && target instanceof Element && target.matches(IN_THE_TEXT)) {
      event.preventDefault();
      event.stopPropagation();
      saveRef.current?.focus();
    }
  };

  if (state.stage === "closed") return null;
  return (
    <section
      id={properties.id}
      aria-label={WORDS.editing(number)}
      className="mt-4 border-t border-border pt-4"
      onKeyDownCapture={onKeys}
    >
      <div inert={isLocked(state)}>
        <BriefBody
          key={session.generation}
          label={WORDS.label(number)}
          value={state.open.markdown}
          includes={editable.footnotes}
          placed={placedIn(state.open.markdown)}
          onChange={session.edit}
        />
      </div>
      <Actions state={state} saveRef={saveRef} session={session} />
      {state.open.earlier === undefined ? null : (
        <EarlierDraft
          markdown={state.open.earlier}
          includes={editable.footnotes}
          onDiscard={() => {
            saveRef.current?.focus();
            session.discard();
          }}
        />
      )}
    </section>
  );
}
