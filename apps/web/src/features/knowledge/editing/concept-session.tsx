import { skipToken, useQuery } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { WHILE_A_CEILING_HOLDS, type FailedDuring } from "@/shared/api/query-client.ts";
import { ceilingLiftsIn, refusalOf, useTRPC } from "@/shared/api/trpc.ts";
import { conceptPageOf } from "@/shared/knowledge/concept-address.ts";
import { titleOf } from "@/shared/knowledge/concept-frontmatter.ts";
import { useMember } from "@/shared/member/member.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { refusalsOf, refusedWith } from "@/shared/refusal-outcome.tsx";
import { stockWait } from "@/shared/refusal-words.ts";

import {
  useReadToEdit,
  useSaveConcept,
  type EditAsked,
  type EditRead,
  type Saved,
} from "../knowledge-api.ts";
import {
  CLOSED,
  cannotSaveBecause,
  editorReducer,
  savedAs,
  type Draft,
  type EditorEvent,
  type EditorState,
  type EditTarget,
  type Failure,
  type Open,
} from "./concept-editing.ts";
import {
  ConceptEditor,
  openingMode,
  type EditorEvents,
  type EditorProps,
  type Leaving,
} from "./concept-editor.tsx";
import { EDITOR_WORDS as WORDS, SAID_OF_EDITING } from "./editor-words.ts";
import { draftKeyOf, forgetDraft, keptDraftOf, sameDraft, useKeptDraft } from "./kept-draft.ts";

export type Prefill = {
  readonly title: string;
  readonly kind: string;
  readonly tags: string;
  readonly subject: string;
};

export type Finished = "committed" | "suggested" | undefined;

export type Standing = "commits" | "suggests" | undefined;

export type SessionOptions = {
  readonly target: EditTarget;
  readonly standing: Standing;
  readonly prefill?: Prefill;
  readonly onCollection?: (collection: string | undefined) => void;
  readonly onFinished?: (outcome: Finished) => void;
};

type SessionProps = SessionOptions & {
  readonly presses: number;
  readonly slot: HTMLElement | null;
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
  readonly onExpanded: (expanded: boolean) => void;
};

const BLANK: EditRead = {
  parts: { title: "", kind: "", description: null, tags: [], body: "" },
  sources: [],
  withheld: [],
  base: null,
  standing: "suggests",
  usedIn: { writeUps: 0, linkingConcepts: 0 },
};

const NO_COLLECTIONS: readonly string[] = [];

const namesOf = (tree: {
  readonly collections: readonly { readonly collection: string | null }[];
}): readonly string[] =>
  tree.collections.flatMap(({ collection }) => (collection === null ? [] : [collection]));

const useChoosableCollections = (enabled: boolean): readonly string[] => {
  const api = useTRPC();
  return (
    useQuery(
      api.knowledge.tree.queryOptions(undefined, {
        ...WHILE_A_CEILING_HOLDS,
        enabled,
        select: namesOf,
      }),
    ).data ?? NO_COLLECTIONS
  );
};

const markdownLink = (text: string, iri: string): string =>
  `[${text.replaceAll(/[[\]\\]/gu, String.raw`\$&`)}](${iri})`;

const useSubjectLink = (subject: string | undefined) => {
  const api = useTRPC();
  const asked = subject === undefined || subject === "" ? undefined : subject;
  const read = useQuery(
    api.knowledge.open.queryOptions(
      asked === undefined ? skipToken : { iri: asked },
      WHILE_A_CEILING_HOLDS,
    ),
  );
  if (asked === undefined) return { settled: true, link: undefined };
  if (read.isPending) return { settled: false, link: undefined };
  const concept = read.data?.concept;
  const text = concept === undefined ? asked : titleOf(concept.frontmatter);
  return { settled: true, link: markdownLink(text, asked) };
};

const draftOf = (read: EditRead): Draft => ({
  title: read.parts.title,
  kind: read.parts.kind,
  description: read.parts.description ?? "",
  tags: read.parts.tags.join(", "),
  body: read.parts.body,
  sources: read.sources,
});

