import type { Keystroke } from "@/shared/keystrokes.tsx";
import { viewStateOf } from "@/shared/page-toolbar.tsx";

import type { GroupOfFindings } from "./sources-api.ts";

const CONNECTED_SOURCES_PAGE = "/sources/connected-sources";

export const SOURCES_KEYSTROKES = {
  connect: { key: "b", action: "Connect a document" },
  review: { key: "r", action: "Review the connected source in focus" },
  publish: { key: "p", action: "Publish the connected source in focus" },
  narrow: { key: "n", action: "Narrow the connected source in focus" },
  widen: { key: "w", action: "Widen the connected source in focus" },
  select: { key: "x", action: "Select or clear the group of findings in focus" },
  keep: { key: "k", action: "Keep the selected groups of findings in text" },
  narrowDocuments: {
    key: "d",
    action: "Narrow the documents the selected groups of findings sit in",
  },
  dismiss: { key: "s", action: "Dismiss the selected groups of findings as not special category" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const REVIEW_HEADING = "review-of-the-connected-source";

/** The groups as the review listed them: what the actions hand back is a group, never a finding. */
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
