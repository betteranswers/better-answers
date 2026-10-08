import { useId, useState, type Ref } from "react";

import { ceilingLiftsIn, refusalOf, type ApiError } from "@/shared/api/trpc.ts";
import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { RefusalLine } from "@/shared/refusal-outcome.tsx";
import { NO_RESPONSE, type Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Checkbox } from "@/shared/ui/checkbox.tsx";
import { Label } from "@/shared/ui/label.tsx";

import {
  ACCOUNT_ACTIONS,
  RECOVERY_CODE_WORDS,
  RECOVERY_CODES_FILE,
  recoveryCodesText,
} from "./account-words.ts";
import { focusOn, Outcome } from "./auth-page.tsx";
import { copiedToTheClipboard } from "./clipboard.ts";
import {
  CODES_NOT_COPIED,
  CODES_NOT_TICKED,
  CODES_UNANSWERED,
  codesMadeTooOften,
  saidOfASecondFactorRefusal,
} from "./refusal-words.ts";

const COPY_CODES: Keystroke = { key: "c", action: ACCOUNT_ACTIONS.copyCodes };

const DOWNLOAD_CODES: Keystroke = { key: "d", action: ACCOUNT_ACTIONS.download };

const PRINT_CODES: Keystroke = { key: "p", action: ACCOUNT_ACTIONS.print };

/** In the order the block shows its actions. */
export const CODES_KEYSTROKES: readonly Keystroke[] = [COPY_CODES, DOWNLOAD_CODES, PRINT_CODES];

/** Shown once: the api keeps only their hashes, so seeing codes again takes a new set. */
export type CodesInHand = {
  readonly codes: readonly string[];
  readonly replacing: boolean;
  readonly madeAt: string;
};

