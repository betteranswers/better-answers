import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { dayWords, instantWords, nameOrAddress } from "@/shared/words.ts";

import type { ListedMember } from "./people-api.ts";

export const RECORDED = "Recorded on the audit log under your name.";

export const nameOf = (member: ListedMember): string =>
  nameOrAddress(member.displayName, member.address);

export function JoinedOn(properties: { readonly instant: string }) {
  return <span className="tabular-nums">{dayWords(properties.instant)}</span>;
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
