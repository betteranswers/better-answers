import { isActorId, personOfActor, type UserId } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { hasNoDisplayName } from "./display-name.ts";

/** The kind, not the words: a person may give any display name, "the platform" among them. */
export type AuditEventActor =
  | { readonly kind: "person"; readonly displayName: string }
  | { readonly kind: "former-member" }
  | { readonly kind: "platform" };

const personIn = (actor: string): UserId | undefined =>
  isActorId(actor) ? personOfActor(actor) : undefined;

/** By person id, never through the membership, so a name stands after its member leaves. */
export const namesOfActors = async (
  tx: Tx,
  actors: readonly string[],
): Promise<ReadonlyMap<string, string>> => {
  const people = new Set(actors.map(personIn));
  people.delete(undefined);
  const found = await tx.query<{ id: string; name: string }>(
    'SELECT id, name FROM "user" WHERE id = ANY($1::text[])',
    [[...people]],
  );
  return new Map(found.rows.map((row) => [row.id, row.name]));
};

export const actorOf = (actor: string, names: ReadonlyMap<string, string>): AuditEventActor => {
  const person = personIn(actor);
  if (person === undefined) return { kind: "platform" };
  const displayName = names.get(person) ?? "";
  return hasNoDisplayName(displayName)
    ? { kind: "former-member" }
    : { kind: "person", displayName };
};
