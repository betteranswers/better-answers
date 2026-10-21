import type { Dispatch, SetStateAction } from "react";

import type { Outcome } from "@/shared/outcome.tsx";

export type Saying = Dispatch<SetStateAction<Outcome | undefined>>;

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

export const onTheRowInFocus =
  <Row>(inFocus: () => Row | undefined, say: Saying, selectFirst: Outcome) =>
  (act: (row: Row) => void) =>
  () => {
    const row = inFocus();
    if (row === undefined) {
      say(selectFirst);
      return;
    }
    say((said) => (said === selectFirst ? undefined : said));
    act(row);
  };
