/**
 * Orders strings as `sort()` with no comparator does. `localeCompare` would reorder case and
 * accents.
 */
export const byCodeUnit = (one: string, other: string): number =>
  Number(one > other) - Number(one < other);
