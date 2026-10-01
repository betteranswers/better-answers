import type { Screen } from "@/shared/navigation.ts";
import { Button } from "@/shared/ui/button.tsx";

import { GoHome } from "./go-home.tsx";
import { FAILED_SCREEN } from "./words.ts";

export function FailedScreen(properties: {
  readonly reset: () => void;
  readonly home?: Screen | undefined;
  readonly said?: string;
}) {
  return (
    <>
      {/* The heading is what happened, so the alert carries it to a screen reader too. */}
      <div role="alert">
        <h1>{FAILED_SCREEN.heading}</h1>
        <p className="mt-2 text-muted-foreground">{properties.said ?? FAILED_SCREEN.said}</p>
      </div>

      <p className="mt-6">
        <Button type="button" onClick={properties.reset}>
          {FAILED_SCREEN.retry}
        </Button>
      </p>

      <GoHome home={properties.home} className="mt-4" />
    </>
  );
}
