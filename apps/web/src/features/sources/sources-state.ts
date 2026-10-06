import type { Keystroke } from "@/shared/keystrokes.tsx";
import { viewStateOf } from "@/shared/page-toolbar.tsx";

import type { FindingGroup } from "./sources-api.ts";

const CONNECTED_SOURCES_PAGE = "/sources/connected-sources";

export const SOURCES_KEYSTROKES = {
  connect: { key: "b", act: "Connect a document" },
  review: { key: "r", act: "Review the connected source in focus" },
  publish: { key: "p", act: "Publish the connected source in focus" },
  narrow: { key: "n", act: "Narrow the connected source in focus" },
  widen: { key: "w", act: "Widen the connected source in focus" },
  select: { key: "x", act: "Select or clear the finding group in focus" },
  keep: { key: "k", act: "Keep the selected finding groups in text" },
  narrowDocuments: { key: "d", act: "Narrow the documents the selected finding groups sit in" },
  dismiss: { key: "s", act: "Dismiss the selected finding groups as not special category" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const REVIEW_HEADING = "review-of-the-connected-source";

/** The groups as the review listed them: what the acts hand back is a group, never a finding. */
export type TickedGroups = {
  readonly connectedSourceId: string;
  readonly groups: readonly FindingGroup[];
};

export const useTickedGroups = viewStateOf<TickedGroups>(CONNECTED_SOURCES_PAGE);

export const groupsTickedIn = (
  ticked: TickedGroups | undefined,
  connectedSourceId: string,
): readonly FindingGroup[] =>
  ticked?.connectedSourceId === connectedSourceId ? ticked.groups : [];
