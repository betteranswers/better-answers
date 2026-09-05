import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode } from "react";

import { AuthProvider } from "@/shared/ui/auth/auth-provider.tsx";

import { authClient } from "./auth-client.ts";

/**
 * better-auth-ui's configuration, mounted inside the router because two of the three
 * things it needs are the router's: how to navigate, and how to render an internal link.
 * The third is the query cache — the app's own, passed in rather than left to the
 * provider's fallback, so auth queries and tRPC queries share one cache and a sign-out
 * clears what the shell read.
 *
 * As of T-046 slice 2 no library hook is called anywhere in the tree, so nothing reads
 * what this mount provides; it leaves with the dependency's records in slice 3.
 */
export function AuthConfiguration(properties: { readonly children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return (
    <AuthProvider
      authClient={authClient}
      queryClient={queryClient}
      navigate={({ to, replace }) => {
        void navigate({ href: to, replace: replace ?? false });
      }}
      Link={({ href, ...rest }) => <Link href={href} {...rest} />}
    >
      {properties.children}
    </AuthProvider>
  );
}
