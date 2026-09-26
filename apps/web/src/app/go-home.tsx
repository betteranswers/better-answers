import { Link, useRouterState } from "@tanstack/react-router";

import { useRole } from "@/features/auth/membership.ts";
import { screenAt, type Role, type Screen, type Surface } from "@/shared/screens.ts";

import { goHome } from "./words.ts";

/** The way to the reader's own home, or nothing where they are on it already. */
export function GoHome(properties: { readonly surface: Surface; readonly className: string }) {
  const { surface, className } = properties;

  return "home" in surface ? (
    <HomeLink surface={surface} home={surface.home} className={className} />
  ) : (
    <RoleHomeLink surface={surface} homes={surface.homes} className={className} />
  );
}

/** Asked only here, so the console never reads a membership its reader need not hold. */
function RoleHomeLink(properties: {
  readonly surface: Surface;
  readonly homes: { readonly [held in Role]: Screen };
  readonly className: string;
}) {
  const role = useRole();

  return (
    <HomeLink
      surface={properties.surface}
      home={role === undefined ? undefined : properties.homes[role]}
      className={properties.className}
    />
  );
}

/** The index finds the home of a reader whose role is not known yet. */
function HomeLink(properties: {
  readonly surface: Surface;
  readonly home: Screen | undefined;
  readonly className: string;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { home } = properties;
  if (home !== undefined && screenAt(properties.surface, pathname) === home) return null;

  return (
    <p className={properties.className}>
      <Link to={home?.path ?? "/"} className="text-brand underline">
        {goHome(home)}
      </Link>
    </p>
  );
}