/** Built in the browser, so the codes never travel again to become a file. */
const asAFile = (text: string): string =>
  `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;

function CodesActions(properties: {
  readonly inHand: CodesInHand;
  readonly address: string;
  readonly onCopied: (copied: boolean) => void;
}) {
  const { inHand } = properties;
  const downloadId = useId();
  const copy = () => {
    void copiedToTheClipboard(inHand.codes.join("\n")).then(properties.onCopied);
  };
  const download = () => {
    document.getElementById(downloadId)?.click();
  };
  const print = () => {
    globalThis.print();
  };
  useKeystroke(COPY_CODES, copy);
  useKeystroke(DOWNLOAD_CODES, download);
  useKeystroke(PRINT_CODES, print);

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button type="button" variant="outline" aria-keyshortcuts={COPY_CODES.key} onClick={copy}>
        {RECOVERY_CODE_WORDS.copy}
      </Button>
      <Button asChild variant="outline">
        <a
          id={downloadId}
          href={asAFile(recoveryCodesText(inHand.codes, properties.address, inHand.madeAt))}
          download={RECOVERY_CODES_FILE}
          aria-keyshortcuts={DOWNLOAD_CODES.key}
        >
          {RECOVERY_CODE_WORDS.download}
        </a>
      </Button>
      <Button type="button" variant="outline" aria-keyshortcuts={PRINT_CODES.key} onClick={print}>
        {RECOVERY_CODE_WORDS.print}
      </Button>
    </div>
  );
}

/** A ceiling carries no word, only the wait until it lifts. */
export const codesUnanswered = (failure: Error | ApiError): Said => {
  const liftsIn = ceilingLiftsIn(failure);
  return liftsIn === undefined ? CODES_UNANSWERED : codesMadeTooOften(liftsIn);
};

export const saidOfAcknowledging = (failure: Error | ApiError | null): Said | undefined => {
  if (failure === null) return undefined;
  const refusal = refusalOf(failure);
  return refusal === undefined ? NO_RESPONSE : saidOfASecondFactorRefusal(refusal);
};

/** On a root page the codes are the page, so their heading is its `h1`. */
const HEADINGS = {
  1: { Heading: "h1", className: "text-xl font-medium" },
  3: { Heading: "h3", className: "font-medium" },
} as const;

type HeadingLevel = keyof typeof HEADINGS;

/** Shown again, a set says it replaces the one before. */
function CodesHeading(properties: {
  readonly id: string;
  readonly headingRef: Ref<HTMLHeadingElement> | undefined;
  readonly level: HeadingLevel | undefined;
  readonly replacing: boolean;
}) {
  const { id, headingRef, level, replacing } = properties;
  const { Heading, className } = HEADINGS[level ?? 3];
  return (
    <>
      <Heading id={id} ref={headingRef} tabIndex={-1} className={className}>
        {RECOVERY_CODE_WORDS.saveHeading}
      </Heading>
      <p className="mt-2 text-muted-foreground">{RECOVERY_CODE_WORDS.saveLine}</p>
      {replacing ? <p className="mt-2">{RECOVERY_CODE_WORDS.replacedLine}</p> : null}
    </>
  );
}

function DoneButton(properties: {
  readonly label: string | undefined;
  readonly unavailable: boolean;
  readonly refused: Said | undefined;
  readonly refusedId: string;
  readonly onDone: () => void;
}) {
  const { label, unavailable, refused, refusedId, onDone } = properties;
  return (
    <>
      <Button
        type="button"
        className="mt-4 aria-disabled:opacity-50"
        aria-disabled={unavailable}
        aria-describedby={refused === undefined ? undefined : refusedId}
        onClick={onDone}
      >
        {label ?? RECOVERY_CODE_WORDS.done}
      </Button>
      <Outcome tone="refused" id={refusedId}>
        {refused === undefined ? null : <RefusalLine said={refused} />}
      </Outcome>
    </>
  );
}

/**
 * Done stays focusable while unticked, so pressing it can say why it did nothing and hand focus
 * to the box.
 */
export function RecoveryCodes(properties: {
  readonly inHand: CodesInHand;
  readonly address: string;
  readonly acknowledging: boolean;
  readonly failure: Said | undefined;
  readonly headingRef?: Ref<HTMLHeadingElement>;
  readonly headingLevel?: HeadingLevel;
  readonly doneLabel?: string;

  /** Handed the set's `madeAt`, so the acknowledgement names the set shown. */
  readonly onDone: (madeAt: string) => void;
}) {
  const { inHand, address, acknowledging, failure, headingRef, onDone } = properties;
  const headingId = useId();
  const savedId = useId();
  const refusedId = useId();
  const [ticked, setTicked] = useState(false);
  const [copied, setCopied] = useState<boolean | undefined>(undefined);
  const [notTicked, setNotTicked] = useState(false);

  const refused = notTicked ? CODES_NOT_TICKED : failure;
  const shown = copied === false ? CODES_NOT_COPIED : refused;

  const done = () => {
    setCopied(undefined);
    if (!ticked) {
      setNotTicked(true);
      focusOn(savedId);
      return;
    }
    if (!acknowledging) onDone(inHand.madeAt);
  };

  return (
    <section
      aria-labelledby={headingId}
      className={properties.headingLevel === 1 ? undefined : "mt-6"}
    >
      <CodesHeading
        id={headingId}
        headingRef={headingRef}
        level={properties.headingLevel}
        replacing={inHand.replacing}
      />

      <ol
        aria-label={RECOVERY_CODE_WORDS.list}
        data-print-alone=""
        className="mt-4 grid list-inside list-decimal grid-cols-1 gap-x-8 gap-y-1 font-mono tabular-nums sm:grid-cols-2"
      >
        {inHand.codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>

      <CodesActions inHand={inHand} address={address} onCopied={setCopied} />
      <Outcome tone="said">{copied === true ? RECOVERY_CODE_WORDS.copied : null}</Outcome>

      <div className="mt-6 flex items-center gap-2">
        <Checkbox
          id={savedId}
          checked={ticked}
          onCheckedChange={(checked) => {
            setTicked(checked === true);
            setNotTicked(false);
          }}
        />
        <Label htmlFor={savedId}>{RECOVERY_CODE_WORDS.saved}</Label>
      </div>
      <DoneButton
        label={properties.doneLabel}
        unavailable={!ticked || acknowledging}
        refused={shown}
        refusedId={refusedId}
        onDone={done}
      />
    </section>
  );
}
