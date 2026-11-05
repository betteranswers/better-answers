/** A spreadsheet runs a cell starting so as a formula; spaces before the sign do not stop it. */
const FORMULA_START = /^ *[=+\-@\t\r]/u;

const cellOf = (value: string): string => {
  const inert = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${inert.replaceAll('"', '""')}"`;
};

/** Every cell quoted and inert, every line ended CRLF. */
export const csvOf = (lines: readonly (readonly string[])[]): string =>
  lines.map((cells) => `${cells.map(cellOf).join(",")}\r\n`).join("");
