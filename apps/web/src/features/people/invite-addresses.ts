import { EMAIL_ADDRESS } from "@better-answers/schema/email-address";

export const MOST_AT_ONCE = 50;

const SEPARATORS = /[,;\r\n]+/;

export type Flag = "malformed" | "already-a-member";

export type Held = { readonly key: string; readonly address: string };

const keyOf = (address: string): string => address.trim().toLowerCase();

const addressesIn = (parts: readonly string[]): readonly string[] =>
  parts.map((part) => part.trim()).filter((part) => part !== "");

type Taken = { readonly held: readonly Held[]; readonly left: readonly string[] };

const takenInto = (held: readonly Held[], addresses: readonly string[]): Taken => {
  const added: Held[] = [];
  const left: string[] = [];
  for (const address of addresses) {
    const key = keyOf(address);
    if (held.some((one) => one.key === key) || added.some((one) => one.key === key)) continue;
    if (held.length + added.length >= MOST_AT_ONCE) left.push(address);
    else added.push({ key, address });
  }
  return { held: added.length === 0 ? held : [...held, ...added], left };
};

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

export const typedInto = (held: readonly Held[], text: string): Moved => {
  const parts = text.split(SEPARATORS);
  const typing = (parts.pop() ?? "").trimStart();
  return movedOf(takenInto(held, addressesIn(parts)), typing === "" ? [] : [typing]);
};

export const allInto = (held: readonly Held[], text: string): Moved =>
  movedOf(takenInto(held, addressesIn(text.split(SEPARATORS))), []);

export const hasSeparator = (text: string): boolean => SEPARATORS.test(text);

export const addressesCounted = (text: string): number =>
  new Set(addressesIn(text.split(SEPARATORS)).map(keyOf)).size;

export const flagOf = (
  one: Held,
  members: ReadonlySet<string>,
  refused: ReadonlyMap<string, Flag>,
): Flag | undefined => {
  if (!EMAIL_ADDRESS.safeParse(one.key).success) return "malformed";
  if (members.has(one.key)) return "already-a-member";
  return refused.get(one.key);
};

const isFlag = (word: string): word is Flag => word === "malformed" || word === "already-a-member";

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
