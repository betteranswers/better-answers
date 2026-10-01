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

export const peopleAmong = (actors: readonly string[]): readonly UserId[] =>
  actors.flatMap((actor) => personIn(actor) ?? []);

/** By person id, never through the membership, so a name stands after its member leaves. */
export const namesOfPeople = async (
  tx: Tx,
  personIds: readonly string[],
): Promise<ReadonlyMap<string, string>> => {
  if (personIds.length === 0) return new Map();
  const found = await tx.query<{ id: string; name: string }>(
    'SELECT id, name FROM "user" WHERE id = ANY($1::text[])',
    [[...new Set(personIds)]],
  );
  return new Map(found.rows.map((row) => [row.id, row.name]));
};

export const namesOfActors = (
  tx: Tx,
  actors: readonly string[],
): Promise<ReadonlyMap<string, string>> => namesOfPeople(tx, peopleAmong(actors));

export const actorOf = (actor: string, names: ReadonlyMap<string, string>): AuditEventActor => {
  const person = personIn(actor);
  if (person === undefined) return { kind: "platform" };
  const displayName = names.get(person) ?? "";
  return hasNoDisplayName(displayName)
    ? { kind: "former-member" }
    : { kind: "person", displayName };
};
