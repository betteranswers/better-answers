import { useId, useRef, useState, type RefObject } from "react";

import { useKeystroke } from "@/shared/keystrokes.tsx";
import { SelectionAction } from "@/shared/list/selection-bar.tsx";
import type { Outcome } from "@/shared/outcome.tsx";
import { ActionDialog } from "@/shared/page/action-dialog.tsx";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "@/shared/ui/native-select.tsx";

import { useOwnerChoices, useSetOwners, type Owner } from "../knowledge-api.ts";
import { ALL_KNOWLEDGE_KEYSTROKES as KEY, MOST_SELECTED } from "./curation-state.ts";
import { ALL_KNOWLEDGE_WORDS as WORDS } from "./curation-words.ts";

const { outcomeOfFailure } = refusalsOf(WORDS.refusedOnSetOwner);

const NO_ONE = "";

const NOTHING_SELECTED: Outcome = { tone: "said", words: WORDS.selectFirst };

const STILL_GOING: Outcome = { tone: "said", words: WORDS.setOwner.stillGoing };

const TOO_MANY: Outcome = { tone: "said", words: WORDS.setOwner.tooMany(MOST_SELECTED) };

const nameOf = (owner: Owner): string => (owner.name === "" ? WORDS.unnamed : owner.name);

type Selection = {
  readonly admin: boolean;
  readonly ticked: ReadonlySet<string>;
  readonly clearTicks: () => void;
  readonly heading: RefObject<HTMLElement | null>;
  readonly say: (outcome: Outcome | undefined) => void;
};

export const useSetOwner = (selection: Selection) => {
  const { admin, ticked, clearTicks, heading, say } = selection;
  const choices = useOwnerChoices(admin);
  const setOwners = useSetOwners();
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState<readonly string[]>([]);
  const [personId, setPersonId] = useState(NO_ONE);
  const opener = useRef<HTMLElement | null>(null);
  const sent = useRef(false);

  const show = () => {
    if (!admin) return;
    if (setOwners.isPending) {
      say(STILL_GOING);
      return;
    }
    if (ticked.size === 0) {
      say(NOTHING_SELECTED);
      return;
    }
    if (ticked.size > MOST_SELECTED) {
      say(TOO_MANY);
      return;
    }
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sent.current = false;
    setAsked([...ticked]);
    setPersonId(NO_ONE);
    setOpen(true);
  };

  useKeystroke(KEY.setOwner, show);

  const commit = () => {
    const chosen = choices.find((person) => person.id === personId);
    if (chosen === undefined || setOwners.isPending) return;
    const name = nameOf(chosen);
    sent.current = true;
    setOpen(false);
    say({ tone: "said", words: WORDS.setOwner.pending(name, asked.length) });
    setOwners.mutate(
      { iris: [...asked], personId: chosen.id },
      {
        onSuccess: (answer) => {
          clearTicks();
          say({ tone: "said", words: WORDS.setOwner.done(name, answer.named) });
        },
        onError: (failure) => {
          say(outcomeOfFailure(failure, "action"));
        },
      },
    );
  };

  const returnFocus = (event: Event) => {
    event.preventDefault();
    const returnTo = sent.current ? heading.current : (opener.current ?? heading.current);
    returnTo?.focus();
  };

  return {
    open,
    setOpen,
    count: asked.length,
    personId,
    choose: setPersonId,
    choices,
    acting: setOwners.isPending,
    show,
    commit,
    returnFocus,
  };
};

type SetOwner = ReturnType<typeof useSetOwner>;

export function SetOwnerAction(properties: { readonly setOwner: SetOwner }) {
  const { setOwner } = properties;
  return (
    <SelectionAction
      aria-keyshortcuts={`Shift+${KEY.setOwner.key}`}
      aria-disabled={setOwner.acting}
      className="aria-disabled:opacity-50"
      onClick={setOwner.show}
    >
      {WORDS.setOwner.action}
    </SelectionAction>
  );
}

export function SetOwnerDialog(properties: { readonly setOwner: SetOwner }) {
  const { setOwner } = properties;
  const pickerId = useId();
  return (
    <ActionDialog
      open={setOwner.open}
      onOpenChange={setOwner.setOpen}
      content={{ className: "wrap-anywhere", onCloseAutoFocus: setOwner.returnFocus }}
      title={WORDS.setOwner.title(setOwner.count)}
      consequence={WORDS.setOwner.consequence}
      commit={
        <Button disabled={setOwner.personId === NO_ONE} onClick={setOwner.commit}>
          {WORDS.setOwner.action}
        </Button>
      }
    >
      <div className="grid gap-2">
        <Label htmlFor={pickerId}>{WORDS.setOwner.newOwner}</Label>
        <NativeSelect
          id={pickerId}
          value={setOwner.personId}
          onChange={(event) => {
            setOwner.choose(event.target.value);
          }}
        >
          <NativeSelectOption value={NO_ONE}>{WORDS.setOwner.choose}</NativeSelectOption>
          {setOwner.choices.map((person) => (
            <NativeSelectOption key={person.id} value={person.id}>
              {nameOf(person)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </ActionDialog>
  );
}
