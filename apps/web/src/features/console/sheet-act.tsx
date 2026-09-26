import type { ReactNode, RefObject } from "react";

import { Button } from "@/shared/ui/button.tsx";

/** Held, not disabled, while the api answers: focus comes back here when its dialog closes. */
export function SheetActButton(properties: {
  readonly actRef: RefObject<HTMLButtonElement | null>;
  readonly consequenceId: string;
  readonly pending: boolean;
  readonly onAsk: () => void;
  readonly children: ReactNode;
}) {
  const { actRef, consequenceId, pending, onAsk, children } = properties;
  return (
    <Button
      ref={actRef}
      variant="outline"
      aria-describedby={consequenceId}
      aria-haspopup="dialog"
      aria-disabled={pending}
      className="h-auto min-h-8 justify-self-start text-left whitespace-normal aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onClick={() => {
        if (!pending) onAsk();
      }}
    >
      {children}
    </Button>
  );
}
