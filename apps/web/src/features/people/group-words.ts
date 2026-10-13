import { counted } from "@/shared/words.ts";

import type { ListedGroup } from "./groups-api.ts";

export const membersWord = (group: Pick<ListedGroup, "memberCount">): string =>
  counted(group.memberCount, "member", "members");

export const consequenceOfDeleting = (group: Pick<ListedGroup, "name" | "memberCount">): string =>
  group.memberCount === 0
    ? `This will permanently delete ${group.name}. This action cannot be undone.`
    : `This will permanently delete ${group.name} and remove its ${membersWord(group)} from it. This action cannot be undone.`;
