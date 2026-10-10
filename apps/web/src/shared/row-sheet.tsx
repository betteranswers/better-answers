import type { ComponentProps, ReactNode } from "react";

import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Sheet, SheetContent } from "@/shared/ui/sheet.tsx";

/** The row's own name, with a caret at rest: a name alone does not say that the row opens. */
export function RowSheetButton(
  properties: Omit<ComponentProps<typeof Button>, "variant" | "aria-haspopup">,
) {
  const { className, children, ...button } = properties;
  return (
    <Button
      {...button}
      variant="link"
      aria-haspopup="dialog"
      className={cn(
        "h-auto gap-1 p-0 text-left font-medium whitespace-normal text-foreground",
        className,
      )}
    >
      {children}
      <Icon name="caret-right" className="text-muted-foreground" />
    </Button>
  );
}

/**
 * A row's detail over its list. No Radix trigger opened it, so closing hands focus back to the
 * row's own button.
 */
export function RowSheet(properties: {
  readonly rowButtonId: string;
  /** Puts focus where the opener asked, in place of Radix's first control. */
  readonly onOpen: () => void;
  readonly onClose: () => void;

  /** For an action that takes the row away with it, so the list says where focus lands instead. */
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
