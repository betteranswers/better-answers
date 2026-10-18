import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/shared/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog.tsx";

type Content = Pick<ComponentProps<typeof DialogContent>, "className" | "onCloseAutoFocus">;

export function ActionDialog(properties: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly consequence: ReactNode;
  readonly commit: ReactNode;
  readonly children?: ReactNode;
  readonly content?: Content;
}) {
  return (
    <Dialog open={properties.open} onOpenChange={properties.onOpenChange}>
      <DialogContent {...properties.content}>
        <DialogHeader>
          <DialogTitle>{properties.title}</DialogTitle>
          <DialogDescription>{properties.consequence}</DialogDescription>
        </DialogHeader>
        {properties.children}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          {properties.commit}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Parts = Pick<
  ComponentProps<typeof ActionDialog>,
  "title" | "consequence" | "commit" | "children"
>;

export function MountedActionDialog(
  properties: Parts & { readonly onClose: () => void; readonly onFocusBack: () => void },
) {
  const { onClose, onFocusBack, ...parts } = properties;
  return (
    <ActionDialog
      {...parts}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      content={{
        className: "wrap-anywhere",
        onCloseAutoFocus: (event) => {
          event.preventDefault();
          onFocusBack();
        },
      }}
    />
  );
}
