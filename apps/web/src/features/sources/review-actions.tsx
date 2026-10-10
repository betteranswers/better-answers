import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { ActionDialog } from "@/shared/action-dialog.tsx";
import type { ApiError } from "@/shared/api/trpc.ts";
import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { counted } from "@/shared/words.ts";

import { outcomeOfFailure, whyAndNextOf } from "./refusal.tsx";
import {
  groupKeyText,
  keyOf,
  NARROWEST,
  useConnectedSources,
  useDismissAsNotSpecialCategory,
  useKeepInText,
  useNarrowDocuments,
  type DismissedAsNotSpecialCategory,
  type DocumentsNarrowed,
  type GroupOfFindings,
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

const askOf = (ready: TickedGroups) => ({
  connectedSourceId: ready.connectedSourceId,
  groupsOfFindings: ready.groups.map(keyOf),
});

const reasonedAsk = (ready: TickedGroups, reason: string) => ({ ...askOf(ready), reason });

/**
 * Inert until this connected source's review has ticked groups the action takes: an action over nothing is
 * disabled and reads as such.
 */
const useBulkAction = (
  connectedSourceId: string,
  takes: (group: GroupOfFindings) => boolean = takesAnyGroup,
) => {
  const [ticked, tick] = useTickedGroups();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const opener = useRef<HTMLElement>(null);
  const selected = groupsTickedIn(ticked, connectedSourceId);
  const ready: TickedGroups | undefined =
    selected.length > 0 && selected.every(takes)
      ? { connectedSourceId, groups: selected }
      : undefined;

  const show = () => {
    if (ready === undefined) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  };

  /**
   * The action's own button is disabled once the selection is spent, so focus it cannot take goes to
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
    tick({ connectedSourceId: ready.connectedSourceId, groups: [] });
    setOutcome({ tone: "said", words: said.pending });
    said.run(ready, {
      onSuccess: (answer) => {
        setOutcome({ tone: "said", words: said.done(answer) });
      },
      onError: (failure) => {
        tick(ready);
        setOutcome(outcomeOfFailure(failure, "action"));
      },
    });
  };

  return { selected, ready, open, setOpen, show, returnFocus, outcome, command };
};

type BulkActionState = ReturnType<typeof useBulkAction>;

function BulkAction(properties: {
  readonly action: BulkActionState;
  readonly keystroke: Keystroke;
  readonly label: string;
  readonly refusedWhy?: string;
  readonly dialog: ReactNode;
}) {
  const { action } = properties;
  const refusedWhyId = useId();
  useKeystroke(properties.keystroke, action.show);
  const refusedWhy =
    action.selected.length > 0 && action.ready === undefined ? properties.refusedWhy : undefined;

  return (
    <div className="grid content-start gap-1">
      <Button
        variant="outline"
        size="sm"
        className="h-auto min-h-8 justify-self-start py-1 text-left whitespace-normal"
        disabled={action.ready === undefined}
        aria-keyshortcuts={properties.keystroke.key}
        aria-describedby={refusedWhy === undefined ? undefined : refusedWhyId}
        onClick={action.show}
      >
        {properties.label}
      </Button>
      {refusedWhy === undefined ? null : (
        <p id={refusedWhyId} className="text-sm text-muted-foreground">
          {refusedWhy}
        </p>
      )}
      {properties.dialog}
      <OutcomeLine outcome={action.outcome} className="text-sm" />
    </div>
  );
}

function TickedList(properties: { readonly groups: readonly GroupOfFindings[] }) {
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
 * Both reasoned actions land the reason in the audit log beside the Admin who gave it, so they ask for
 * it alike.
 */
function ReasonedDialog(properties: {
  readonly action: BulkActionState;
  readonly title: string;
  readonly consequence: string;
  readonly onReason: (reason: string) => void;
}) {
  const { action } = properties;
  const reasonId = useId();
  const formId = useId();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get("reason");
    if (typeof reason === "string") properties.onReason(reason.trim());
  };

  return (
    <ActionDialog
      open={action.open}
      onOpenChange={action.setOpen}
      content={{ onCloseAutoFocus: action.returnFocus }}
      title={properties.title}
      consequence={properties.consequence}
      commit={
        <Button type="submit" form={formId}>
          {properties.title}
        </Button>
      }
    >
      <TickedList groups={action.ready?.groups ?? []} />
      <form id={formId} onSubmit={submit} className="grid gap-2">
        <Label htmlFor={reasonId}>Reason</Label>
        <Input id={reasonId} name="reason" required autoComplete="off" />
      </form>
    </ActionDialog>
  );
}

export function KeepInTextAction(properties: { readonly connectedSourceId: string }) {
  const action = useBulkAction(properties.connectedSourceId);
  const keep = useKeepInText();
  const groups = action.ready?.groups ?? [];
  const named = counted(groups.length, "group of findings", "groups of findings");
  /** Counted off the groups the review listed, so the page reads nothing of the spans kept. */
  const spans = counted(
    groups.reduce((sum, group) => sum + group.found, 0),
    "span",
    "spans",
  );

  const kept = (reason: string) => {
    action.command({
      pending: `Keeping ${named} in text.`,
      done: () =>
        `Kept ${named} in text: ${spans} restored, and the sync that lets them back in is queued.`,
      run: (ready, settled) => {
        keep.mutate(reasonedAsk(ready, reason), settled);
      },
    });
  };

  return (
    <BulkAction
      action={action}
      keystroke={SOURCES_KEYSTROKES.keep}
      label={action.ready === undefined ? "Keep in text" : `Keep ${named} in text`}
      dialog={
        <ReasonedDialog
          action={action}
          title={`Keep ${named} in text`}
          consequence="Every span of each group goes back into its document’s text on the next sync, restored under your name with this reason. An erasure request still outranks a keep."
          onReason={kept}
        />
      }
    />
  );
}

export function NarrowDocumentsAction(properties: { readonly connectedSourceId: string }) {
  const action = useBulkAction(properties.connectedSourceId);
  const narrow = useNarrowDocuments();
  const groups = action.ready?.groups ?? [];
  const documents = [...new Map(groups.map((group) => [group.documentId, group.title]))];
  const named = counted(documents.length, "document", "documents");

  const confirm = () => {
    action.command<DocumentsNarrowed>({
      pending: `Narrowing ${named} to ${NARROWEST}.`,
      done: (narrowed) =>
        `Narrowed ${counted(narrowed.documentIds.length, "document", "documents")} to ${NARROWEST}; ${counted(narrowed.concepts.length, "concept", "concepts")} and ${counted(narrowed.writeUps.length, "write-up", "write-ups")} moved with them.`,
      run: (ready, settled) => {
        narrow.mutate(askOf(ready), settled);
      },
    });
  };

  return (
    <BulkAction
      action={action}
      keystroke={SOURCES_KEYSTROKES.narrowDocuments}
      label={action.ready === undefined ? "Narrow these documents" : `Narrow ${named}`}
      dialog={
        <ActionDialog
          open={action.open}
          onOpenChange={action.setOpen}
          content={{ onCloseAutoFocus: action.returnFocus }}
          title={`Narrow ${named} to ${NARROWEST}`}
          consequence={`Each document takes the sensitivity ${NARROWEST}. The ticked groups’ unreviewed findings are reviewed as narrowed, and every concept citing the documents moves with them. A narrowing never widens, and this page cannot undo it.`}
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
        </ActionDialog>
      }
    />
  );
}

/** A ulid sorts by when it was minted, so a sync at or past the action's own is one that reads it. */
function SyncStatus(properties: { readonly connectedSourceId: string; readonly jobId: string }) {
  const connectedSources = useConnectedSources();
  const sync = connectedSources.data?.find(
    (connectedSource) => connectedSource.connectedSourceId === properties.connectedSourceId,
  )?.lastSync;
  return sync === undefined || sync === null || sync.jobId < properties.jobId
    ? "queued"
    : sync.status;
}

const isSpecialCategory = (group: GroupOfFindings): boolean => group.specialCategory;

export function DismissAsNotSpecialCategoryAction(properties: {
  readonly connectedSourceId: string;
}) {
  const action = useBulkAction(properties.connectedSourceId, isSpecialCategory);
  const dismiss = useDismissAsNotSpecialCategory();
  const named = counted(
    action.ready?.groups.length ?? 0,
    "group of findings",
    "groups of findings",
  );

  const dismissed = (reason: string) => {
    action.command<DismissedAsNotSpecialCategory>({
      pending: `Dismissing ${named} as not special category.`,
      done: (answer) => (
        <>
          Dismissed {named} as not special category in{" "}
          {counted(answer.documentIds.length, "document", "documents")}. The sync that reads the
          dismissal:{" "}
          <SyncStatus connectedSourceId={answer.connectedSourceId} jobId={answer.jobId} />.
        </>
      ),
      run: (ready, settled) => {
        dismiss.mutate(reasonedAsk(ready, reason), settled);
      },
    });
  };

  return (
    <BulkAction
      action={action}
      keystroke={SOURCES_KEYSTROKES.dismiss}
      label={
        action.ready === undefined
          ? "Dismiss as not special category"
          : `Dismiss ${named} as not special category`
      }
      refusedWhy={whyAndNextOf("not-special-category")}
      dialog={
        <ReasonedDialog
          action={action}
          title={`Dismiss ${named} as not special category`}
          consequence="Every span of each group is reviewed as dismissed under your name with this reason, and the sync that reads the dismissal is queued. On that sync, a document whose every special category finding is dismissed goes back to the sensitivity an Admin narrowed it to, or to its connected source’s sensitivity if none did. The spans stay withheld unless kept in text."
          onReason={dismissed}
        />
      }
    />
  );
}
