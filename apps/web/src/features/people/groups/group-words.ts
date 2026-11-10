import { counted } from "@/shared/words.ts";

import type { ListedGroup } from "../groups-api.ts";

export const membersWord = (group: Pick<ListedGroup, "memberCount">): string =>
  counted(group.memberCount, "member", "members");

export const GROUP_WORDS = {
  create: {
    consequence: "Name the group, then add its members.",
    field: "Name",
    commit: "Create group",
  },
  rename: {
    commit: "Rename group",
  },
  delete: "Delete group",
  keep: "Keep group",
  created: (name: string): string => `${name} created.`,
  renamed: (was: string, name: string): string => `${was} renamed to ${name}.`,
  deleted: (name: string): string => `${name} deleted.`,
  added: (person: string, group: string): string => `${person} added to ${group}.`,
  removed: (person: string, group: string): string => `${person} removed from ${group}.`,
} as const;

export const consequenceOfDeleting = (group: Pick<ListedGroup, "name" | "memberCount">): string =>
  group.memberCount === 0
    ? `This permanently deletes ${group.name}.`
    : `This permanently deletes ${group.name} and removes its ${membersWord(group)} from it.`;
