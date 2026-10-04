import { counted } from "@/shared/words.ts";

import type { Asked, Family } from "./audit-log-api.ts";

const FAMILY_WORDS = {
  people: "People",
  knowledge: "Knowledge",
  sources: "Sources",
  platform: "Platform",
} as const satisfies Readonly<Record<Family, string>>;

const TOO_BROAD =
  "The search named more than 100 people or groups, so only the events of the first 100 are shown. Narrow it to see the rest.";

const quoted = (search: string): string => `“${search}”`;

const narrowedBy = (asked: Asked): string =>
  [
    asked.family === undefined ? "" : ` in the ${asked.family} family`,
    asked.search === "" ? "" : ` matching ${quoted(asked.search)}`,
  ].join("");

type Saved = { readonly count: number; readonly capped: boolean; readonly searchTooBroad: boolean };

const savedHeld = (saved: Saved, name: string): string =>
  saved.capped
    ? `Saved the newest ${saved.count.toLocaleString("en-GB")} events to ${name}. The file stops there; narrow the search or the family for the rest.`
    : `Saved ${counted(saved.count, "event", "events")} to ${name}.`;

export const AUDIT_LOG_WORDS = {
  heading: "Audit log",
  summary:
    "Every action in this workspace except answers, newest first: what was done, to what, by whom and when. Answers are kept apart, in Questions asked.",
  search: "Search by person, group or action",
  family: "Family",
  everyFamily: "All families",
  families: FAMILY_WORDS,
  loading: "The audit log is still loading.",
  none: "No actions in this workspace yet.",
  noneNarrowed: (asked: Asked): string => `No events${narrowedBy(asked)}.`,
  counted: (asked: Asked, shown: number, older: boolean): string => {
    if (shown === 0) return "";
    if (older) return `The newest ${shown} events${narrowedBy(asked)}; older ones follow.`;
    return `${counted(shown, "event", "events")}${narrowedBy(asked)}.`;
  },
  older: "Older events",
  tooBroad: TOO_BROAD,
  details: "Details",
  detailsOf: (headline: string, at: string): string => ` of ${headline}, ${at}`,
  by: "By",
  about: "About",
  export: "Export the events shown",
  exporting: "Exporting the events shown",
  saved: (saved: Saved, name: string): string =>
    saved.searchTooBroad ? `${savedHeld(saved, name)} ${TOO_BROAD}` : savedHeld(saved, name),
} as const;
