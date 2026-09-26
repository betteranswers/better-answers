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
  readonly children: ReactNode;
}) {
  const { rowButtonId, onOpen, onClose } = properties;

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
          document.getElementById(rowButtonId)?.focus();
        }}
      >
        {properties.children}
      </SheetContent>
    </Sheet>
  );
}
