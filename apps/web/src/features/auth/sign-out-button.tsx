import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "@/shared/ui/button.tsx";

import { useSignOut } from "./auth-hooks.ts";

/**
 * End the session, here and on the server. The cache is cleared as well as the cookie:
 * everything in it was read as this person, in this workspace, and the next person at a
 * shared machine must not see any of it (user story 6).
 */
export function SignOutButton(properties: { readonly variant?: "default" | "outline" }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useSignOut();

  return (
    <Button
      type="button"
      variant={properties.variant ?? "outline"}
      disabled={signOut.isPending}
      onClick={() => {
        signOut.mutate(undefined, {
          // Whatever the server said, this browser is done with the session: a failure
          // here must not leave a person looking at a shell they have asked to leave.
          onSettled: () => {
            queryClient.clear();
            void navigate({ href: "/sign-in", replace: true });
          },
        });
      }}
    >
      Sign out
    </Button>
  );
}
