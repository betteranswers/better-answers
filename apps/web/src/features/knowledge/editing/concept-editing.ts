import type { ApiError } from "@/shared/api/trpc.ts";

import type { EditRead, SaveAsked, Saved, SourceEntry } from "../knowledge-api.ts";

export type Mode = "visual" | "source";

export type Draft = {
  readonly title: string;
  readonly kind: string;
  readonly description: string;
  readonly tags: string;
  readonly body: string;
  readonly sources: readonly SourceEntry[];
};

export type EditTarget =
  | { readonly kind: "concept"; readonly iri: string }
  | { readonly kind: "new"; readonly collection: string | undefined };

export type Open = {
  readonly read: EditRead;
  readonly draft: Draft;
  readonly mode: Mode;
  readonly lossy: boolean;
};

export type Failure = Error | ApiError;

export type EditorState =
  | { readonly stage: "closed"; readonly kept: boolean }
  | { readonly stage: "loading" }
  | { readonly stage: "unreadable"; readonly failure: Failure }
  | {
      readonly stage: "editing";
      readonly open: Open;
      readonly unchanged: boolean;
      readonly failure: Failure | undefined;
    }
  | { readonly stage: "confirming"; readonly open: Open; readonly recounted: boolean }
  | { readonly stage: "saving"; readonly open: Open; readonly confirmed: boolean }
  | { readonly stage: "stale"; readonly open: Open }
  | { readonly stage: "done"; readonly outcome: "committed" | "suggested" };

export type EditorEvent =
  | { readonly type: "open" }
  | { readonly type: "read"; readonly open: Open }
  | { readonly type: "unreadable"; readonly failure: Failure }
  | { readonly type: "edit"; readonly patch: Partial<Draft> }
  | { readonly type: "mode"; readonly mode: Mode; readonly lossy: boolean }
  | { readonly type: "save" }
  | { readonly type: "confirm" }
  | { readonly type: "keepEditing" }
  | { readonly type: "saved"; readonly answer: Saved }
  | { readonly type: "refused"; readonly failure: Failure }
  | { readonly type: "stale" }
  | { readonly type: "reread"; readonly read: EditRead }
  | { readonly type: "relocated"; readonly read: EditRead }
  | { readonly type: "close"; readonly kept: boolean };

export const CLOSED: EditorState = { stage: "closed", kept: false };

const editingFrom = (
  open: Open,
  said: { readonly unchanged?: boolean; readonly failure?: Failure } = {},
): EditorState => ({
  stage: "editing",
  open,
  unchanged: said.unchanged ?? false,
  failure: said.failure,
});

const asksBeforeSaving = ({ read }: Open): boolean =>
  read.usedIn.writeUps + read.usedIn.linkingConcepts > 1;

const savedFrom = (answer: Saved, open: Open): EditorState => {
  if (answer.outcome === "unchanged") return editingFrom(open, { unchanged: true });
  return { stage: "done", outcome: answer.outcome };
};

const whileEditing = (state: EditorState, change: (open: Open) => EditorState): EditorState =>
  state.stage === "editing" ? change(state.open) : state;

type EventOf<Type extends EditorEvent["type"]> = Extract<EditorEvent, { readonly type: Type }>;

type Handlers = {
  readonly [Type in EditorEvent["type"]]: (state: EditorState, event: EventOf<Type>) => EditorState;
};

const OPENABLE: ReadonlySet<EditorState["stage"]> = new Set(["closed", "unreadable", "done"]);

const HANDLERS: Handlers = {
  open: (state) => (OPENABLE.has(state.stage) ? { stage: "loading" } : state),
  read: (state, event) =>
    state.stage === "loading" || state.stage === "stale" ? editingFrom(event.open) : state,
  unreadable: (state, event) =>
    state.stage === "loading" ? { stage: "unreadable", failure: event.failure } : state,
  edit: (state, event) =>
    whileEditing(state, (open) =>
      editingFrom({ ...open, draft: { ...open.draft, ...event.patch } }),
    ),
  mode: (state, event) =>
    whileEditing(state, (open) => editingFrom({ ...open, mode: event.mode, lossy: event.lossy })),
  save: (state) =>
    whileEditing(state, (open) =>
      asksBeforeSaving(open)
        ? { stage: "confirming", open, recounted: false }
        : { stage: "saving", open, confirmed: false },
    ),
  confirm: (state) =>
    state.stage === "confirming" ? { stage: "saving", open: state.open, confirmed: true } : state,
  keepEditing: (state) => (state.stage === "confirming" ? editingFrom(state.open) : state),
  saved: (state, event) => (state.stage === "saving" ? savedFrom(event.answer, state.open) : state),
  refused: (state, event) =>
    state.stage === "saving" ? editingFrom(state.open, { failure: event.failure }) : state,
  stale: (state) => (state.stage === "saving" ? { stage: "stale", open: state.open } : state),
  reread: (state, event) =>
    state.stage === "saving"
      ? { stage: "confirming", open: { ...state.open, read: event.read }, recounted: true }
      : state,
  relocated: (state, event) =>
    whileEditing(state, (open) => editingFrom({ ...open, read: event.read })),
  close: (_state, event) => ({ stage: "closed", kept: event.kept }),
};

const reduced = <Type extends EditorEvent["type"]>(
  state: EditorState,
  event: EventOf<Type>,
): EditorState => HANDLERS[event.type](state, event);

export const editorReducer = (state: EditorState, event: EditorEvent): EditorState =>
  reduced(state, event);

const NO_TAGS: readonly string[] = [];

const tagsOf = (typed: string): readonly string[] => {
  const words = typed
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
  return words.length === 0 ? NO_TAGS : [...new Set(words)];
};

export const savedAs = (target: EditTarget, open: Open, confirmed: boolean): SaveAsked => {
  const { draft, read } = open;
  const common = {
    parts: {
      title: draft.title,
      kind: draft.kind,
      description: draft.description.trim() === "" ? null : draft.description,
      tags: [...tagsOf(draft.tags)],
      body: draft.body,
    },
    sources: [...draft.sources],
    base: read.base,
    withheld: read.withheld.map((source) => source.at),
    reuse: confirmed ? ("confirmed" as const) : undefined,
  };
  return target.kind === "concept"
    ? { ...common, iri: target.iri }
    : { ...common, collection: target.collection ?? "" };
};

export const sourceNumberOf = (
  withheld: readonly { readonly at: number }[],
  index: number,
): number => {
  let number = index;
  for (const { at } of withheld.toSorted((one, other) => one.at - other.at)) {
    if (at <= number) number += 1;
  }
  return number + 1;
};

export type CannotSave = "collection" | "title" | "kind" | "body";

export const cannotSaveBecause = (target: EditTarget, draft: Draft): CannotSave | undefined => {
  if (target.kind === "new" && target.collection === undefined) return "collection";
  if (draft.title.trim() === "") return "title";
  if (draft.kind.trim() === "") return "kind";
  if (draft.body.trim() === "") return "body";
  return undefined;
};