const askedOf = (target: EditTarget): EditAsked | undefined => {
  if (target.kind === "concept") return { iri: target.iri };
  return target.collection === undefined ? undefined : { collection: target.collection };
};

const guarded = async (
  work: () => Promise<void>,
  failed: (failure: Failure) => void | Promise<void>,
) => {
  try {
    await work();
  } catch (thrown) {
    await failed(thrown instanceof Error ? thrown : new Error(String(thrown)));
  }
};

const withoutBlankSources = (open: Open): Open => ({
  ...open,
  draft: {
    ...open.draft,
    sources: open.draft.sources.filter((entry) => typeof entry !== "string" || entry.trim() !== ""),
  },
});

type Session = {
  readonly state: EditorState;
  readonly dispatch: Dispatch<EditorEvent>;
  readonly target: EditTarget;
};

type StateAt<Stage extends EditorState["stage"]> = Extract<EditorState, { readonly stage: Stage }>;

type Opened = { readonly open: Open; readonly own: Draft };

const useOpened = (
  target: EditTarget,
  prefill: Prefill | undefined,
  draftKey: string | undefined,
) => {
  const readToEdit = useReadToEdit();
  const subject = useSubjectLink(prefill?.subject);

  const withPrefill = (own: Draft): Draft =>
    prefill === undefined
      ? own
      : {
          ...own,
          title: prefill.title,
          kind: prefill.kind,
          tags: prefill.tags,
          body: subject.link ?? own.body,
        };

  const opened = async (restoring: boolean): Promise<Opened> => {
    const asked = askedOf(target);
    const read = asked === undefined ? BLANK : await readToEdit(asked);
    const own = withPrefill(draftOf(read));
    const kept = restoring ? keptDraftOf(draftKey, read.base) : undefined;
    const draft = kept !== undefined && !sameDraft(kept, own) ? kept : own;
    const mode = openingMode(draft.body);
    return { open: { read, draft, mode, lossy: mode === "source" }, own };
  };

  return { opened, readToEdit, subjectSettled: subject.settled };
};

const useOpenFlow = (
  session: Session,
  options: SessionOptions,
  draftKey: string | undefined,
  focusHeading: () => void,
) => {
  const { state, dispatch, target } = session;
  const { opened, readToEdit, subjectSettled } = useOpened(target, options.prefill, draftKey);
  const [baseline, setBaseline] = useState<Draft>();
  const [generation, setGeneration] = useState(0);
  const [problem, setProblem] = useState<Failure>();
  const started = useRef(false);
  const choices = useRef(0);

  const applied = (read: Opened) => {
    setBaseline(read.own);
    setGeneration((current) => current + 1);
    dispatch({ type: "read", open: read.open });
  };

  const openEditor = async () => {
    if (editorReducer(state, { type: "open" }) === state) return;
    dispatch({ type: "open" });
    await guarded(
      async () => {
        applied(await opened(true));
      },
      (failure) => {
        dispatch({ type: "unreadable", failure });
      },
    );
  };

  const starting = useEffectEvent(() => {
    void openEditor();
  });
  useEffect(() => {
    if (!subjectSettled || started.current) return;
    started.current = true;
    starting();
  }, [subjectSettled]);

  const press = () => {
    if (state.stage === "closed" || state.stage === "unreadable" || state.stage === "done") {
      void openEditor();
    } else {
      focusHeading();
    }
  };

  const reload = async () => {
    if (state.stage !== "stale") return;
    setProblem(undefined);
    await guarded(async () => {
      applied(await opened(false));
      focusHeading();
    }, setProblem);
  };

  const choose = async (collection: string | undefined) => {
    setProblem(undefined);
    choices.current += 1;
    const mine = choices.current;
    const lastChosen = () => mine === choices.current;
    await guarded(
      async () => {
        const read = collection === undefined ? BLANK : await readToEdit({ collection });
        if (lastChosen()) dispatch({ type: "relocated", read });
      },
      (failure) => {
        if (lastChosen()) setProblem(failure);
      },
    );
  };

  const forgetProblem = () => {
    setProblem(undefined);
  };

  return { baseline, generation, problem, press, reload, choose, forgetProblem };
};

