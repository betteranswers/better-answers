export const keyedRow = (key: string) => ({ "data-row": key });

export const rowInFocus = <Row>(
  rows: readonly Row[],
  keyOf: (row: Row) => string,
): Row | undefined => {
  let keyed = document.activeElement?.closest("[data-row]");
  while (keyed) {
    const key = keyed.getAttribute("data-row");
    const row = rows.find((each) => keyOf(each) === key);
    if (row !== undefined) return row;
    keyed = keyed.parentElement?.closest("[data-row]");
  }
  return undefined;
};
