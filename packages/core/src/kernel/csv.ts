/**
 * A spreadsheet runs a cell that starts with one of these characters as a formula, even after
 * leading spaces.
 */
const FORMULA_START = /^ *[=+\-@\t\r]/u;

const cellOf = (value: string): string => {
  const inert = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${inert.replaceAll('"', '""')}"`;
};

export const csvOf = (lines: readonly (readonly string[])[]): string =>
  lines.map((cells) => `${cells.map(cellOf).join(",")}\r\n`).join("");