const useSaveFlow = (
  session: Session,
  draftKey: string | undefined,
  finished: (outcome: Finished) => void,
) => {
  const { state, dispatch, target } = session;
  const saveConcept = useSaveConcept();
  const readToEdit = useReadToEdit();
  const navigate = useNavigate();

  const reread = async (saving: StateAt<"saving">) => {
    await guarded(
      async () => {
        const asked = askedOf(target);
        const read = asked === undefined ? BLANK : await readToEdit(asked);
        dispatch(
          read.base === saving.open.read.base ? { type: "reread", read } : { type: "stale" },
        );
      },
      (failure) => {
        dispatch({ type: "refused", failure });
      },
    );
  };

  const refused = async (saving: StateAt<"saving">, failure: Failure) => {
    const word = refusalOf(failure)?.word;
    if (word === "stale-precondition") dispatch({ type: "stale" });
    else if (word === "reuse-unconfirmed") await reread(saving);
    else dispatch({ type: "refused", failure });
  };

  const done = (answer: Extract<Saved, { readonly outcome: "committed" | "suggested" }>) => {
    forgetDraft(draftKey);
    finished(answer.outcome);
    const page = answer.outcome === "committed" ? conceptPageOf(answer.iri) : undefined;
    if (target.kind === "new" && page !== undefined) void navigate({ href: page });
  };

  const submit = async (saving: StateAt<"saving">) => {
    await guarded(
      async () => {
        const asked = savedAs(target, withoutBlankSources(saving.open), saving.confirmed);
        const answer = await saveConcept(asked);
        dispatch({ type: "saved", answer });
        if (answer.outcome !== "unchanged") done(answer);
      },
      (failure) => refused(saving, failure),
    );
  };

  const send = (event: EditorEvent) => {
    const next = editorReducer(state, event);
    dispatch(event);
    if (next.stage === "saving" && state.stage !== "saving") void submit(next);
  };

  const save = () => {
    if (state.stage === "confirming") send({ type: "confirm" });
    else if (state.stage === "editing" && cannotSaveBecause(target, state.open.draft) === undefined)
      send({ type: "save" });
  };

  return { send, save };
};

const { outcomeOfFailure } = refusalsOf(SAID_OF_EDITING);

const failed = (failure: Failure, during: FailedDuring): Outcome => {
  const lifts = ceilingLiftsIn(failure);
  return lifts === undefined ? outcomeOfFailure(failure, during) : refusedWith(stockWait(lifts));
};

const said = (words: string): Outcome => ({ tone: "said", words });

type Outcomes = {
  readonly [Stage in EditorState["stage"]]: (
    state: StateAt<Stage>,
    target: EditTarget,
  ) => Outcome | undefined;
};

const suggestedWords = (target: EditTarget): string =>
  target.kind === "new" ? WORDS.suggestedNew : WORDS.suggested;

const editingOutcome = (state: StateAt<"editing">): Outcome | undefined => {
  if (state.failure !== undefined) return failed(state.failure, "action");
  return state.unchanged ? said(WORDS.unchanged) : undefined;
};

const OUTCOMES: Outcomes = {
  closed: (state) => (state.kept ? said(WORDS.kept) : undefined),
  loading: () => undefined,
  unreadable: (state) => failed(state.failure, "read"),
  editing: editingOutcome,
  confirming: () => undefined,
  saving: () => said(WORDS.saving),
  stale: () => said(WORDS.stale),
  done: (state, target) =>
    said(state.outcome === "committed" ? WORDS.saved : suggestedWords(target)),
};

