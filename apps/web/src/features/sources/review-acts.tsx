import { useId, useState, type FormEvent, type ReactNode } from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { ActDialog } from "./act-dialog.tsx";
import { outcomeOfFailure } from "./refusal.tsx";
import {
  groupKeyText,
  keyOf,
  NARROWEST,
  useKeepInText,
  useNarrowDocuments,
  type DocumentsNarrowed,
  type FindingGroup,
} from "./sources-api.ts";
import { SOURCES_KEYSTROKES, useTickedGroups, type TickedGroups } from "./sources-state.ts";
import { counted, spokenWord } from "./words.ts";

type Settled<Answer> = {
  readonly onSuccess: (answer: Answer) => void;
  readonly onError: (failure: Error | ApiError) => void;
};

// Inert until this binding's review has ticked a group: an act over nothing is disabled and reads
// as such.
const useBulkAct = (bindingId: string) => {
  const [ticked, tick] = useTickedGroups();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const ready = ticked?.bindingId === bindingId && ticked.groups.length > 0 ? ticked : undefined;

  // A command must read as taken within a tenth of a second, so the dialog closes and the
  // selection is spent before the api answers.
  const command = <Answer,>(said: {
    readonly pending: string;
    readonly done: (answer: Answer) => string;
    readonly run: (ready: TickedGroups, settled: Settled<Answer>) => void;
  }) => {
    if (ready === undefined) return;
    setOpen(false);
    tick({ bindingId: ready.bindingId, groups: [] });
    setOutcome({ tone: "said", words: said.pending });
    said.run(ready, {
      onSuccess: (answer) => {
        setOutcome({ tone: "said", words: said.done(answer) });
      },
      onError: (failure) => {
        tick(ready);
        setOutcome(outcomeOfFailure(failure));
      },
    });
  };

  return { ready, open, setOpen, outcome, command };
};

function BulkAct(properties: {
  readonly act: ReturnType<typeof useBulkAct>;
  readonly keystroke: Keystroke;
  readonly label: string;
  readonly dialog: ReactNode;
}) {
  const { act } = properties;
  const show = () => {
    if (act.ready !== undefined) act.setOpen(true);
  };
  useKeystroke(properties.keystroke, show);

  return (
    <div className="grid content-start gap-1">
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start"
        disabled={act.ready === undefined}
        aria-keyshortcuts={properties.keystroke.key}
        onClick={show}
      >
        {properties.label}
      </Button>
      {properties.dialog}
      <OutcomeLine outcome={act.outcome} className="text-sm" />
    </div>
  );
}

function TickedList(properties: { readonly groups: readonly FindingGroup[] }) {
  return (
    <ul className="grid gap-1">
      {properties.groups.map((group) => (
        <li key={groupKeyText(group)}>
          {spokenWord(group.category)} by <span className="font-mono">{group.ruleId}</span> in{" "}
          {group.title}: {group.found} found
        </li>
      ))}
    </ul>
  );
}

export function KeepInTextAct(properties: { readonly bindingId: string }) {
  const act = useBulkAct(properties.bindingId);
  const keep = useKeepInText();
  const reasonId = useId();
  const formId = useId();
  const groups = act.ready?.groups ?? [];
  const named = counted(groups.length, "finding group", "finding groups");
  // Counted off the groups the review listed, so the screen reads nothing of the spans kept.
  const spans = counted(
    groups.reduce((sum, group) => sum + group.found, 0),
    "span",
    "spans",
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get("reason");
    if (typeof reason !== "string") return;
    act.command({
      pending: `Keeping ${named} in text.`,
      done: () =>
        `Kept ${named} in text: ${spans} restored, and the index run that lets them back in is queued.`,
      run: (ready, settled) => {
        keep.mutate(
          {
            bindingId: ready.bindingId,
            findingGroups: ready.groups.map(keyOf),
            reason: reason.trim(),
          },
          settled,
        );
      },
    });
  };

  return (
    <BulkAct
      act={act}
      keystroke={SOURCES_KEYSTROKES.keep}
      label={act.ready === undefined ? "Keep in text" : `Keep ${named} in text`}
      dialog={
        <ActDialog
          open={act.open}
          onOpenChange={act.setOpen}
          title={`Keep ${named} in text`}
          consequence="Every span of each group goes back into its document's text on the next index run, restored under your name with this reason. An erasure request still outranks a keep."
          commit={
            <Button type="submit" form={formId}>
              Keep {named} in text
            </Button>
          }
        >
          <TickedList groups={groups} />
          <form id={formId} onSubmit={submit} className="grid gap-2">
            <Label htmlFor={reasonId}>Reason</Label>
            <Input id={reasonId} name="reason" required autoComplete="off" />
          </form>
        </ActDialog>
      }
    />
  );
}

export function NarrowDocumentsAct(properties: { readonly bindingId: string }) {
  const act = useBulkAct(properties.bindingId);
  const narrow = useNarrowDocuments();
  const groups = act.ready?.groups ?? [];
  const documents = [...new Map(groups.map((group) => [group.documentId, group.title]))];
  const named = counted(documents.length, "document", "documents");

  const confirm = () => {
    act.command<DocumentsNarrowed>({
      pending: `Narrowing ${named} to ${NARROWEST}.`,
      done: (narrowed) =>
        `Narrowed ${counted(narrowed.documentIds.length, "document", "documents")} to ${NARROWEST}; ${counted(narrowed.concepts.length, "concept", "concepts")} and ${counted(narrowed.compositions.length, "composition", "compositions")} moved with them.`,
      run: (ready, settled) => {
        narrow.mutate(
          { bindingId: ready.bindingId, findingGroups: ready.groups.map(keyOf) },
          settled,
        );
      },
    });
  };

  return (
    <BulkAct
      act={act}
      keystroke={SOURCES_KEYSTROKES.narrowDocuments}
      label={act.ready === undefined ? "Narrow these documents" : `Narrow ${named}`}
      dialog={
        <ActDialog
          open={act.open}
          onOpenChange={act.setOpen}
          title={`Narrow ${named} to ${NARROWEST}`}
          consequence={`Each document takes the class ${NARROWEST}. The ticked groups' unreviewed findings are reviewed as narrowed, and every concept citing the documents moves with them. A narrowing never widens, and this screen cannot undo it.`}
          commit={
            <Button onClick={confirm}>
              Narrow {named} to {NARROWEST}
            </Button>
          }
        >
          <ul className="grid gap-1">
            {documents.map(([documentId, title]) => (
              <li key={documentId}>{title}</li>
            ))}
          </ul>
        </ActDialog>
      }
    />
  );
}
