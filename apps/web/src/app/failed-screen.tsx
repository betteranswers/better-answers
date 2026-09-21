import { Link } from "@tanstack/react-router";

import { Button } from "@/shared/ui/button.tsx";

export function FailedScreen(properties: { readonly reset: () => void }) {
  return (
    <>
      <h1>This screen could not be shown</h1>
      <p role="alert" className="mt-2 text-muted-foreground">
        Something in it failed while it was being drawn. The rest of Control Centre is still here,
        and the other screens can be read as usual.
      </p>

      <p className="mt-6">
        <Button type="button" onClick={properties.reset}>
          Try this screen again
        </Button>
      </p>

      <p className="mt-4">
        <Link to="/system" className="text-brand underline">
          Go to System
        </Link>
      </p>
    </>
  );
}
