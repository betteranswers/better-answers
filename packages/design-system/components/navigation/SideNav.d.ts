import * as React from "react";

/** The product's left rail: grouped destinations with uppercase section labels and optional trailing counts. */
export interface SideNavItem {
  value: string;
  label: string;
  icon?: React.ReactNode;
  /** Right-hand slot — usually a Badge. */
  trailing?: React.ReactNode;
}
export interface SideNavSection {
  label?: string;
  items?: SideNavItem[];
}
export interface SideNavProps extends React.HTMLAttributes<HTMLElement> {
  sections?: SideNavSection[];
  value?: string;
  onChange?: (value: string) => void;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}
export function SideNav(props: SideNavProps): JSX.Element;
