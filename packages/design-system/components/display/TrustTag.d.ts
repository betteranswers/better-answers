import * as React from "react";

/**
 * The trust word a reader sees on a concept, hit, section or answer. The word set is
 * closed (CONTEXT.md, "Trust words the reader sees"); never invent one, never rely on
 * colour to carry it.
 */
export type TrustState =
  | "checked"
  | "checked-by-platform"
  | "unchecked"
  | "changed-since-checked"
  | "out-of-date"
  | "draft"
  | "restricted"
  | "left"
  | "deprecated";

export interface TrustTagProps extends React.HTMLAttributes<HTMLSpanElement> {
  state?: TrustState;
  /** Person's name — renders "Checked by Priya Shah". `checked` only. */
  by?: string;
  /** UK long-form date: "3 March 2026". */
  at?: string;
  /** One of exactly two riders: "imported" or "source moved on". */
  rider?: "imported" | "source moved on";
  size?: "sm" | "md";
}
export function TrustTag(props: TrustTagProps): JSX.Element;
