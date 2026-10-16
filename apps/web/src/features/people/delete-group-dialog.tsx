import { AlertDialog } from "@/shared/ui/alert-dialog.tsx";

import { DeleteGroupWarning } from "./delete-group-warning.tsx";
import { type ListedGroup } from "./groups-api.ts";

export function DeleteGroupDialog(properties: {
  readonly group: ListedGroup;
  readonly onDelete: (group: ListedGroup) => void;
  readonly onClose: () => void;

  /** A deletion takes the row away, so the list decides where focus lands once it has. */
  readonly onFocusBack: () => void;
}) {
  const { group } = properties;

  return (
    <AlertDialog
      open
      onOpenChange={(opened) => {
        if (!opened) properties.onClose();
      }}
    >
      <DeleteGroupWarning
        group={group}
        onDelete={properties.onDelete}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          properties.onFocusBack();
        }}
      />
    </AlertDialog>
  );
}
