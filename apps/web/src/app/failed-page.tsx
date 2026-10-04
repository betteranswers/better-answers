import type { Page } from "@/shared/navigation.ts";
import { Button } from "@/shared/ui/button.tsx";

import { GoHome } from "./go-home.tsx";
import { FAILED_PAGE } from "./words.ts";

export function FailedPage(properties: {
  readonly reset: () => void;
  readonly home?: Page | undefined;
  readonly said?: string;
}) {
  return (
    <>
      {/* The heading is what happened, so the alert carries it to a screen reader too. */}
      <div role="alert">
        <h1>{FAILED_PAGE.heading}</h1>
        <p className="mt-2 text-muted-foreground">{properties.said ?? FAILED_PAGE.said}</p>
      </div>

      <p className="mt-6">
        <Button type="button" onClick={properties.reset}>
          {FAILED_PAGE.retry}
        </Button>
      </p>

      <GoHome home={properties.home} className="mt-4" />
    </>
  );
}
