import type { Keystroke } from "@/shared/keystrokes.tsx";
import { viewStateOf } from "@/shared/view-toolbar.tsx";

import type { FindingGroup } from "./sources-api.ts";

const BINDINGS_VIEW = "/sources/bindings";

export const SOURCES_KEYSTROKES = {
  bind: { key: "b", act: "Bind a document" },
  review: { key: "r", act: "Review the binding in focus" },
  publish: { key: "p", act: "Publish the binding in focus" },
  narrow: { key: "n", act: "Narrow the binding in focus" },
  select: { key: "x", act: "Select or clear the finding group in focus" },
  keep: { key: "k", act: "Keep the selected finding groups in text" },
  narrowDocuments: { key: "d", act: "Narrow the documents the selected finding groups sit in" },
  dismiss: { key: "s", act: "Dismiss the selected finding groups as not special category" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const REVIEW_HEADING = "review-of-the-binding";

// The groups as the review listed them: what the acts hand back is a group, never a finding.
export type TickedGroups = {
  readonly bindingId: string;
  readonly groups: readonly FindingGroup[];
};

export const useTickedGroups = viewStateOf<TickedGroups>(BINDINGS_VIEW);
