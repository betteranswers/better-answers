import { useId, useState, type FormEvent } from "react";

import { useKeystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { invitedOutcome } from "./invitation-words.ts";
import { useInvite, type SentInvitation } from "./invitations-api.ts";
import { PEOPLE_KEYSTROKES } from "./people-state.ts";
import { outcomeOfInvitationFailure } from "./refusal.tsx";
import { ROLE_OFFERED_FIRST, RoleChoice } from "./role-choice.tsx";

type Role = SentInvitation["role"];

/** The keystroke list names the act as the button does, so inviting has one name. */
const ACT_NAME = PEOPLE_KEYSTROKES.invite.act;

export function InviteAct() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>(ROLE_OFFERED_FIRST);
  const [outcome, setOutcome] = useState<Outcome>();
  const [sent, setSent] = useState<SentInvitation>();
  const invite = useInvite();
  const ids = { form: useId(), address: useId() };

  const again = () => {
    setOutcome(undefined);
    setSent(undefined);
    setRole(ROLE_OFFERED_FIRST);
  };
  const show = () => {
    again();
    setOpen(true);
  };
  useKeystroke(PEOPLE_KEYSTROKES.invite, show);

  // Never disabled while sending: a disabled button drops focus, and a refusal would land nowhere.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = new FormData(event.currentTarget).get("address");
    if (typeof address !== "string" || invite.isPending) return;
    setOutcome(undefined);
    invite.mutate(
      { address: address.trim(), role },
      {
        onSuccess: (invited) => {
          setSent(invited);
          setOutcome(invitedOutcome(invited));
        },
        onError: (failure) => {
          setOutcome(outcomeOfInvitationFailure(failure));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* The trigger is where a closed dialog hands focus back, however it was opened. */}
      <DialogTrigger asChild>
        <Button size="sm" aria-keyshortcuts={PEOPLE_KEYSTROKES.invite.key} onClick={again}>
          {ACT_NAME}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ACT_NAME}</DialogTitle>
          <DialogDescription>
            They get an email with a link to join. The link lasts seven days, and inviting them
            again replaces it.
          </DialogDescription>
        </DialogHeader>

        <OutcomeLine outcome={outcome} className="text-sm" />

        {sent === undefined ? (
          <form id={ids.form} onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor={ids.address}>Email address</Label>
              <Input
                id={ids.address}
                name="address"
                type="email"
                required
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <RoleChoice role={role} onChoose={setRole} />
          </form>
        ) : null}

        <DialogFooter>
          {sent === undefined ? (
            <>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" form={ids.form}>
                {invite.isPending ? "Sending the invitation" : "Send the invitation"}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={again}>
                {ACT_NAME}
              </Button>
              <DialogClose asChild>
                {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- the control that had focus is gone, and this is where the act leaves the reader */}
                <Button type="button" autoFocus>
                  Done
                </Button>
              </DialogClose>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
