import { Toast } from "radix-ui";

import { Button } from "@/shared/ui/button.tsx";

export type UndoNotice = {
  readonly id: number;
  readonly words: string;
  readonly undo:
    | {
        readonly label: string;
        readonly altText: string;
        readonly onUndo: () => void;
      }
    | undefined;
};

const SHOWN_FOR_MS = 10_000;

export function UndoToast(properties: {
  readonly notice: UndoNotice | undefined;
  readonly onClose: () => void;
}) {
  const { notice, onClose } = properties;
  return (
    <Toast.Provider duration={SHOWN_FOR_MS} swipeDirection="right">
      {notice === undefined ? null : (
        <Toast.Root
          key={notice.id}
          open
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
          className="flex items-center justify-between gap-4 border border-border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <Toast.Description>{notice.words}</Toast.Description>
          {notice.undo === undefined ? null : (
            <Toast.Action altText={notice.undo.altText} asChild>
              <Button variant="outline" size="sm" onClick={notice.undo.onUndo}>
                {notice.undo.label}
              </Button>
            </Toast.Action>
          )}
        </Toast.Root>
      )}
      <Toast.Viewport className="fixed inset-x-4 bottom-4 z-50 m-0 flex list-none flex-col gap-2 p-0 outline-none sm:left-auto sm:w-96" />
    </Toast.Provider>
  );
}
