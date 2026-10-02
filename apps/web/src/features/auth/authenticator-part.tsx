import { useId, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

import { AUTHENTICATOR_CODE_LENGTH } from "@better-answers/schema/second-factor";

import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { RefusalLine } from "@/shared/refusal-outcome.tsx";
import { SAID_OF_CLASS, type Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { QRCode } from "@/shared/ui/kibo-ui/qr-code.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { ACCOUNT_ACTS, AUTHENTICATOR_WORDS } from "./account-words.ts";
import { CodeRefused } from "./auth-hooks.ts";
import { Outcome } from "./auth-screen.tsx";
import { copiedToTheClipboard } from "./clipboard.ts";
import { digitsOf, selectTheCode, worthSending } from "./code-entry.ts";
import {
  AUTHENTICATOR_HELD,
  KEY_NOT_COPIED,
  KEY_UNANSWERED,
  NO_SETUP_WAITING,
  SETUP_CODE_WRONG,
  SETUP_REFUSED,
  SETUP_UNANSWERED,
  tooManyCodesTried,
  tooManySetupsStarted,
} from "./refusal-words.ts";
import {
  useFinishAuthenticator,
  type SetupStarted,
  type StartingTheSetup,
} from "./second-factor-hooks.ts";

export const COPY_KEY: Keystroke = { key: "k", act: ACCOUNT_ACTS.copyKey };

const CODE_PATTERN = `[0-9]{${String(AUTHENTICATOR_CODE_LENGTH)}}`;

const CODE_WRONG = 400;

const SIGNED_OUT = 401;

const CONFLICT = 409;

const TOO_MANY_REQUESTS = 429;

const saidOfStarting = (refused: CodeRefused): Said => {
  switch (refused.status) {
    case SIGNED_OUT:
      return SAID_OF_CLASS.unauthenticated;
    case CONFLICT:
      return AUTHENTICATOR_HELD;
    case TOO_MANY_REQUESTS:
      return tooManySetupsStarted(refused.waitSeconds);
    default:
      return SETUP_REFUSED;
  }
};

const saidOfFinishing = (refused: CodeRefused): Said => {
  switch (refused.status) {
    case CODE_WRONG:
      return SETUP_CODE_WRONG;
    case SIGNED_OUT:
      return SAID_OF_CLASS.unauthenticated;
    case CONFLICT:
      return NO_SETUP_WAITING;
    case TOO_MANY_REQUESTS:
      return tooManyCodesTried(refused.waitSeconds);
    default:
      return SETUP_REFUSED;
  }
};

/** The routes answer by status alone; a failure with none went unanswered. */
const saidOfFailure = (
  failure: Error,
  saidOfRefusal: (refused: CodeRefused) => Said,
  unanswered: Said,
): Said => (failure instanceof CodeRefused ? saidOfRefusal(failure) : unanswered);

const isAWrongCode = (failure: Error | null): boolean =>
  failure instanceof CodeRefused && failure.status === CODE_WRONG;

/** Grouped as a phone's keyboard is typed from it; copied whole, with no space. */
const inFours = (key: string): string => key.match(/.{1,4}/g)?.join(" ") ?? key;

function TheKey(properties: { readonly started: SetupStarted }) {
  const { started } = properties;
  const keyId = useId();
  const [copied, setCopied] = useState<boolean | undefined>(undefined);
  const copyKey = () => {
    void copiedToTheClipboard(started.key).then(setCopied);
  };
  useKeystroke(COPY_KEY, copyKey);

  return (
    <>
      <p className="mt-4">{AUTHENTICATOR_WORDS.scan}</p>
      <QRCode
        data={started.setupAddress}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the registry part draws inline SVG markup, which an img element cannot hold
        role="img"
        aria-label={AUTHENTICATOR_WORDS.qrCode}
        className="mt-3 size-40 border border-border bg-background p-2"
      />
      <p className="mt-4">{AUTHENTICATOR_WORDS.orEnterKey}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p id={keyId} className="font-mono tracking-wide wrap-anywhere">
          {inFours(started.key)}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-describedby={keyId}
          aria-keyshortcuts={COPY_KEY.key}
          onClick={copyKey}
        >
          {AUTHENTICATOR_WORDS.copyKey}
        </Button>
      </div>
      <Outcome tone="said">{copied === true ? AUTHENTICATOR_WORDS.keyCopied : null}</Outcome>
      <Outcome tone="refused">
        {copied === false ? <RefusalLine said={KEY_NOT_COPIED} /> : null}
      </Outcome>
    </>
  );
}

/** The key shown, then the code it makes; keyed by the key, so a new one starts clean. */
function KeyAndCode(properties: {
  readonly started: SetupStarted;
  readonly onFinished: (recoveryCodes: readonly string[] | null) => void;
}) {
  const fieldId = useId();
  const refusedId = useId();
  const finish = useFinishAuthenticator(properties.onFinished);
  const [code, setCode] = useState("");
  const [refused, setRefused] = useState<readonly string[]>([]);
  const finishing = finish.isPending || finish.isSuccess;

  const countTheRefusal = (digits: string, failure: Error) => {
    if (!isAWrongCode(failure)) return;
    flushSync(() => {
      setRefused([...refused, digits]);
    });
    selectTheCode(fieldId);
  };

  const finishWith = (digits: string) => {
    if (finishing || !worthSending(digits, refused, AUTHENTICATOR_CODE_LENGTH)) return;
    finish.mutate(digits, {
      onError: (failure) => {
        countTheRefusal(digits, failure);
      },
    });
  };

  const enterCode = (entered: string) => {
    const digits = digitsOf(entered, AUTHENTICATOR_CODE_LENGTH);
    setCode(digits);
    finishWith(digits);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    finishWith(code);
  };

  const failure = finish.error;

  return (
    <>
      <TheKey started={properties.started} />
      {/* No `maxLength`: a browser would cut a pasted `123 456` short before it is read. */}
      <form onSubmit={submit} className="mt-6">
        <Label htmlFor={fieldId}>{AUTHENTICATOR_WORDS.codeField}</Label>
        <Input
          id={fieldId}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern={CODE_PATTERN}
          required
          readOnly={finishing}
          aria-describedby={failure === null ? undefined : refusedId}
          aria-invalid={isAWrongCode(failure)}
          className="mt-2 max-w-48 font-mono tabular-nums"
          value={code}
          onChange={(event) => {
            enterCode(event.target.value);
          }}
        />
        <Button type="submit" className="mt-4" disabled={finishing}>
          {finishing ? AUTHENTICATOR_WORDS.finishing : AUTHENTICATOR_WORDS.finish}
        </Button>
      </form>
      <Outcome tone="refused" id={refusedId}>
        {failure === null ? null : (
          <RefusalLine said={saidOfFailure(failure, saidOfFinishing, SETUP_UNANSWERED)} />
        )}
      </Outcome>
    </>
  );
}

/** The opener holds the start, so a key outlives closing the setup and opening it again. */
export function AuthenticatorSetup(properties: {
  readonly id: string;
  readonly starting: StartingTheSetup;
  readonly onFinished: (recoveryCodes: readonly string[] | null) => void;
}) {
  const { starting } = properties;
  const failure = starting.error;

  return (
    <div id={properties.id} className="mt-2">
      <Outcome tone="said">{starting.isPending ? AUTHENTICATOR_WORDS.making : null}</Outcome>
      <Outcome tone="refused">
        {failure === null ? null : (
          <RefusalLine said={saidOfFailure(failure, saidOfStarting, KEY_UNANSWERED)} />
        )}
      </Outcome>
      {failure === null ? null : (
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => {
            starting.mutate();
          }}
        >
          {AUTHENTICATOR_WORDS.startAgain}
        </Button>
      )}
      {starting.data === undefined ? null : (
        <KeyAndCode
          key={starting.data.key}
          started={starting.data}
          onFinished={properties.onFinished}
        />
      )}
    </div>
  );
}
