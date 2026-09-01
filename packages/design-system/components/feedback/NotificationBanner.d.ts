import * as React from "react";

/** GOV.UK notification-banner semantics without the brand: a state of the surface a reader must know before acting. */
export interface NotificationBannerProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: "info" | "success" | "warning" | "danger";
  heading?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}
export function NotificationBanner(props: NotificationBannerProps): JSX.Element;
