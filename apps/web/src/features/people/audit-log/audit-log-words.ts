import { counted } from "@/shared/words.ts";

import type { Asked, Family } from "./audit-log-api.ts";

const FAMILY_WORDS = {
  people: "People",
  knowledge: "Knowledge",
  sources: "Sources",
  platform: "Platform",
} as const satisfies Readonly<Record<Family, string>>;

const TOO_BROAD =
  "Showing events for the first 100 matching people or groups. Narrow your search to see the rest.";

const TOO_BROAD_SAVED = "The file holds events for the first 100 matching people or groups.";

const quoted = (search: string): string => `“${search}”`;

const narrowedBy = (asked: Asked): string =>
  [
    asked.family === undefined ? "" : ` in the ${asked.family} family`,
    asked.search === "" ? "" : ` matching ${quoted(asked.search)}`,
  ].join("");

type Saved = { readonly count: number; readonly capped: boolean; readonly searchTooBroad: boolean };

const savedHeld = (saved: Saved, name: string): string =>
  saved.capped
    ? `Newest ${saved.count.toLocaleString("en-GB")} events saved to ${name}. Narrow the search or the family to export the rest.`
    : `${counted(saved.count, "event", "events")} saved to ${name}.`;

export const AUDIT_LOG_WORDS = {
  search: "Search by person, group or action",
  family: "Family",
  everyFamily: "All families",
  families: FAMILY_WORDS,
  loading: "The audit log is still loading.",
  none: "No events yet",
  noneNarrowed: (asked: Asked): string =>
    asked.search === ""
      ? "No events match these filters."
      : `No events match ${quoted(asked.search)}.`,
  counted: (asked: Asked, shown: number, older: boolean): string => {
    if (shown === 0) return "";
    if (older) return `Showing the newest ${shown} events${narrowedBy(asked)}.`;
    return `${counted(shown, "event", "events")}${narrowedBy(asked)}.`;
  },
  older: "Older events",
  tooBroad: TOO_BROAD,
  details: "Details",
  detailsOf: (headline: string, at: string): string => ` of ${headline}, ${at}`,
  by: "By",
  about: "About",
  export: "Export events",
  exporting: "Exporting events",
  saved: (saved: Saved, name: string): string =>
    saved.searchTooBroad ? `${savedHeld(saved, name)} ${TOO_BROAD_SAVED}` : savedHeld(saved, name),
} as const;
