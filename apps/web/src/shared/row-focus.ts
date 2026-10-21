export const keyedRow = (key: string) => ({ "data-row": key });

export const rowInFocus = <Row>(
  rows: readonly Row[],
  keyOf: (row: Row) => string,
): Row | undefined => {
  const key = document.activeElement?.closest("[data-row]")?.getAttribute("data-row");
  return rows.find((row) => keyOf(row) === key);
};
