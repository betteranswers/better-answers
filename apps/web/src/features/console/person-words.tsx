import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { instantWords, nameOrAddress } from "@/shared/words.ts";

import type { HeldGrant, ListedPerson } from "./people-api.ts";

export const nameOf = (person: ListedPerson): string =>
  nameOrAddress(person.displayName, person.email);

/** Past its expiry a grant refreshes nothing, though no act revoked it. */
export const grantStateOf = (grant: HeldGrant, nowMs: number): "Revoked" | "Expired" | "Live" => {
  if (grant.revokedAt !== null) return "Revoked";
  return Date.parse(grant.expiresAt) <= nowMs ? "Expired" : "Live";
};

export function Memberships(properties: { readonly person: ListedPerson }) {
  const { memberships } = properties.person;
  if (memberships.length === 0) {
    return <span className="text-muted-foreground">No workspace</span>;
  }
  return (
    <ul className="grid gap-1">
      {memberships.map(({ workspace, role }) => (
        <li key={workspace.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="wrap-anywhere">{workspace.name}</span> <Pill>{role}</Pill>
        </li>
      ))}
    </ul>
  );
}

export function At(properties: { readonly iso: string }) {
  return <span className="tabular-nums">{instantWords(properties.iso)}</span>;
}

/** `none` says what an instant never recorded means here. */
export function Instant(properties: { readonly at: string | null; readonly none: string }) {
  if (properties.at === null) {
    return <span className="text-muted-foreground">{properties.none}</span>;
  }
  return <At iso={properties.at} />;
}
