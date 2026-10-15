import { useId, useRef, useState, type FormEvent } from "react";

import { useKeystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { groupButtonId } from "./group-sheet.tsx";
import { GROUP_WORDS } from "./group-words.ts";
import { useCreateGroup } from "./groups-api.ts";
import { GROUPS_KEYSTROKES } from "./people-state.ts";
import { outcomeOfGroupFailure } from "./refusal.tsx";

const CREATE_KEYSTROKE = GROUPS_KEYSTROKES.create;

/** The page's primary act: the list's head holds it, and its dialog holds the name it asks for. */
export function CreateGroupAction(properties: {
  readonly onCreated: (groupId: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // A refusal keeps the dialog open, so its line is the dialog's, where the reader is.
  const [refused, setRefused] = useState<Outcome>();
  const createGroup = useCreateGroup();
  const fieldRef = useRef<HTMLInputElement>(null);
  // The group a create made, so the closing dialog hands focus to the row it made.
  const created = useRef<string | undefined>(undefined);
  const ids = { field: useId() };

  const show = () => {
    setOpen(true);
  };
  useKeystroke(CREATE_KEYSTROKE, show);

  // Never disabled: the field keeps the name and focus while the answer comes back.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const asked = new FormData(form).get("name");
    if (typeof asked !== "string") return;
    const name = asked.trim();
    setRefused(undefined);
    void createGroup.mutateAsync({ name }).then(
      ({ groupId }) => {
        created.current = groupId;
        form.reset();
        setOpen(false);
        properties.onCreated(groupId, name);
      },
      (failure: Error) => {
        setRefused(outcomeOfGroupFailure(failure, "action"));
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(opened) => {
        setOpen(opened);
        if (!opened) return;
        created.current = undefined;
        setRefused(undefined);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" aria-keyshortcuts={CREATE_KEYSTROKE.key}>
          {CREATE_KEYSTROKE.action}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="wrap-anywhere"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          fieldRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (created.current === undefined) return;
          event.preventDefault();
          document.getElementById(groupButtonId(created.current))?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{CREATE_KEYSTROKE.action}</DialogTitle>
          <DialogDescription>{GROUP_WORDS.create.consequence}</DialogDescription>
        </DialogHeader>
        <OutcomeLine outcome={refused} className="text-sm" />
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor={ids.field}>New Group Name</Label>
            <Input
              ref={fieldRef}
              id={ids.field}
              name="name"
              required
              autoComplete="off"
              aria-keyshortcuts={CREATE_KEYSTROKE.key}
            />
          </div>
          <Button type="submit" className="justify-self-start">
            Create Group
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
