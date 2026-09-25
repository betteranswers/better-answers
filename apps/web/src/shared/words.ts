const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long" });

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** The UK long form, 3 March 2026. */
export const dayWords = (iso: string): string => DAY.format(new Date(iso));

/** `Friday 25 September 2026`, with no comma, which `en-GB` would put after the weekday. */
export const weekdayWords = (iso: string): string =>
  `${WEEKDAY.format(new Date(iso))} ${dayWords(iso)}`;

/** In the reader's own time zone: `14:05`. */
export const timeWords = (iso: string): string => TIME.format(new Date(iso));

/** In the reader's own time zone: `14:05 · 25 September 2026`. */
export const instantWords = (iso: string): string => `${timeWords(iso)} · ${dayWords(iso)}`;

export const counted = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;
