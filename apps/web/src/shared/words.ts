/** Never capitalised, even at the start of a sentence. */
export const PRODUCT_NAME = "better-answers";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long" });

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

export const dayWords = (iso: string): string => DAY.format(new Date(iso));

/** `Friday 25 September 2026`, with no comma, which `en-GB` would put after the weekday. */
export const weekdayWords = (iso: string): string =>
  `${WEEKDAY.format(new Date(iso))} ${dayWords(iso)}`;

export const timeWords = (iso: string): string => TIME.format(new Date(iso));

export const instantWords = (iso: string): string => `${timeWords(iso)} · ${dayWords(iso)}`;

export const counted = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** A list a search or a filter emptied names what its button clears: the search where it has that alone. */
export const CLEAR_WORDS = { search: "Clear Search", filters: "Clear Filters" } as const;

export const nothingMatches = (typed: string): string => `No results found for “${typed}”.`;

/** Rounded up, so the reader never asks again before a ceiling lifts. */
export const minutesUntil = (seconds: number): string =>
  counted(Math.max(1, Math.ceil(seconds / 60)), "minute", "minutes");

/** A person who has given no display name yet is named by their address. */
export const nameOrAddress = (displayName: string, address: string): string =>
  displayName === "" ? address : displayName;

/** Who did an action: the kind, not the words, since a person may give any display name. */
export type DoneBy =
  | { readonly kind: "person"; readonly displayName: string }
  | { readonly kind: "former-member" }
  | { readonly kind: "platform" };

/** The glossary's words for an actor the audit log cannot name by the name they gave. */
const BY_WORDS = {
  "former-member": "a former member",
  platform: "the platform",
} as const satisfies Readonly<Record<Exclude<DoneBy["kind"], "person">, string>>;

export const byWords = (by: DoneBy): string =>
  by.kind === "person" ? by.displayName : BY_WORDS[by.kind];
