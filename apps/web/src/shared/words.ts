const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** The UK long form, 3 March 2026. */
export const dayWords = (iso: string): string => DAY.format(new Date(iso));

export const counted = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;
