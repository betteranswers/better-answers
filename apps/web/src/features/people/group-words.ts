import { counted } from "@/shared/words.ts";

import type { ListedGroup } from "./groups-api.ts";

export const membersWord = (group: Pick<ListedGroup, "memberCount">): string =>
  counted(group.memberCount, "member", "members");

export const GROUP_WORDS = {
  create: {
    consequence: "A group only changes what its members may see, never what they may do.",
  },
  rename: {
    consequence: "This will change the group’s name. Members stay in the group.",
  },
  created: (name: string): string => `${name} has been created successfully.`,
  renamed: (was: string, name: string): string =>
    `${was} has been renamed to ${name} successfully.`,
  deleted: (name: string): string => `${name} has been deleted successfully.`,
} as const;

export const consequenceOfDeleting = (group: Pick<ListedGroup, "name" | "memberCount">): string =>
  group.memberCount === 0
    ? `This will permanently delete ${group.name}. This action cannot be undone.`
    : `This will permanently delete ${group.name} and remove its ${membersWord(group)} from it. This action cannot be undone.`;
