import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { instantWords, nameOrAddress } from "@/shared/words.ts";

import type { ListedMember } from "./people-api.ts";

const LONG_UK_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

/** Said beside every People act before it is taken, since each writes an audit event. */
export const RECORDED = "Recorded on the audit log under your name.";

export const nameOf = (member: ListedMember): string =>
  nameOrAddress(member.displayName, member.address);

export function JoinedOn(properties: { readonly instant: string }) {
  return <span className="tabular-nums">{LONG_UK_DATE.format(new Date(properties.instant))}</span>;
}

export function CredentialsHere(properties: { readonly revokedAt: string | null }) {
  const { revokedAt } = properties;
  if (revokedAt === null) {
    return <span className="text-muted-foreground">Never revoked</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Pill>Revoked</Pill>
      <span className="tabular-nums">{instantWords(revokedAt)}</span>
    </span>
  );
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
