import {
  lazy,
  Suspense,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { useKeystroke } from "@/shared/keystrokes.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "@/shared/ui/native-select.tsx";
import { Textarea } from "@/shared/ui/textarea.tsx";

import type { SourceEntry } from "../knowledge-api.ts";
import { EDITOR_KEYSTROKES } from "../knowledge-state.ts";
import {
  cannotSaveBecause,
  type Draft,
  type EditorState,
  type EditTarget,
  type Mode,
  type Open,
} from "./concept-editing.ts";
import { EDITOR_WORDS as WORDS } from "./editor-words.ts";
import { losesMarkdown } from "./markdown-round-trip.ts";
import { VisualBody } from "./visual-body.tsx";

export { openingMode } from "./markdown-round-trip.ts";

const SourceBody = lazy(() =>
  // oxlint-disable-next-line better-answers/import-statically -- CodeMirror loads only when someone edits as markdown
  import("./source-body.tsx").then((loaded) => ({ default: loaded.SourceBody })),
);

type EditorShown = Extract<EditorState, { readonly open: Open }>;

export type EditorEvents = {
  readonly edit: (patch: Partial<Draft>) => void;
  readonly mode: (mode: Mode, lossy: boolean) => void;
  readonly save: () => void;
  readonly confirm: () => void;
  readonly keepEditing: () => void;
  readonly reload: () => void;
  readonly close: () => void;
  readonly collection: (collection: string | undefined) => void;
};

export type Leaving = { readonly proceed: () => void; readonly reset: () => void };

export type EditorProps = {
  readonly shown: EditorShown;
  readonly target: EditTarget;
  readonly collections: readonly string[];
  readonly generation: number;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly leaving: Leaving | undefined;
  readonly events: EditorEvents;
};

const headingOf = (open: Open, target: EditTarget): string => {
  if (target.kind === "new") return WORDS.headingNew;
  return open.read.standing === "commits" ? WORDS.headingEdit : WORDS.headingSuggest;
};

const consequenceOf = (open: Open, target: EditTarget): string | undefined => {
  const commits = open.read.standing === "commits";
  if (target.kind === "concept") return commits ? WORDS.commits : WORDS.suggests;
  if (target.collection === undefined) return undefined;
  return commits ? WORDS.commitsNew(target.collection) : WORDS.suggests;
};

const IN_A_TEXT_FIELD = 'input, textarea, [contenteditable="true"], [role="textbox"]';

function Warning(properties: { readonly words: string }) {
  return (
    <div className="mt-4 flex items-start gap-3">
      <span
        aria-hidden
        className="grid size-6 shrink-0 place-items-center border border-foreground font-mono font-semibold"
      >
        !
      </span>
      <strong className="font-semibold">
        <span className="sr-only">{WORDS.warning} </span>
        {properties.words}
      </strong>
    </div>
  );
}

type TextKey = "title" | "kind" | "description" | "tags";

type TextFieldShown = {
  readonly key: TextKey;
  readonly label: string;
  readonly hint?: string;
  readonly multiline?: boolean;
};

const TEXT_FIELDS: readonly TextFieldShown[] = [
  { key: "title", label: WORDS.title },
  { key: "kind", label: WORDS.kind },
  { key: "description", label: WORDS.description, multiline: true },
  { key: "tags", label: WORDS.tags, hint: WORDS.tagsHint },
];

function TextField(properties: {
  readonly shown: TextFieldShown;
  readonly value: string;
  readonly locked: boolean;
  readonly onChange: (value: string) => void;
}) {
  const { shown, value, locked, onChange } = properties;
  const id = useId();
  const hintId = useId();
  const field = {
    id,
    value,
    readOnly: locked,
    "aria-describedby": shown.hint === undefined ? undefined : hintId,
  };

  return (
    <div className="mt-4 grid gap-1.5">
      <Label htmlFor={id}>{shown.label}</Label>
      {shown.hint === undefined ? null : (
        <p id={hintId} className="text-muted-foreground">
          {shown.hint}
        </p>
      )}
      {shown.multiline === true ? (
        <Textarea rows={2} {...field} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input {...field} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  );
}

function CollectionField(properties: {
  readonly collection: string | undefined;
  readonly collections: readonly string[];
  readonly locked: boolean;
  readonly onChoose: (collection: string | undefined) => void;
}) {
  const { collection, collections } = properties;
  const id = useId();
  const choices =
    collection === undefined || collections.includes(collection)
      ? collections
      : [collection, ...collections];

  return (
    <div className="mt-4 grid gap-1.5">
      <Label htmlFor={id}>{WORDS.collection}</Label>
      <NativeSelect
        id={id}
        value={collection ?? ""}
        disabled={properties.locked}
        onChange={(event) => {
          properties.onChoose(event.target.value === "" ? undefined : event.target.value);
        }}
      >
        <NativeSelectOption value="">{WORDS.chooseCollection}</NativeSelectOption>
        {choices.map((choice) => (
          <NativeSelectOption key={choice} value={choice}>
            {choice}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

type SourceRow = { readonly id: number; readonly entry: SourceEntry };

type SourceRows = { readonly rows: readonly SourceRow[]; readonly next: number };

const NAMING_KEYS = ["title", "resource"] as const;

const labelOf = (entry: Exclude<SourceEntry, string>, number: number): string => {
  const named = NAMING_KEYS.map((key) => entry[key]).find(
    (value) => typeof value === "string" && value.trim() !== "",
  );
  return typeof named === "string" ? named : WORDS.source(number);
};

function SourcesField(properties: {
  readonly sources: readonly SourceEntry[];
  readonly withheld: number;
  readonly locked: boolean;
  readonly onChange: (sources: readonly SourceEntry[]) => void;
}) {
  const { locked } = properties;
  const hintId = useId();
  const [held, setHeld] = useState<SourceRows>(() => ({
    rows: properties.sources.map((entry, at) => ({ id: at, entry })),
    next: properties.sources.length,
  }));
  const change = (next: SourceRows) => {
    if (locked) return;
    setHeld(next);
    properties.onChange(next.rows.map((row) => row.entry));
  };
  const replaced = (id: number, entry: SourceEntry) =>
    held.rows.map((row) => (row.id === id ? { id, entry } : row));

  return (
    <fieldset className="mt-4 min-w-0" aria-describedby={hintId}>
      <legend className="text-sm font-medium">{WORDS.sources}</legend>
      <p id={hintId} className="mt-1.5 text-muted-foreground">
        {WORDS.sourcesNumbered}
      </p>
      <ol className="mt-2 grid list-decimal gap-2 pl-6">
        {held.rows.map((row, at) => (
          <li key={row.id} className="flex flex-wrap items-center gap-2">
            {typeof row.entry === "string" ? (
              <Input
                aria-label={WORDS.source(at + 1)}
                value={row.entry}
                readOnly={locked}
                className="min-w-0 flex-1"
                onChange={(event) => {
                  change({ ...held, rows: replaced(row.id, event.target.value) });
                }}
              />
            ) : (
              <span className="min-w-0 flex-1 wrap-anywhere">{labelOf(row.entry, at + 1)}</span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-disabled={locked}
              onClick={() => {
                change({ ...held, rows: held.rows.filter((each) => each.id !== row.id) });
              }}
            >
              <span aria-hidden>{WORDS.remove}</span>
              <span className="sr-only">{WORDS.removeSource(at + 1)}</span>
            </Button>
          </li>
        ))}
      </ol>
      {properties.withheld === 0 ? null : (
        <p className="mt-2 text-muted-foreground">{WORDS.withheld(properties.withheld)}</p>
      )}
      {held.rows.some((row) => typeof row.entry !== "string") ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          aria-disabled={locked}
          onClick={() => {
            change({ rows: [...held.rows, { id: held.next, entry: "" }], next: held.next + 1 });
          }}
        >
          {WORDS.addSource}
        </Button>
      )}
    </fieldset>
  );
}

function ModeSwitch(properties: {
  readonly mode: Mode;
  readonly lossy: boolean;
  readonly onSwitch: (to: Mode) => void;
}) {
  const { mode } = properties;
  const labelId = useId();
  const choices = [
    { to: "visual", words: WORDS.visual, unavailable: properties.lossy },
    { to: "source", words: WORDS.markdown, unavailable: false },
  ] as const;

  return (
    <fieldset
      data-edit-as
      aria-labelledby={labelId}
      className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
    >
      <span id={labelId} className="text-sm font-medium">
        {WORDS.editAs}
      </span>
      {choices.map((choice) => (
        <Button
          key={choice.to}
          type="button"
          size="sm"
          variant={mode === choice.to ? "secondary" : "outline"}
          aria-pressed={mode === choice.to}
          aria-disabled={choice.unavailable ? true : undefined}
          onClick={() => {
            properties.onSwitch(choice.to);
          }}
        >
          {choice.words}
        </Button>
      ))}
    </fieldset>
  );
}

function BodySection(properties: {
  readonly open: Open;
  readonly generation: number;
  readonly locked: boolean;
  readonly events: EditorEvents;
}) {
  const { open, events, locked } = properties;
  const reasonId = useId();
  const settled = useDeferredValue(open.draft.body);
  const lossy = useMemo(
    () => open.mode === "source" && losesMarkdown(settled),
    [open.mode, settled],
  );
  const switchTo = (to: Mode) => {
    if (locked) return;
    const loses = losesMarkdown(open.draft.body);
    events.mode(to === "visual" && loses ? "source" : to, loses);
  };
  useKeystroke(EDITOR_KEYSTROKES.mode, () => {
    switchTo(open.mode === "visual" ? "source" : "visual");
  });
  const field = {
    label: WORDS.body,
    value: open.draft.body,
    describedBy: reasonId,
    onChange: (markdown: string) => {
      events.edit({ body: markdown });
    },
  };

  return (
    <div className="mt-4 grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span aria-hidden className="text-sm leading-none font-medium">
          {WORDS.body}
        </span>
        <ModeSwitch mode={open.mode} lossy={lossy} onSwitch={switchTo} />
      </div>
      {lossy ? (
        <p id={reasonId} className="text-muted-foreground">
          {WORDS.lossy}
        </p>
      ) : null}
      <div inert={locked} key={`${open.mode}:${String(properties.generation)}`}>
        {open.mode === "visual" ? (
          <VisualBody {...field} />
        ) : (
          <Suspense fallback={<p>{WORDS.loading}</p>}>
            <SourceBody {...field} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function LeavingAsk(properties: { readonly leaving: Leaving; readonly onKeep: () => void }) {
  const ask = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    ask.current?.focus();
  }, []);

  return (
    <fieldset ref={ask} tabIndex={-1} aria-label={WORDS.leaving} className="m-0 mt-4 border-0 p-0">
      <Warning words={WORDS.leaving} />
      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={properties.leaving.proceed}>
          {WORDS.leave}
        </Button>
        <Button type="button" variant="accent" onClick={properties.onKeep}>
          {WORDS.keepEditing}
        </Button>
      </div>
    </fieldset>
  );
}

function Actions(properties: {
  readonly shown: EditorShown;
  readonly target: EditTarget;
  readonly events: EditorEvents;
}) {
  const { shown, target, events } = properties;
  const reasonId = useId();
  const cannot = cannotSaveBecause(target, shown.open.draft);
  const saving = shown.stage === "saving";
  const closing = (
    <Button type="button" variant="outline" aria-disabled={saving} onClick={events.close}>
      {WORDS.close}
    </Button>
  );

  if (shown.stage === "stale") {
    return (
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" variant="accent" onClick={events.reload}>
          {WORDS.reload}
        </Button>
        {closing}
      </div>
    );
  }
  if (shown.stage === "confirming") {
    return (
      <>
        <Warning words={WORDS.reuse(shown.open.read.usedIn)} />
        <div className="mt-3 flex flex-wrap gap-3">
          <Button type="button" onClick={events.confirm}>
            {WORDS.save}
          </Button>
          <Button type="button" variant="outline" onClick={events.keepEditing}>
            {WORDS.keepEditing}
          </Button>
        </div>
      </>
    );
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button
        type="button"
        aria-disabled={cannot !== undefined || saving}
        aria-describedby={cannot === undefined ? undefined : reasonId}
        onClick={events.save}
      >
        {WORDS.save}
      </Button>
      {closing}
      {cannot === undefined ? null : (
        <p id={reasonId} className="text-muted-foreground">
          {WORDS.cannotSave[cannot]}
        </p>
      )}
    </div>
  );
}

export function ConceptEditor(properties: EditorProps) {
  const { shown, target, events, headingRef } = properties;
  const { open } = shown;
  const headingId = useId();
  const locked = shown.stage !== "editing";
  const consequence = shown.stage === "stale" ? undefined : consequenceOf(open, target);

  useEffect(() => {
    headingRef.current?.focus();
  }, [headingRef]);

  const onKeys = (event: KeyboardEvent<HTMLElement>) => {
    const { target: pressedIn } = event;
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      events.save();
    } else if (
      event.key === "Escape" &&
      pressedIn instanceof Element &&
      pressedIn.matches(IN_A_TEXT_FIELD)
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget
        .querySelector<HTMLElement>('[data-edit-as] [aria-pressed="true"]')
        ?.focus();
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className="mt-6 border-t border-border pt-4"
      onKeyDownCapture={onKeys}
    >
      <h3
        ref={headingRef}
        id={headingId}
        tabIndex={-1}
        className="[font-size:var(--text-md)] font-semibold"
      >
        {headingOf(open, target)}
      </h3>
      {TEXT_FIELDS.map((field) => (
        <TextField
          key={field.key}
          shown={field}
          value={open.draft[field.key]}
          locked={locked}
          onChange={(value) => {
            events.edit({ [field.key]: value });
          }}
        />
      ))}
      {target.kind === "new" ? (
        <CollectionField
          collection={target.collection}
          collections={properties.collections}
          locked={locked}
          onChoose={events.collection}
        />
      ) : null}
      <BodySection open={open} generation={properties.generation} locked={locked} events={events} />
      <SourcesField
        key={properties.generation}
        sources={open.draft.sources}
        withheld={open.read.withheld.length}
        locked={locked}
        onChange={(sources) => {
          events.edit({ sources });
        }}
      />
      {consequence === undefined ? null : <Warning words={consequence} />}
      <Actions shown={shown} target={target} events={events} />
      {properties.leaving === undefined ? null : (
        <LeavingAsk
          leaving={properties.leaving}
          onKeep={() => {
            properties.leaving?.reset();
            headingRef.current?.focus();
          }}
        />
      )}
    </section>
  );
}
