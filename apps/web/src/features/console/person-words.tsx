import { Address } from "@/shared/member/address.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { instantWords, nameOrAddress } from "@/shared/words.ts";

import type { HeldGrant, ListedPerson } from "./people-api.ts";

export const nameOf = (person: ListedPerson): string =>
  nameOrAddress(person.displayName, person.email);

export function PersonName(properties: { readonly person: ListedPerson }) {
  const { displayName, email } = properties.person;
  return displayName === "" ? <Address address={email} /> : displayName;
}

export const grantStateOf = (grant: HeldGrant, nowMs: number): "Expired" | "Live" =>
  Date.parse(grant.expiresAt) <= nowMs ? "Expired" : "Live";

export function WorkspacesAndRoles(properties: { readonly person: ListedPerson }) {
  const { workspaces } = properties.person;
  if (workspaces.length === 0) {
    return <span className="text-muted-foreground">No workspace</span>;
  }
  return (
    <ul className="grid gap-1">
      {workspaces.map(({ workspace, role }) => (
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

export function Instant(properties: { readonly at: string | null; readonly none: string }) {
  if (properties.at === null) {
    return <span className="text-muted-foreground">{properties.none}</span>;
  }
  return <At iso={properties.at} />;
}
