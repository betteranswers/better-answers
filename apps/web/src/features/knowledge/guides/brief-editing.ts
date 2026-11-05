import { markersOf } from "@better-answers/schema/brief-marker";

import type { Outcome } from "@/shared/outcome.tsx";

import type { BriefAsked, SectionBrief } from "../knowledge-api.ts";

export type Say = (outcome: Outcome | undefined) => void;

export type Include = NonNullable<SectionBrief["editable"]>["footnotes"][number];

export type Opened = {
  readonly base: number;
  readonly original: string;
  readonly markdown: string;
};

export type BriefState =
  | { readonly stage: "closed" }
  | { readonly stage: "editing"; readonly open: Opened }
  | { readonly stage: "saving"; readonly open: Opened }
  | { readonly stage: "stale"; readonly open: Opened };

export type BriefEvent =
  | { readonly type: "open"; readonly open: Opened }
  | { readonly type: "edit"; readonly markdown: string }
  | { readonly type: "save" }
  | { readonly type: "saved"; readonly changed: boolean }
  | { readonly type: "refused" }
  | { readonly type: "stale" }
  | { readonly type: "reload"; readonly open: Opened }
  | { readonly type: "close" };

export const CLOSED: BriefState = { stage: "closed" };

type EventOf<Type extends BriefEvent["type"]> = Extract<BriefEvent, { readonly type: Type }>;

type Handlers = {
  readonly [Type in BriefEvent["type"]]: (state: BriefState, event: EventOf<Type>) => BriefState;
};

const editingFrom = (open: Opened): BriefState => ({ stage: "editing", open });

const HANDLERS: Handlers = {
  open: (state, event) => (state.stage === "closed" ? editingFrom(event.open) : state),
  edit: (state, event) =>
    state.stage === "editing" ? editingFrom({ ...state.open, markdown: event.markdown }) : state,
  save: (state) => (state.stage === "editing" ? { stage: "saving", open: state.open } : state),
  saved: (state, event) => {
    if (state.stage !== "saving") return state;
    return event.changed ? CLOSED : editingFrom(state.open);
  },
  refused: (state) => (state.stage === "saving" ? editingFrom(state.open) : state),
  stale: (state) => (state.stage === "saving" ? { stage: "stale", open: state.open } : state),
  reload: (state, event) => (state.stage === "stale" ? editingFrom(event.open) : state),
  close: (state) => (state.stage === "editing" || state.stage === "stale" ? CLOSED : state),
};

const reduced = <Type extends BriefEvent["type"]>(
  state: BriefState,
  event: EventOf<Type>,
): BriefState => HANDLERS[event.type](state, event);

export const briefReducer = (state: BriefState, event: BriefEvent): BriefState =>
  reduced(state, event);

export const openedWith = (base: number, original: string, kept: string | undefined): Opened => ({
  base,
  original,
  markdown: kept ?? original,
});

export const isLocked = (state: BriefState): boolean =>
  state.stage === "saving" || state.stage === "stale";

export const hasUnsaved = (state: BriefState): boolean =>
  "open" in state && state.open.markdown !== state.open.original;

export const savedAs = (writeUpId: string, open: Opened): BriefAsked => ({
  writeUpId,
  markdown: open.markdown,
  base: open.base,
});

export const placedIn = (markdown: string): ReadonlySet<string> => new Set(markersOf(markdown));
