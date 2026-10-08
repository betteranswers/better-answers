import { useId, useState } from "react";

import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { RefusalLine } from "@/shared/refusal-outcome.tsx";
import { SAID_OF_CLASS, type Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { QRCode } from "@/shared/ui/kibo-ui/qr-code.tsx";

import { ACCOUNT_ACTIONS, AUTHENTICATOR_WORDS } from "./account-words.ts";
import { CodeRefused, SIGNED_OUT, TOO_MANY_REQUESTS } from "./auth-hooks.ts";
import { Outcome } from "./auth-page.tsx";
import {
  AuthenticatorCodeField,
  CODE_WRONG,
  isAWrongCode,
  useSixDigits,
} from "./authenticator-code.tsx";
import { copiedToTheClipboard } from "./clipboard.ts";
import {
  AUTHENTICATOR_HELD,
  FACTORS_CHANGED_MEANWHILE,
  KEY_NOT_COPIED,
  KEY_UNANSWERED,
  NO_SETUP_WAITING,
  REPLACEMENT_SETUP_NEEDED,
  RESTORE_CODE_NEEDED,
  SETUP_CODE_WRONG,
  SETUP_NOT_GRANTED,
  SETUP_REFUSED,
  SETUP_UNANSWERED,
  tooManyCodesTried,
  tooManySetupsStarted,
} from "./refusal-words.ts";
import {
  useFinishAuthenticator,
  type AuthenticatorRoutes,
  type CodesIssued,
  type SetupStarted,
  type StartingTheSetup,
} from "./second-factor-hooks.ts";

export const COPY_KEY: Keystroke = { key: "k", action: ACCOUNT_ACTIONS.copyKey };

const CONFLICT = 409;

/** A setup's own words, read before its status: the replacing routes answer 409 for each. */
const SAID_OF_A_SETUP_WORD: ReadonlyMap<string, Said> = new Map([
  ["setup-not-granted", SETUP_NOT_GRANTED],
  ["restore-code-needed", RESTORE_CODE_NEEDED],
  ["replacement-setup-needed", REPLACEMENT_SETUP_NEEDED],
  ["changed-meanwhile", FACTORS_CHANGED_MEANWHILE],
]);

const saidOfStartingByStatus = (refused: CodeRefused): Said => {
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

const saidOfFinishingByStatus = (refused: CodeRefused): Said => {
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

const saidOfStarting = (refused: CodeRefused): Said =>
  SAID_OF_A_SETUP_WORD.get(refused.word ?? "") ?? saidOfStartingByStatus(refused);

const saidOfFinishing = (refused: CodeRefused): Said =>
  SAID_OF_A_SETUP_WORD.get(refused.word ?? "") ?? saidOfFinishingByStatus(refused);

/** A failure with no status went unanswered. */
const saidOfFailure = (
  failure: Error,
  saidOfRefusal: (refused: CodeRefused) => Said,
  unanswered: Said,
): Said => (failure instanceof CodeRefused ? saidOfRefusal(failure) : unanswered);

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

/** Where a setup finishes, and who hears of a refusal there; the first setup's route by default. */
type Finishing = {
  readonly routes?: AuthenticatorRoutes | undefined;
  readonly onRefused?: ((failure: Error) => void) | undefined;
};

/** The key shown, then the code it makes; keyed by the key, so a new one starts clean. */
function KeyAndCode(
  properties: Finishing & {
    readonly started: SetupStarted;
    readonly onFinished: (issued: CodesIssued | null) => void;
  },
) {
  const fieldId = useId();
  const refusedId = useId();
  const finish = useFinishAuthenticator(properties.onFinished, properties.routes);
  const finishing = finish.isPending || finish.isSuccess;
  const digits = useSixDigits(fieldId, finishing, (code, onRefused) => {
    finish.mutate(code, {
      onError: (failure) => {
        onRefused(failure);
        properties.onRefused?.(failure);
      },
    });
  });

  const failure = finish.error;

  return (
    <>
      <TheKey started={properties.started} />
      <form onSubmit={digits.submit} className="mt-6">
        <AuthenticatorCodeField
          id={fieldId}
          label={AUTHENTICATOR_WORDS.codeField}
          digits={digits}
          readOnly={finishing}
          wrong={isAWrongCode(failure)}
          describedBy={failure === null ? undefined : refusedId}
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
export function AuthenticatorSetup(
  properties: Finishing & {
    readonly id: string;
    readonly starting: StartingTheSetup;
    readonly onFinished: (issued: CodesIssued | null) => void;
  },
) {
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
          routes={properties.routes}
          onRefused={properties.onRefused}
          onFinished={properties.onFinished}
        />
      )}
    </div>
  );
}
