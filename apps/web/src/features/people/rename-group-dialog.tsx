import { useId, useState, type SubmitEvent } from "react";

import { MountedActionDialog } from "@/shared/action-dialog.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { GROUP_WORDS } from "./group-words.ts";
import { useRenameGroup, type ListedGroup } from "./groups-api.ts";
import { submitRename } from "./rename-group-form.ts";

export function RenameGroupDialog(properties: {
  readonly group: ListedGroup;
  readonly onRenamed: (outcome: Outcome) => void;
  readonly onClose: () => void;
  readonly onFocusBack: () => void;
}) {
  const { group } = properties;
  const renameGroup = useRenameGroup();
  const formId = useId();
  const ids = { field: useId() };
  const [line, setLine] = useState<Outcome>();

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLine(undefined);
    submitRename({
      group,
      form: event.currentTarget,
      renameGroup,
      say: setLine,
      sent: (outcome) => {
        properties.onRenamed(outcome);
        properties.onClose();
      },
    });
  };

  return (
    <MountedActionDialog
      title={`Rename ${group.name}`}
      consequence={GROUP_WORDS.rename.consequence}
      onClose={properties.onClose}
      onFocusBack={properties.onFocusBack}
      commit={
        <Button type="submit" form={formId}>
          Rename Group
        </Button>
      }
    >
      <OutcomeLine outcome={line} className="text-sm" />
      <form id={formId} onSubmit={submit} className="grid gap-2">
        <Label htmlFor={ids.field}>Name</Label>
        <Input id={ids.field} name="name" defaultValue={group.name} required autoComplete="off" />
      </form>
    </MountedActionDialog>
  );
}
