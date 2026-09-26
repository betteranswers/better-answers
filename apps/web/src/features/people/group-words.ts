import { counted } from "@/shared/words.ts";

import type { ListedGroup } from "./groups-api.ts";

export const membersWord = (group: Pick<ListedGroup, "memberCount">): string =>
  counted(group.memberCount, "member", "members");

export const consequenceOfDeleting = (group: Pick<ListedGroup, "name" | "memberCount">): string =>
  group.memberCount === 0
    ? `Deleting ${group.name} cannot be undone.`
    : `Deleting ${group.name} takes its ${membersWord(group)} out of it, and cannot be undone.`;
