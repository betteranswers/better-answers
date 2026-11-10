import { CONSOLE, menuGroupIn, pageById } from "@/shared/navigation.ts";
import { counted } from "@/shared/words.ts";

type Noun = readonly [one: string, many: string];

const matching = (count: number, [one, many]: Noun, search: string): string =>
  `${counted(count, one, many)} ${count === 1 ? "matches" : "match"} “${search}”.`;

const PEOPLE: Noun = ["person", "people"];

const NAMES: Noun = ["name", "names"];

const WORKSPACES: Noun = ["workspace", "workspaces"];

const PERSON = "Person";

const PEOPLE_PAGES = menuGroupIn(CONSOLE, "people");

export const EVERYONE_WORDS = {
  heading: pageById(PEOPLE_PAGES, "everyone").name,
  columns: {
    person: PERSON,
    workspacesAndRoles: "Workspaces and roles",
    lastSignIn: "Last sign-in",
  },
  never: "Never",
  search: "Search by name or address",
  caption: "Every person on the platform.",
  loading: "Loading people…",
  readingAgain: "Updating the list.",
  onTheFirstPage: "You’re already on the first page.",
  onTheLastPage: "You’re already on the last page.",
  counted: (total: number): string => `${counted(total, ...PEOPLE)} on the platform.`,
  matching: (total: number, search: string): string => matching(total, PEOPLE, search),
  noneYet: "No people yet",
  noneMatch: (search: string): string => `No results found for “${search}”.`,
} as const;

const namesCounted = (count: number): string =>
  count === 0 ? "" : `${counted(count, ...NAMES)} waiting to be corrected.`;

export const NAMES_WAITING_WORDS = {
  heading: pageById(PEOPLE_PAGES, "flagged-names").name,
  columns: { person: PERSON, flaggedBy: "Flagged by", actions: "Actions" },
  search: "Search by name or workspace",
  caption: "Display names waiting to be corrected.",
  loading: "Loading names…",
  counted: namesCounted,
  matching: (count: number, search: string): string => matching(count, NAMES, search),
  noneWaiting: "No names waiting",
  whatWaits: "Names flagged by Admins will appear here.",
  noneMatch: (search: string): string => `No results found for “${search}”.`,
} as const;

export const WORKSPACES_WORDS = {
  heading: pageById(menuGroupIn(CONSOLE, "workspaces"), "every-workspace").name,
  search: "Search by name or short name",
  columns: {
    workspace: "Workspace",
    shortName: "Short name",
    memberCount: "Members",
    createdAt: "Created",
  },
  caption: "Every workspace on the platform.",
  loading: "Loading workspaces…",
  counted: (count: number): string => `${counted(count, ...WORKSPACES)} on the platform.`,
  matching: (count: number, search: string): string => matching(count, WORKSPACES, search),
  noneMatch: (search: string): string => `No results found for “${search}”.`,
  moreAbout: (name: string): string => `More about ${name}`,
} as const;
