import { useId, useState } from "react";

import { SummaryRow } from "@/shared/summary-row.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Label } from "@/shared/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select.tsx";

import { whyAndNextOf } from "./refusal.tsx";
import {
  EVERYONE,
  NARROWEST,
  SENSITIVITIES,
  type ListedConnectedSource,
  type Sensitivity,
} from "./sources-api.ts";
import { SENSITIVITY_FIELD } from "./sources-state.ts";
import {
  AUDIENCE_WORDS,
  SENSITIVITY_PANEL_WORDS,
  termsThatChange,
  THE_CHANGE_BEFORE_IS_STILL_GOING,
  type SensitivityAndAudience,
} from "./words.ts";

export type SensitivityChange = keyof typeof SENSITIVITY_PANEL_WORDS;

type Audience = ListedConnectedSource["audience"];

function WordPicked<Word extends string>(properties: {
  readonly id?: string;
  readonly label: string;
  readonly value: Word;
  readonly words: readonly Word[];
  readonly said?: (word: Word) => string;
  readonly onPick: (word: Word) => void;
}) {
  const { words, said = (word) => word } = properties;
  const ownId = useId();
  const id = properties.id ?? ownId;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{properties.label}</Label>
      <Select
        value={properties.value}
        onValueChange={(value) => {
          const picked = words.find((word) => word === value);
          if (picked !== undefined) properties.onPick(picked);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {words.map((word) => (
            <SelectItem key={word} value={word}>
              {said(word)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const narrowerThan = (sensitivity: Sensitivity): readonly Sensitivity[] =>
  SENSITIVITIES.slice(0, SENSITIVITIES.indexOf(sensitivity));

const asWideOrWiderThan = (sensitivity: Sensitivity): readonly Sensitivity[] =>
  SENSITIVITIES.slice(SENSITIVITIES.indexOf(sensitivity));

/** The panel opens on a widening, so the one click it asks for is never refused as not wider. */
const firstWidening = (connectedSource: ListedConnectedSource): SensitivityAndAudience => {
  const wider = SENSITIVITIES[SENSITIVITIES.indexOf(connectedSource.sensitivity) + 1];
  return wider === undefined
    ? { sensitivity: connectedSource.sensitivity, audience: EVERYONE }
    : { sensitivity: wider, audience: connectedSource.audience };
};

/**
 * The panel offers no narrower sensitivity and no other groups, so a wider term is the whole
 * question.
 */
const asksWider = (
  connectedSource: ListedConnectedSource,
  asked: SensitivityAndAudience,
): boolean =>
  SENSITIVITIES.indexOf(asked.sensitivity) > SENSITIVITIES.indexOf(connectedSource.sensitivity) ||
  (asked.audience === EVERYONE && connectedSource.audience !== EVERYONE);

type Offer = {
  readonly sensitivities: (connectedSource: ListedConnectedSource) => readonly Sensitivity[];
  /** None where the change leaves the audience alone, and the panel then draws no field for it. */
  readonly audiences: (connectedSource: ListedConnectedSource) => readonly Audience[];
  readonly opensOn: (connectedSource: ListedConnectedSource) => SensitivityAndAudience;
  /** What the api would refuse, said before the click in its own words. */
  readonly refusedWhy: (
    connectedSource: ListedConnectedSource,
    asked: SensitivityAndAudience,
  ) => string | undefined;
};

const OFFERS = {
  narrow: {
    sensitivities: (connectedSource) => narrowerThan(connectedSource.sensitivity),
    audiences: () => [],
    opensOn: (connectedSource) => ({
      sensitivity: narrowerThan(connectedSource.sensitivity)[0] ?? NARROWEST,
      audience: connectedSource.audience,
    }),
    refusedWhy: () => undefined,
  },
  widen: {
    sensitivities: (connectedSource) => asWideOrWiderThan(connectedSource.sensitivity),
    audiences: (connectedSource) =>
      connectedSource.audience === EVERYONE ? [] : [connectedSource.audience, EVERYONE],
    opensOn: firstWidening,
    refusedWhy: (connectedSource, asked) =>
      asksWider(connectedSource, asked) ? undefined : whyAndNextOf("not-wider"),
  },
} satisfies Record<SensitivityChange, Offer>;

/**
 * A narrowing takes reach away and a widening gives it back, so both are one group in the row,
 * never a modal.
 */
export function SensitivityPanel(properties: {
  readonly change: SensitivityChange;
  readonly connectedSource: ListedConnectedSource;
  /** A second action sent before the first answers would drop the first one's answer. */
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly onCommit: (asked: SensitivityAndAudience) => void;
}) {
  const { change, connectedSource, onCommit } = properties;
  const offer = OFFERS[change];
  const words = SENSITIVITY_PANEL_WORDS[change];
  const [asked, setAsked] = useState(() => offer.opensOn(connectedSource));
  const consequenceId = useId();
  const refusedWhyId = useId();
  const audiences = offer.audiences(connectedSource);
  const changes = termsThatChange(connectedSource, asked);
  const refusedWhy = properties.pending
    ? THE_CHANGE_BEFORE_IS_STILL_GOING
    : offer.refusedWhy(connectedSource, asked);

  return (
    <fieldset
      aria-describedby={consequenceId}
      className="mt-3 grid min-w-0 gap-3 border border-border p-3"
    >
      <legend className="float-left font-medium">{words.named(connectedSource.name)}</legend>
      <p id={consequenceId} className="text-sm text-muted-foreground">
        {words.consequence(connectedSource.publishedAt !== null)}
      </p>

      <WordPicked
        id={SENSITIVITY_FIELD}
        label="Sensitivity"
        value={asked.sensitivity}
        words={offer.sensitivities(connectedSource)}
        onPick={(sensitivity) => {
          setAsked({ ...asked, sensitivity });
        }}
      />
      {audiences.length === 0 ? null : (
        <WordPicked
          label="Audience"
          value={asked.audience}
          words={audiences}
          said={(audience) => AUDIENCE_WORDS[audience]}
          onPick={(audience) => {
            setAsked({ ...asked, audience });
          }}
        />
      )}

      {changes.length === 0 ? null : (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          {changes.map((each) => (
            <SummaryRow key={each.term} term={each.term}>
              {each.says}
            </SummaryRow>
          ))}
        </dl>
      )}
      {refusedWhy === undefined ? null : (
        <p id={refusedWhyId} className="text-sm text-muted-foreground">
          {refusedWhy}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={properties.onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="accent"
          // Not `disabled`: a disabled button drops the focus the keyboard left on it.
          aria-disabled={refusedWhy !== undefined}
          aria-describedby={refusedWhy === undefined ? undefined : refusedWhyId}
          className="h-auto min-h-8 max-w-full shrink py-1 text-left whitespace-normal aria-disabled:opacity-50"
          onClick={() => {
            if (refusedWhy === undefined) onCommit(asked);
          }}
        >
          {words.commit(connectedSource.name, asked)}
        </Button>
      </div>
    </fieldset>
  );
}
