/** A comparator-less sort's order for strings; `localeCompare` would reorder case and accents. */
export const byCodeUnit = (one: string, other: string): number =>
  Number(one > other) - Number(one < other);
