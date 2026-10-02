import { z } from "zod";

/** Core's own check, so an address the api would take is never stopped here. */
const ADDRESS = z.email().max(254);

/**
 * Matches the api's cap for one send or one act on a set, which refuses any more as input it
 * cannot read.
 */
export const MOST_AT_ONCE = 50;

const SEPARATORS = /[,;\r\n]+/;

/** The two words the api refuses one address of a send with, keyed by its place in the send. */
export type Flag = "malformed" | "already-a-member";

/** One address the dialog holds, by the key the api mints it under. */
export type Held = { readonly key: string; readonly address: string };

/** Trimmed and lower-cased, as the api keys an invitation, so two spellings fold into one. */
const keyOf = (address: string): string => address.trim().toLowerCase();

const addressesIn = (parts: readonly string[]): readonly string[] =>
  parts.map((part) => part.trim()).filter((part) => part !== "");

type Taken = { readonly held: readonly Held[]; readonly left: readonly string[] };

const takenInto = (held: readonly Held[], addresses: readonly string[]): Taken =>
  addresses.reduce<Taken>(
    (taken, address) => {
      const key = keyOf(address);
      if (taken.held.some((one) => one.key === key)) return taken;
      if (taken.held.length >= MOST_AT_ONCE) return { ...taken, left: [...taken.left, address] };
      return { ...taken, held: [...taken.held, { key, address }] };
    },
    { held, left: [] },
  );

/** What the field holds after its text moves into the list; `capped` when the cap left some behind. */
export type Moved = {
  readonly held: readonly Held[];
  readonly field: string;
  readonly capped: boolean;
};

const movedOf = (taken: Taken, rest: readonly string[]): Moved => ({
  held: taken.held,
  field: [...taken.left, ...rest].join(", "),
  capped: taken.left.length > 0,
});

/** Every whole address moves into the list; the one still being typed stays in the field. */
export const typedInto = (held: readonly Held[], text: string): Moved => {
  const parts = text.split(SEPARATORS);
  const typing = (parts.pop() ?? "").trimStart();
  return movedOf(takenInto(held, addressesIn(parts)), typing === "" ? [] : [typing]);
};

/** Pasted, or the field sent as it stands: every address in it moves into the list. */
export const allInto = (held: readonly Held[], text: string): Moved =>
  movedOf(takenInto(held, addressesIn(text.split(SEPARATORS))), []);

export const hasSeparator = (text: string): boolean => SEPARATORS.test(text);

/** The web's own checks first, then what the api said of the address when it last refused it. */
export const flagOf = (
  one: Held,
  members: ReadonlySet<string>,
  refused: ReadonlyMap<string, Flag>,
): Flag | undefined => {
  if (!ADDRESS.safeParse(one.key).success) return "malformed";
  if (members.has(one.key)) return "already-a-member";
  return refused.get(one.key);
};

const isFlag = (word: string): word is Flag => word === "malformed" || word === "already-a-member";

/** The api names each refused address by its place in the send, which is the list's order. */
export const flagsFrom = (
  sent: readonly Held[],
  items: Readonly<Record<string, string>>,
): ReadonlyMap<string, Flag> =>
  new Map(
    Object.entries(items).flatMap(([place, word]) => {
      const one = sent[Number(place)];
      return one === undefined || !isFlag(word) ? [] : [[one.key, word] as const];
    }),
  );

export const membersOf = (addresses: readonly string[]): ReadonlySet<string> =>
  new Set(addresses.map(keyOf));
