import type { FocusEventHandler } from "react";

type RowFocus = {
  readonly onFocus?: FocusEventHandler;
  readonly onBlur?: FocusEventHandler;
};

export const rowFocusOf = <Row>(
  onRowFocus: ((row: Row | undefined) => void) | undefined,
  row: Row,
): RowFocus =>
  onRowFocus === undefined
    ? {}
    : {
        onFocus: () => {
          onRowFocus(row);
        },
        onBlur: (event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) onRowFocus(undefined);
        },
      };
