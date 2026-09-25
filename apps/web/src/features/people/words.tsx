import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import type { ListedMember } from "./people-api.ts";

const LONG_UK_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

/** A member who has given no display name yet is named by their address. */
export const nameOf = (member: ListedMember): string =>
  member.displayName === "" ? member.address : member.displayName;

export function JoinedOn(properties: { readonly instant: string }) {
  return <span className="tabular-nums">{LONG_UK_DATE.format(new Date(properties.instant))}</span>;
}

export function GroupPills(properties: { readonly groups: ListedMember["groups"] }) {
  if (properties.groups.length === 0) {
    return <span className="text-muted-foreground">No group</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {properties.groups.map((group) => (
        <Pill key={group.groupId}>{group.name}</Pill>
      ))}
    </span>
  );
}
