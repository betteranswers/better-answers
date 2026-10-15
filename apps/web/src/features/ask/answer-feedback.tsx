import { useId, useState, type FormEvent } from "react";

import { FLAG_REASONS, type FlagReason as Reason } from "@/shared/answer-words.ts";
import { Icon } from "@/shared/icon.tsx";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover.tsx";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group.tsx";
import { Textarea } from "@/shared/ui/textarea.tsx";

import { useGiveFeedback, type FeedbackInput } from "./ask-api.ts";
import { ASK_KEYSTROKES as KEY, NOTE_MAX } from "./ask-state.ts";
import { ASK_WORDS as WORDS } from "./ask-words.ts";

/** A flag on a sentence or an `Answer` names it and the concept it rested on. */
type Disputed = { readonly sentence: string; readonly concept: string };

const { outcomeOfFailure } = refusalsOf({});

const reasonOf = (value: string): Reason | undefined =>
  FLAG_REASONS.find((reason) => reason === value);

/** Lands on the control that took the trigger's place, since the trigger is gone. */
const focusOnArrival = (control: HTMLButtonElement | null): void => {
  control?.focus();
};

/** No reason is chosen for the reader: the api takes none without one, so sending says so. */
function FlagForm(properties: { readonly onSend: (reason: Reason, note: string) => void }) {
  const id = useId();
  const [reason, setReason] = useState<Reason>();
  const [unchosen, setUnchosen] = useState(false);
  const [note, setNote] = useState("");
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (reason === undefined) {
      setUnchosen(true);
      return;
    }
    properties.onSend(reason, note.trim());
  };
  return (
    <form className="grid gap-3" onSubmit={send}>
      <fieldset className="grid gap-2">
        <legend className="mb-2 font-medium">{WORDS.reason}</legend>
        <RadioGroup
          value={reason ?? ""}
          aria-invalid={unchosen ? true : undefined}
          aria-describedby={unchosen ? `${id}-unchosen` : undefined}
          onValueChange={(value) => {
            setReason(reasonOf(value));
            setUnchosen(false);
          }}
        >
          {FLAG_REASONS.map((each) => (
            <div key={each} className="flex items-center gap-3">
              <RadioGroupItem id={`${id}-${each}`} value={each} />
              <Label htmlFor={`${id}-${each}`}>{WORDS.reasons[each]}</Label>
            </div>
          ))}
        </RadioGroup>
        {unchosen ? (
          <p id={`${id}-unchosen`} role="alert">
            {WORDS.reasonNeeded}
          </p>
        ) : null}
      </fieldset>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-note`}>{WORDS.note}</Label>
        <Textarea
          id={`${id}-note`}
          aria-describedby={`${id}-note-help`}
          maxLength={NOTE_MAX}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <p id={`${id}-note-help`} className="text-muted-foreground">
          {WORDS.noteHelp}
        </p>
      </div>
      <Button type="submit" variant="accent" className="justify-self-start">
        {WORDS.sendFlag}
      </Button>
    </form>
  );
}

type Flagging = {
  readonly recordId: string;
  /** The control's name, which names its popover too. */
  readonly name: string;
  /** The words it shows, which its name begins with; absent, it shows its glyph alone. */
  readonly label?: string;
  readonly disputed?: Disputed;
  /** Opened by the answer's own keystroke. */
  readonly keyed?: boolean;
};

function OpensOnItsKey(properties: { readonly onOpen: () => void }) {
  useKeystroke(KEY.flag, properties.onOpen);
  return null;
}

/**
 * Shown sent when pressed, and put back with the refusal if refused. Its own mutation keeps one
 * control's answer from another's callbacks.
 */
export function FlagControl(properties: Flagging) {
  const { recordId, name, label, disputed } = properties;
  const giving = useGiveFeedback();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();

  const send = (reason: Reason, note: string) => {
    if (giving.isPending) return;
    const flag: FeedbackInput = {
      recordId,
      verdict: "flag",
      reason,
      note: note === "" ? undefined : note,
      disputed,
    };
    setOpen(false);
    setSent(true);
    setOutcome(undefined);
    giving.mutate(flag, {
      onSuccess: () => {
        setOutcome({ tone: "said", words: WORDS.flagSaid });
      },
      onError: (failure) => {
        setSent(false);
        setOutcome(outcomeOfFailure(failure, "action"));
      },
    });
  };

  const size = label === undefined ? "xs" : "sm";
  return (
    <div className="inline-flex flex-col items-start gap-1">
      {sent ? (
        <Button
          ref={focusOnArrival}
          variant="ghost"
          size={size}
          aria-disabled
          className="aria-disabled:cursor-not-allowed"
        >
          <Icon name="flag" />
          {WORDS.flagged}
        </Button>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size={label === undefined ? "icon-xs" : "sm"}
              aria-label={label === name ? undefined : name}
            >
              <Icon name="flag" />
              {label}
            </Button>
          </PopoverTrigger>
          <PopoverContent aria-label={name} align="start" className="w-80 max-w-[calc(100vw-2rem)]">
            <FlagForm onSend={send} />
          </PopoverContent>
        </Popover>
      )}
      {properties.keyed === true && !sent ? (
        <OpensOnItsKey
          onOpen={() => {
            setOpen(true);
          }}
        />
      ) : null}
      <OutcomeLine outcome={outcome} />
    </div>
  );
}

/** Marked as pressed, and put back with the refusal if the api refuses it. */
export function HelpfulControl(properties: { readonly recordId: string }) {
  const giving = useGiveFeedback();
  const [sent, setSent] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const mark = () => {
    if (sent || giving.isPending) return;
    setSent(true);
    setOutcome(undefined);
    giving.mutate(
      { recordId: properties.recordId, verdict: "helpful" },
      {
        onSuccess: () => {
          setOutcome({ tone: "said", words: WORDS.helpfulSaid });
        },
        onError: (failure) => {
          setSent(false);
          setOutcome(outcomeOfFailure(failure, "action"));
        },
      },
    );
  };
  useKeystroke(KEY.helpful, mark);

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        variant="outline"
        size="sm"
        aria-disabled={sent ? true : undefined}
        className="aria-disabled:cursor-not-allowed"
        onClick={mark}
      >
        {sent ? WORDS.markedHelpful : WORDS.helpful}
      </Button>
      <OutcomeLine outcome={outcome} />
    </div>
  );
}
