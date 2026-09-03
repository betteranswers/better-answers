import { organizationPlugin } from "@better-auth-ui/core/plugins/organization";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";

import { AuthProvider } from "@/shared/ui/auth/auth-provider.tsx";

import { authClient } from "./auth-client.ts";
import { WORKSPACE_WORDS } from "./workspace-words.ts";

/**
 * better-auth-ui's configuration, mounted inside the router because two of the three
 * things it needs are the router's: how to navigate, and how to render an internal link.
 * The third is the query cache — the app's own, passed in rather than left to the
 * provider's fallback, so auth queries and tRPC queries share one cache and a sign-out
 * clears what the shell read.
 *
 * The `localization` is where the library's *organization* becomes the platform's
 * *workspace*: it is read by the screens below through `useAuth()`, so the four words
 * are stated once and a screen cannot quietly say a fifth.
 */
export function AuthConfiguration(properties: { readonly children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // The plugin object is rebuilt only when the words change, and they are a module
  // constant: a new object per render would reset the provider's own memo every time.
  const plugins = useMemo(
    () => [
      organizationPlugin({
        localization: WORKSPACE_WORDS,
        // A workspace's slug is the platform's, never shown and never typed.
        hideSlug: true,
        slug: null,
      }),
    ],
    [],
  );

  return (
    <AuthProvider
      authClient={authClient}
      queryClient={queryClient}
      plugins={plugins}
      navigate={({ to, replace }) => {
        void navigate({ href: to, replace: replace ?? false });
      }}
      Link={({ href, ...rest }) => <Link href={href} {...rest} />}
    >
      {properties.children}
    </AuthProvider>
  );
}
