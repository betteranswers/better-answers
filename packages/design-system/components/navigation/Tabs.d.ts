import * as React from "react";

/**
 * Underlined tabs for switching a surface's view — Control Centre screens, a guide's layers.
 * @startingPoint section="Navigation" subtitle="Tabs and the side navigation" viewport="700x260"
 */
export interface TabItem {
  value: string;
  label: string;
  count?: number;
}
export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  tabs?: Array<TabItem | string>;
  value?: string;
  onChange?: (value: string) => void;
  size?: "sm" | "md";
}
export function Tabs(props: TabsProps): JSX.Element;
