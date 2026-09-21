import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "@/shared/ui/button.tsx";

import { useSignOut } from "./auth-hooks.ts";

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
