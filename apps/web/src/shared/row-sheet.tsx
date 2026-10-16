import type { ComponentProps, ReactNode } from "react";

import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Sheet, SheetContent } from "@/shared/ui/sheet.tsx";

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

export function RowSheet(properties: {
  readonly rowButtonId: string;
  readonly onOpen: () => void;
  readonly onClose: () => void;

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