const outcomeFrom = <Stage extends EditorState["stage"]>(
  state: StateAt<Stage>,
  target: EditTarget,
): Outcome | undefined => OUTCOMES[state.stage](state, target);

const OPEN_STAGES: ReadonlySet<EditorState["stage"]> = new Set([
  "loading",
  "editing",
  "confirming",
  "saving",
  "stale",
]);

const UNSAVED_STAGES: ReadonlySet<EditorState["stage"]> = new Set([
  "editing",
  "confirming",
  "stale",
]);

const hasUnsaved = (state: EditorState, baseline: Draft | undefined): boolean =>
  UNSAVED_STAGES.has(state.stage) &&
  "open" in state &&
  baseline !== undefined &&
  !sameDraft(state.open.draft, baseline);

const useLeaving = (blocks: boolean): Leaving | undefined => {
  const shouldBlockFn = useCallback(() => blocks, [blocks]);
  const blocker = useBlocker({ shouldBlockFn, enableBeforeUnload: false, withResolver: true });
  return blocker.status === "blocked"
    ? { proceed: blocker.proceed, reset: blocker.reset }
    : undefined;
};

function EditorRegion(properties: Omit<EditorProps, "shown"> & { readonly state: EditorState }) {
  const { state, ...props } = properties;
  if (state.stage === "loading")
    return <p className="mt-6 text-muted-foreground">{WORDS.loading}</p>;
  if (!("open" in state)) return null;
  return <ConceptEditor shown={state} {...props} />;
}

const usePresses = (presses: number, press: () => void) => {
  const seen = useRef(presses);
  const pressed = useEffectEvent(press);
  useEffect(() => {
    if (presses === seen.current) return;
    seen.current = presses;
    pressed();
  }, [presses]);
};

export function ConceptSession(properties: SessionProps) {
  const { target } = properties;
  const [state, dispatch] = useReducer(editorReducer, CLOSED);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const session = { state, dispatch, target };
  const person = useMember().data?.person.id;
  const draftKey = draftKeyOf(person, target, properties.prefill?.title);
  const opening = useOpenFlow(session, properties, draftKey, () => {
    headingRef.current?.focus();
  });
  const finish = (outcome: Finished) => {
    properties.buttonRef.current?.focus();
    properties.onFinished?.(outcome);
  };
  const saving = useSaveFlow(session, draftKey, finish);
  const collections = useChoosableCollections(target.kind === "new");
  const leaving = useLeaving(hasUnsaved(state, opening.baseline));
  useKeptDraft(draftKey, state, opening.baseline);
  usePresses(properties.presses, opening.press);
  const expanded = OPEN_STAGES.has(state.stage);
  const { onExpanded } = properties;
  useEffect(() => {
    onExpanded(expanded);
  }, [expanded, onExpanded]);

  const events: EditorEvents = {
    edit: (patch) => {
      dispatch({ type: "edit", patch });
    },
    mode: (mode, lossy) => {
      dispatch({ type: "mode", mode, lossy });
    },
    save: saving.save,
    confirm: () => {
      saving.send({ type: "confirm" });
    },
    keepEditing: () => {
      dispatch({ type: "keepEditing" });
    },
    reload: () => {
      void opening.reload();
    },
    close: () => {
      if (state.stage === "saving") return;
      opening.forgetProblem();
      dispatch({ type: "close", kept: hasUnsaved(state, opening.baseline) });
      finish(undefined);
    },
    collection: (collection) => {
      properties.onCollection?.(collection);
      void opening.choose(collection);
    },
  };

  const outcome =
    opening.problem === undefined ? outcomeFrom(state, target) : failed(opening.problem, "action");

  return (
    <>
      {properties.slot === null
        ? null
        : createPortal(<OutcomeLine outcome={outcome} />, properties.slot)}
      <EditorRegion
        state={state}
        target={target}
        collections={collections}
        generation={opening.generation}
        headingRef={headingRef}
        leaving={leaving}
        events={events}
      />
    </>
  );
}
