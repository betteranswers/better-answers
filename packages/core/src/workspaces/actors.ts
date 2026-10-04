import { isActorId, personOfActor, type UserId } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { hasNoDisplayName, notErasedAt } from "./display-name.ts";

type NamedPerson = { readonly displayName: string; readonly address: string };

/** The kind, not the words: a person may give any display name, "the platform" among them. */
export type AuditEventActor =
  | ({ readonly kind: "person" } & NamedPerson)
  | { readonly kind: "former-member" }
  | { readonly kind: "platform" };

/** Erasure keeps the person row, so an erased person is one no name is found for. */
export type PeopleNames = ReadonlyMap<string, NamedPerson>;

const personIn = (actor: string): UserId | undefined =>
  isActorId(actor) ? personOfActor(actor) : undefined;

export const peopleAmong = (actors: readonly string[]): readonly UserId[] =>
  actors.flatMap((actor) => personIn(actor) ?? []);

/** By person id, never through the membership, so a name stands after its member leaves. */
export const namesOfPeople = async (tx: Tx, personIds: readonly string[]): Promise<PeopleNames> => {
  if (personIds.length === 0) return new Map();
  const found = await tx.query<{ id: string; name: string; email: string }>(
    `SELECT id, name, email FROM "user" WHERE id = ANY($1::text[]) AND ${notErasedAt("email")}`,
    [[...new Set(personIds)]],
  );
  return new Map(
    found.rows.map((row) => [
      row.id,
      { displayName: hasNoDisplayName(row.name) ? "" : row.name, address: row.email },
    ]),
  );
};

export const namesOfActors = (tx: Tx, actors: readonly string[]): Promise<PeopleNames> =>
  namesOfPeople(tx, peopleAmong(actors));

export const personNamed = (
  personId: string,
  names: PeopleNames,
): Extract<AuditEventActor, { kind: "person" | "former-member" }> => {
  const named = names.get(personId);
  return named === undefined ? { kind: "former-member" } : { kind: "person", ...named };
};

export const actorOf = (actor: string, names: PeopleNames): AuditEventActor => {
  const person = personIn(actor);
  return person === undefined ? { kind: "platform" } : personNamed(person, names);
};
