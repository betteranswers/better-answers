import { Link, useRouterState } from "@tanstack/react-router";

import { useRole } from "@/shared/member.ts";
import { HOMES, type Page } from "@/shared/navigation.ts";
import { Button } from "@/shared/ui/button.tsx";

import { goHome } from "./words.ts";

export function GoHome(properties: {
  readonly home?: Page | undefined;
  readonly className: string;
}) {
  const { home, className } = properties;

  return home === undefined ? (
    <RoleHomeLink className={className} />
  ) : (
    <HomeLink home={home} className={className} />
  );
}

function RoleHomeLink(properties: { readonly className: string }) {
  const role = useRole();

  return (
    <HomeLink
      home={role === undefined ? undefined : HOMES[role]}
      className={properties.className}
    />
  );
}

function HomeLink(properties: { readonly home: Page | undefined; readonly className: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const to = properties.home?.path ?? "/";
  if (pathname === to) return null;

  return (
    <p className={properties.className}>
      <Button asChild variant="link" className="px-0">
        <Link to={to}>{goHome(properties.home)}</Link>
      </Button>
    </p>
  );
}
