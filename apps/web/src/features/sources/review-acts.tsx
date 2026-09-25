import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { counted } from "@/shared/words.ts";

import { ActDialog } from "./act-dialog.tsx";
import { outcomeOfFailure, whyAndNextOf } from "./refusal.tsx";
import {
  groupKeyText,
  keyOf,
  NARROWEST,
  useBindings,
  useDismissAsNotSpecialCategory,
  useKeepInText,
  useNarrowDocuments,
  type DismissedAsNotSpecialCategory,
  type DocumentsNarrowed,
  type FindingGroup,
} from "./sources-api.ts";
import {
  REVIEW_HEADING,
  SOURCES_KEYSTROKES,
  groupsTickedIn,
  useTickedGroups,
  type TickedGroups,
} from "./sources-state.ts";
import { spokenWord } from "./words.ts";

type Settled<Answer> = {
  readonly onSuccess: (answer: Answer) => void;
  readonly onError: (failure: Error | ApiError) => void;
};

const takesAnyGroup = (): boolean => true;

/**
 * Inert until this binding's review has ticked groups the act takes: an act over nothing is
 * disabled and reads as such.
 */
const useBulkAct = (bindingId: string, takes: (group: FindingGroup) => boolean = takesAnyGroup) => {
  const [ticked, tick] = useTickedGroups();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const opener = useRef<HTMLElement>(null);
  const selected = groupsTickedIn(ticked, bindingId);
  const ready: TickedGroups | undefined =
    selected.length > 0 && selected.every(takes) ? { bindingId, groups: selected } : undefined;

  const show = () => {
    if (ready === undefined) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  };

  /**
   * The act's own button is disabled once the selection is spent, so focus it cannot take goes to
   * the review.
   */
  const returnFocus = (event: Event) => {
    event.preventDefault();
    opener.current?.focus();
    if (document.activeElement !== opener.current) {
      document.getElementById(REVIEW_HEADING)?.focus();
    }
  };

  /**
   * A command must read as taken within a tenth of a second, so the dialog closes and the
   * selection is spent before the api answers.
   */
  const command = <Answer,>(said: {
    readonly pending: string;
    readonly done: (answer: Answer) => ReactNode;
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

  return { selected, ready, open, setOpen, show, returnFocus, outcome, command };
};

type BulkActState = ReturnType<typeof useBulkAct>;

function BulkAct(properties: {
  readonly act: BulkActState;
  readonly keystroke: Keystroke;
  readonly label: string;
  readonly refusedWhy?: string;
  readonly dialog: ReactNode;
}) {
  const { act } = properties;
  const refusedWhyId = useId();
  useKeystroke(properties.keystroke, act.show);
  const refusedWhy =
    act.selected.length > 0 && act.ready === undefined ? properties.refusedWhy : undefined;

  return (
    <div className="grid content-start gap-1">
      <Button
        variant="outline"
        size="sm"
        className="h-auto min-h-8 justify-self-start py-1 text-left whitespace-normal"
        disabled={act.ready === undefined}
        aria-keyshortcuts={properties.keystroke.key}
        aria-describedby={refusedWhy === undefined ? undefined : refusedWhyId}
        onClick={act.show}
      >
        {properties.label}
      </Button>
      {refusedWhy === undefined ? null : (
        <p id={refusedWhyId} className="text-sm text-muted-foreground">
          {refusedWhy}
        </p>
      )}
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

/**
 * Both reasoned acts land the reason on the ledger beside the Admin who gave it, so they ask for
 * it alike.
 */
function ReasonedDialog(properties: {
  readonly act: BulkActState;
  readonly title: string;
  readonly consequence: string;
  readonly onReason: (reason: string) => void;
}) {
  const { act } = properties;
  const reasonId = useId();
  const formId = useId();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get("reason");
    if (typeof reason === "string") properties.onReason(reason.trim());
  };

  return (
    <ActDialog
      open={act.open}
      onOpenChange={act.setOpen}
      content={{ onCloseAutoFocus: act.returnFocus }}
      title={properties.title}
      consequence={properties.consequence}
      commit={
        <Button type="submit" form={formId}>
          {properties.title}
        </Button>
      }
    >
      <TickedList groups={act.ready?.groups ?? []} />
      <form id={formId} onSubmit={submit} className="grid gap-2">
        <Label htmlFor={reasonId}>Reason</Label>
        <Input id={reasonId} name="reason" required autoComplete="off" />
      </form>
    </ActDialog>
  );
}

export function KeepInTextAct(properties: { readonly bindingId: string }) {
  const act = useBulkAct(properties.bindingId);
  const keep = useKeepInText();
  const groups = act.ready?.groups ?? [];
  const named = counted(groups.length, "finding group", "finding groups");
  /** Counted off the groups the review listed, so the screen reads nothing of the spans kept. */
  const spans = counted(
    groups.reduce((sum, group) => sum + group.found, 0),
    "span",
    "spans",
  );

  const kept = (reason: string) => {
    act.command({
      pending: `Keeping ${named} in text.`,
      done: () =>
        `Kept ${named} in text: ${spans} restored, and the index run that lets them back in is queued.`,
      run: (ready, settled) => {
        keep.mutate(
          { bindingId: ready.bindingId, findingGroups: ready.groups.map(keyOf), reason },
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
        <ReasonedDialog
          act={act}
          title={`Keep ${named} in text`}
          consequence="Every span of each group goes back into its document's text on the next index run, restored under your name with this reason. An erasure request still outranks a keep."
          onReason={kept}
        />
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
          content={{ onCloseAutoFocus: act.returnFocus }}
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

/** A ulid sorts by when it was minted, so a run at or past the act's own is one that reads it. */
function RunStatus(properties: { readonly bindingId: string; readonly jobId: string }) {
  const bindings = useBindings();
  const run = bindings.data?.find((binding) => binding.bindingId === properties.bindingId)?.lastRun;
  return run === undefined || run === null || run.jobId < properties.jobId ? "queued" : run.status;
}

const isSpecialCategory = (group: FindingGroup): boolean => group.specialCategory;

export function DismissAsNotSpecialCategoryAct(properties: { readonly bindingId: string }) {
  const act = useBulkAct(properties.bindingId, isSpecialCategory);
  const dismiss = useDismissAsNotSpecialCategory();
  const named = counted(act.ready?.groups.length ?? 0, "finding group", "finding groups");

  const dismissed = (reason: string) => {
    act.command<DismissedAsNotSpecialCategory>({
      pending: `Dismissing ${named} as not special category.`,
      done: (answer) => (
        <>
          Dismissed {named} as not special category in{" "}
          {counted(answer.documentIds.length, "document", "documents")}. The index run that reads
          the dismissal: <RunStatus bindingId={answer.bindingId} jobId={answer.jobId} />.
        </>
      ),
      run: (ready, settled) => {
        dismiss.mutate(
          { bindingId: ready.bindingId, findingGroups: ready.groups.map(keyOf), reason },
          settled,
        );
      },
    });
  };

  return (
    <BulkAct
      act={act}
      keystroke={SOURCES_KEYSTROKES.dismiss}
      label={
        act.ready === undefined
          ? "Dismiss as not special category"
          : `Dismiss ${named} as not special category`
      }
      refusedWhy={whyAndNextOf("not-special-category")}
      dialog={
        <ReasonedDialog
          act={act}
          title={`Dismiss ${named} as not special category`}
          consequence="Every span of each group is reviewed as dismissed under your name with this reason, and the index run that reads the dismissal is queued. On that run, a document whose every special category finding is dismissed goes back to the class an Admin narrowed it to, or to its binding's class if none did. The spans stay withheld unless kept in text."
          onReason={dismissed}
        />
      }
    />
  );
}
