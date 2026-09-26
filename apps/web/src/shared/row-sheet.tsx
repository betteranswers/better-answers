import type { ReactNode } from "react";

import { Sheet, SheetContent } from "@/shared/ui/sheet.tsx";

/**
 * A row's detail over its list. No Radix trigger opened it, so closing hands focus back to the
 * row's own button.
 */
export function RowSheet(properties: {
  readonly rowButtonId: string;
  /** Puts focus where the opener asked, in place of Radix's first control. */
  readonly onOpen: () => void;
  readonly onClose: () => void;

  /** For an act that takes the row away with it, so the list says where focus lands instead. */
  readonly returnFocus?: () => void;
  readonly children: ReactNode;
}) {
  const { rowButtonId, onOpen, onClose, returnFocus } = properties;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="overflow-y-auto sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          onOpen();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus === undefined) document.getElementById(rowButtonId)?.focus();
          else returnFocus();
        }}
      >
        {properties.children}
      </SheetContent>
    </Sheet>
  );
}
