import type { Keystroke } from "@/shared/keystrokes.tsx";
import { viewStateOf } from "@/shared/page-toolbar.tsx";

import type { GroupOfFindings } from "./sources-api.ts";

const CONNECTED_SOURCES_PAGE = "/sources/connected-sources";

export const SOURCES_KEYSTROKES = {
  connect: { key: "b", action: "Connect a Document" },
  review: { key: "r", action: "Review the Connected Source in Focus" },
  publish: { key: "p", action: "Publish the Connected Source in Focus" },
  narrow: { key: "n", action: "Narrow the Connected Source in Focus" },
  widen: { key: "w", action: "Widen the Connected Source in Focus" },
  select: { key: "x", action: "Select or Clear the Group of Findings in Focus" },
  keep: { key: "k", action: "Keep the Selected Groups of Findings in Text" },
  narrowDocuments: {
    key: "d",
    action: "Narrow the Documents the Selected Groups of Findings Sit In",
  },
  dismiss: { key: "s", action: "Dismiss the Selected Groups of Findings as Not Special Category" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const REVIEW_HEADING = "review-of-the-connected-source";

/** One id, as the review's heading has: one narrowing or widening is open on the page at a time. */
export const SENSITIVITY_FIELD = "sensitivity-of-the-connected-source";

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
