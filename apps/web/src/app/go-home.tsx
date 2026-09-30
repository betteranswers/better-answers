import { Link, useRouterState } from "@tanstack/react-router";

import { useRole } from "@/features/auth/membership.ts";
import { HOMES, type Screen } from "@/shared/navigation.ts";

import { goHome } from "./words.ts";

/** The way to the reader's own home, or nothing where they are on it already. */
export function GoHome(properties: {
  readonly home?: Screen | undefined;
  readonly className: string;
}) {
  const { home, className } = properties;

  return home === undefined ? (
    <RoleHomeLink className={className} />
  ) : (
    <HomeLink home={home} className={className} />
  );
}

/** Asked only here, so the console never reads a membership its reader need not hold. */
function RoleHomeLink(properties: { readonly className: string }) {
  const role = useRole();

  return (
    <HomeLink
      home={role === undefined ? undefined : HOMES[role]}
      className={properties.className}
    />
  );
}

/** The index finds the home of a reader whose role is not known yet. */
function HomeLink(properties: { readonly home: Screen | undefined; readonly className: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const to = properties.home?.path ?? "/";
  if (pathname === to) return null;

  return (
    <p className={properties.className}>
      <Link to={to} className="text-brand underline">
        {goHome(properties.home)}
      </Link>
    </p>
  );
}
