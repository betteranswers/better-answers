import { Button } from "@/shared/ui/button.tsx";

import { useSignOut } from "./auth-hooks.ts";
import { Outcome } from "./auth-page.tsx";
import { saidOfASignOutRefused } from "./refusal-words.ts";

export function SignOutRefused(properties: { readonly failure: Error | null }) {
  return properties.failure === null ? null : (
    <Outcome tone="refused" className="order-last basis-full">
      {saidOfASignOutRefused(properties.failure)}
    </Outcome>
  );
}

export function SignOutButton(properties: { readonly variant?: "default" | "outline" }) {
  const { signOut, signingOut, failure } = useSignOut();

  return (
    <>
      <Button
        type="button"
        variant={properties.variant ?? "outline"}
        className="aria-disabled:opacity-50"
        aria-disabled={signingOut}
        onClick={signOut}
      >
        Sign Out
      </Button>
      <SignOutRefused failure={failure} />
    </>
  );
}
