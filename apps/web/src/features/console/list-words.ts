import { counted } from "@/shared/words.ts";

type Noun = readonly [one: string, many: string];

/** How many rows the typed words left, in the list's own noun. */
const matching = (count: number, [one, many]: Noun, search: string): string =>
  `${counted(count, one, many)} ${count === 1 ? "matches" : "match"} “${search}”.`;

const PEOPLE: Noun = ["person", "people"];

const NAMES: Noun = ["name", "names"];

const WORKSPACES: Noun = ["workspace", "workspaces"];

export const EVERYONE_WORDS = {
  heading: "Everyone",
  description:
    "Every person on the platform, the workspaces they belong to and their role in each, with the sessions and assistant access that can act as them.",
  search: "Search by name or address",
  caption:
    "Every person on the platform, with the workspaces they belong to, their role in each and their last sign-in. A person’s name opens them.",
  loading: "The people are still loading.",
  readingAgain: "Reading the list again.",
  onTheFirstPage: "This is the first page of people.",
  onTheLastPage: "This is the last page of people.",
  counted: (total: number): string => `${counted(total, ...PEOPLE)} on the platform.`,
  matching: (total: number, search: string): string => matching(total, PEOPLE, search),
  noneYet: "No one is on the platform yet.",
  noneMatch: (search: string): string => `No one matches “${search}”.`,
} as const;

const namesCounted = (count: number): string => {
  if (count === 0) return "No name waits to be corrected.";
  return count === 1 ? "1 name waits to be corrected." : `${count} names wait to be corrected.`;
};

export const NAMES_WAITING_WORDS = {
  heading: "Names waiting",
  description:
    "Display names an Admin flagged to better-answers support, the longest waiting first. Correcting a name replaces it in every workspace and takes it off this list.",
  search: "Search by name or workspace",
  caption:
    "Every display name an Admin flagged and nobody has corrected since, the longest waiting first, with the workspaces that flagged it and when. Each row’s action corrects the name.",
  loading: "The names waiting are still loading.",
  counted: namesCounted,
  matching: (count: number, search: string): string => matching(count, NAMES, search),
  noneWaiting: "Every flagged name is corrected.",
  whatWaits:
    "A name an Admin flags from their workspace’s People page waits here until you correct it.",
  noneMatch: (search: string): string => `No name matches “${search}”.`,
} as const;

export const WORKSPACES_WORDS = {
  heading: "Every workspace",
  description: "In name order. “More about” a workspace shows its id.",
  search: "Search by name or short name",
  columns: {
    workspace: "Workspace",
    shortName: "Short name",
    memberCount: "Members",
    createdAt: "Provisioned",
  },
  caption:
    "Every workspace on the platform, in name order, with its short name, how many members it has and the day it was provisioned. “More about” a workspace shows its id.",
  loading: "The workspaces are still loading.",
  counted: (count: number): string => `${counted(count, ...WORKSPACES)} on the platform.`,
  matching: (count: number, search: string): string => matching(count, WORKSPACES, search),
  noneMatch: (search: string): string => `No workspace matches “${search}”.`,
  moreAbout: (name: string): string => `More about ${name}`,
} as const;
