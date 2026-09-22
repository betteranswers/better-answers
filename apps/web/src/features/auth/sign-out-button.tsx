import { Button } from "@/shared/ui/button.tsx";

import { useSignOut } from "./auth-hooks.ts";

export function SignOutButton(properties: { readonly variant?: "default" | "outline" }) {
  const { signOut, signingOut } = useSignOut();

  return (
    <Button
      type="button"
      variant={properties.variant ?? "outline"}
      disabled={signingOut}
      onClick={signOut}
    >
      Sign out
    </Button>
  );
}
