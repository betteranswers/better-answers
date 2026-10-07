import type { Keystroke } from "@/shared/keystrokes.tsx";
import { viewStateOf } from "@/shared/page-toolbar.tsx";

import type { GroupOfFindings } from "./sources-api.ts";

const CONNECTED_SOURCES_PAGE = "/sources/connected-sources";

export const SOURCES_KEYSTROKES = {
  connect: { key: "b", act: "Connect a document" },
  review: { key: "r", act: "Review the connected source in focus" },
  publish: { key: "p", act: "Publish the connected source in focus" },
  narrow: { key: "n", act: "Narrow the connected source in focus" },
  widen: { key: "w", act: "Widen the connected source in focus" },
  select: { key: "x", act: "Select or clear the group of findings in focus" },
  keep: { key: "k", act: "Keep the selected groups of findings in text" },
  narrowDocuments: { key: "d", act: "Narrow the documents the selected groups of findings sit in" },
  dismiss: { key: "s", act: "Dismiss the selected groups of findings as not special category" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const REVIEW_HEADING = "review-of-the-connected-source";

/** The groups as the review listed them: what the acts hand back is a group, never a finding. */
export type TickedGroups = {
  readonly connectedSourceId: string;
  readonly groups: readonly GroupOfFindings[];
};

export const useTickedGroups = viewStateOf<TickedGroups>(CONNECTED_SOURCES_PAGE);

export const groupsTickedIn = (
  ticked: TickedGroups | undefined,
  connectedSourceId: string,
): readonly GroupOfFindings[] =>
  ticked?.connectedSourceId === connectedSourceId ? ticked.groups : [];
