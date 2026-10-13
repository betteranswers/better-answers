import { counted } from "@/shared/words.ts";

import type { Asked, Family } from "./audit-log-api.ts";

const FAMILY_WORDS = {
  people: "People",
  knowledge: "Knowledge",
  sources: "Sources",
  platform: "Platform",
} as const satisfies Readonly<Record<Family, string>>;

const TOO_BROAD =
  "Your search matched more than 100 people or groups, so only events for the first 100 are shown. Please narrow your search to see the rest.";

const TOO_BROAD_SAVED =
  "Your search matched more than 100 people or groups, so the file only includes events for the first 100.";

const quoted = (search: string): string => `“${search}”`;

const narrowedBy = (asked: Asked): string =>
  [
    asked.family === undefined ? "" : ` in the ${asked.family} family`,
    asked.search === "" ? "" : ` matching ${quoted(asked.search)}`,
  ].join("");

type Saved = { readonly count: number; readonly capped: boolean; readonly searchTooBroad: boolean };

const savedHeld = (saved: Saved, name: string): string =>
  saved.capped
    ? `The newest ${saved.count.toLocaleString("en-GB")} events have been saved to ${name} successfully. Please narrow the search or the family to export the rest.`
    : `${counted(saved.count, "event has", "events have")} been saved to ${name} successfully.`;

export const AUDIT_LOG_WORDS = {
  heading: "Audit Log",
  summary: "See every action in this workspace except answers.",
  search: "Search by person, group or action",
  family: "Family",
  everyFamily: "All Families",
  families: FAMILY_WORDS,
  loading: "The audit log is still loading.",
  none: "No events yet",
  noneNarrowed: (asked: Asked): string =>
    asked.search === ""
      ? "No results found. Try adjusting your filters to see more results."
      : `No results found for ${quoted(asked.search)}.`,
  counted: (asked: Asked, shown: number, older: boolean): string => {
    if (shown === 0) return "";
    if (older) return `Showing the newest ${shown} events${narrowedBy(asked)}.`;
    return `${counted(shown, "event", "events")}${narrowedBy(asked)}.`;
  },
  older: "Older Events",
  tooBroad: TOO_BROAD,
  details: "Details",
  detailsOf: (headline: string, at: string): string => ` of ${headline}, ${at}`,
  by: "By",
  about: "About",
  export: "Export Events",
  exporting: "Exporting Events",
  saved: (saved: Saved, name: string): string =>
    saved.searchTooBroad ? `${savedHeld(saved, name)} ${TOO_BROAD_SAVED}` : savedHeld(saved, name),
} as const;
