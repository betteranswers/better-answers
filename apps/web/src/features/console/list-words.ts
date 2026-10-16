import { counted } from "@/shared/words.ts";

type Noun = readonly [one: string, many: string];

const matching = (count: number, [one, many]: Noun, search: string): string =>
  `${counted(count, one, many)} ${count === 1 ? "matches" : "match"} “${search}”.`;

const PEOPLE: Noun = ["person", "people"];

const NAMES: Noun = ["name", "names"];

const WORKSPACES: Noun = ["workspace", "workspaces"];

export const EVERYONE_WORDS = {
  heading: "Everyone",
  description: "See every person on the platform.",
  search: "Search by name or address",
  caption: "Every person on the platform.",
  loading: "The people are still loading.",
  readingAgain: "Updating the list.",
  onTheFirstPage: "This is the first page of people.",
  onTheLastPage: "This is the last page of people.",
  counted: (total: number): string => `${counted(total, ...PEOPLE)} on the platform.`,
  matching: (total: number, search: string): string => matching(total, PEOPLE, search),
  noneYet: "No people yet",
  noneMatch: (search: string): string => `No results found for “${search}”.`,
} as const;

const namesCounted = (count: number): string => {
  if (count === 0) return "No names are waiting to be corrected.";
  return count === 1
    ? "1 name is waiting to be corrected."
    : `${count} names are waiting to be corrected.`;
};

export const NAMES_WAITING_WORDS = {
  heading: "Names Waiting",
  description: "Review display names flagged by Admins.",
  search: "Search by name or workspace",
  caption: "Display names waiting to be corrected.",
  loading: "The names waiting are still loading.",
  counted: namesCounted,
  matching: (count: number, search: string): string => matching(count, NAMES, search),
  noneWaiting: "No names waiting",
  whatWaits: "Names flagged by Admins will appear here.",
  noneMatch: (search: string): string => `No results found for “${search}”.`,
} as const;

export const WORKSPACES_WORDS = {
  heading: "Every Workspace",
  description: "Listed in name order.",
  search: "Search by name or short name",
  columns: {
    workspace: "Workspace",
    shortName: "Short Name",
    memberCount: "Members",
    createdAt: "Provisioned",
  },
  caption: "Every workspace on the platform.",
  loading: "The workspaces are still loading.",
  counted: (count: number): string => `${counted(count, ...WORKSPACES)} on the platform.`,
  matching: (count: number, search: string): string => matching(count, WORKSPACES, search),
  noneMatch: (search: string): string => `No results found for “${search}”.`,
  moreAbout: (name: string): string => `More About ${name}`,
} as const;
