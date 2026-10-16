import type { ComponentProps } from "react";

import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog.tsx";

import { consequenceOfDeleting } from "./group-words.ts";
import { type ListedGroup } from "./groups-api.ts";

export function DeleteGroupWarning(properties: {
  readonly group: ListedGroup;
  readonly onDelete: (group: ListedGroup) => void;
  readonly onCloseAutoFocus?:
    | ComponentProps<typeof AlertDialogContent>["onCloseAutoFocus"]
    | undefined;
}) {
  const { group } = properties;
  const consequence = consequenceOfDeleting(group);

  return (
    <AlertDialogContent onCloseAutoFocus={properties.onCloseAutoFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {group.name}</AlertDialogTitle>
        <AlertDialogDescription>{consequence}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep Group</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          onClick={() => {
            properties.onDelete(group);
          }}
        >
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
