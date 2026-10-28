import { useId, useState } from "react";

import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { STOCK, stockWait } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Card } from "@/shared/ui/card.tsx";

import { CodeRefused, isTooMany, SIGNED_OUT, TOO_MANY_REQUESTS } from "../auth-hooks.ts";
import { focusOn, Outcome } from "../auth-page.tsx";
import { pageQuery } from "../carried-flow.ts";
import { DeviceRefused, isCancelled, passkeysHere, type DeviceRefusal } from "../passkey-hooks.ts";
import {
  AUTHENTICATOR_CODE_WRONG,
  NO_PASSKEY_TO_CONFIRM,
  PASSKEY_ASK_EXPIRED,
  PASSKEY_CONFIRM_NOT_VERIFIED,
  PASSKEY_CONFIRM_REFUSED,
  PASSKEY_NOT_YOURS,
  SAID_OF_SECOND_FACTOR,
  type OtherWay,
} from "../refusal-words.ts";
import {
  CONFIRM_STEP,
  RECOVERY_STEP,
  SETUP_STEP,
  stepAfterTheFactors,
} from "../second-factor-steps.ts";
import { AuthenticatorCodeField, isAWrongCode, useSixDigits } from "./authenticator-code.tsx";
import {
  useConfirmByAuthenticator,
  useConfirmByPasskey,
  useSpendARecoveryCode,
} from "./confirm-hooks.ts";
import { useSecondFactor, type SecondFactor } from "./second-factor-hooks.ts";
import {
  CodeOutcomes,
  holdsAFactor,
  OneTimeCodeForm,
  PendingFrame,
  sessionOf,
  StepLink,
  useArrivalFocus,
  useGoingTo,
  useThrottledSend,
  type FocusOnArrival,
} from "./second-factor-parts.tsx";
import {
  CONFIRM_WORDS,
  passkeyThatConfirms,
  PROMOTION_WORDS,
  RECOVERY_WORDS,
} from "./second-factor-words.ts";

const USE_YOUR_PASSKEY: Keystroke = { key: "p", action: CONFIRM_WORDS.passkey };

const TO_THE_CODE: Keystroke = { key: "c", action: CONFIRM_WORDS.toTheCode };

const USE_A_RECOVERY_CODE: Keystroke = { key: "u", action: CONFIRM_WORDS.recoveryCode };

const BACK_TO_CONFIRM: Keystroke = { key: "b", action: RECOVERY_WORDS.instead };

const passkeyHere = (held: SecondFactor): boolean => held.passkeys.length > 0 && passkeysHere();

const authenticatorHeld = (held: SecondFactor): boolean => held.authenticator === "set-up";

const otherWays = (held: SecondFactor, ways: readonly OtherWay[]): readonly OtherWay[] => {
  const holds = {
    passkey: passkeyHere(held),
    authenticator: authenticatorHeld(held),
    "recovery-code": held.recoveryCodes !== undefined,
  } satisfies Record<OtherWay, boolean>;
  return ways.filter((way) => holds[way]);
};

const confirmElsewhere = (
  held: SecondFactor,
  query: string,
  confirmedHere: boolean,
): string | undefined => {
  if (confirmedHere || sessionOf(held).confirmed) return stepAfterTheFactors(held, query);
  if (held.restoreRequired || !holdsAFactor(held)) return `${SETUP_STEP}${query}`;
  return undefined;
};

const recoveryElsewhere = (held: SecondFactor, query: string): string | undefined => {
  if (sessionOf(held).setupGranted || held.restoreRequired) return `${SETUP_STEP}${query}`;
  return sessionOf(held).confirmed ? stepAfterTheFactors(held, query) : undefined;
};

const SAID_OF_THE_DEVICE = {
  cancelled: undefined,
  held: PASSKEY_CONFIRM_REFUSED,
  unverified: PASSKEY_CONFIRM_NOT_VERIFIED,
  failed: PASSKEY_CONFIRM_REFUSED,
} satisfies Record<DeviceRefusal, string | undefined>;

const SAID_OF_A_PASSKEY_WORD: ReadonlyMap<string, string> = new Map([
  ["passkey-not-yours", PASSKEY_NOT_YOURS],
  ["not-verified", PASSKEY_CONFIRM_NOT_VERIFIED],
  ["challenge-gone", PASSKEY_ASK_EXPIRED],
  ["no-passkey", NO_PASSKEY_TO_CONFIRM],
]);

const saidOfThePasskeyRoute = (refused: CodeRefused): string => {
  if (refused.status === SIGNED_OUT) return STOCK.session;
  if (refused.status === TOO_MANY_REQUESTS) return stockWait(refused.waitSeconds);
  return SAID_OF_A_PASSKEY_WORD.get(refused.word ?? "") ?? PASSKEY_CONFIRM_REFUSED;
};

const saidOfConfirmingByPasskey = (failure: Error | null): string | undefined => {
  if (failure === null) return undefined;
  if (failure instanceof DeviceRefused) return SAID_OF_THE_DEVICE[failure.reason];
  return failure instanceof CodeRefused ? saidOfThePasskeyRoute(failure) : STOCK.unconfirmed;
};

const saidWhilePasskeyConfirms = (pending: boolean, failure: Error | null): string | null => {
  if (pending) return CONFIRM_WORDS.passkeyWaiting;
  return isCancelled(failure) ? CONFIRM_WORDS.passkeyNotUsed : null;
};

function PasskeyWay(properties: {
  readonly buttonRef: FocusOnArrival;
  readonly onConfirmed: () => void;
}) {
  const { buttonRef, onConfirmed } = properties;
  const refusedId = useId();
  const confirm = useConfirmByPasskey();
  const pending = confirm.isPending || confirm.isSuccess;
  const said = saidOfConfirmingByPasskey(confirm.error);
  const press = () => {
    if (!pending) confirm.mutate(undefined, { onSuccess: onConfirmed });
  };
  useKeystroke(USE_YOUR_PASSKEY, press);

  return (
    <div className="mt-6">
      <Button
        ref={buttonRef}
        type="button"
        className="aria-disabled:opacity-50"
        aria-disabled={pending}
        aria-describedby={said === undefined ? undefined : refusedId}
        aria-keyshortcuts={USE_YOUR_PASSKEY.key}
        onClick={press}
      >
        {CONFIRM_WORDS.passkey}
      </Button>
      <Outcome tone="said">{saidWhilePasskeyConfirms(confirm.isPending, confirm.error)}</Outcome>
      <Outcome tone="refused" id={refusedId}>
        {said}
      </Outcome>
    </div>
  );
}

const saidOfConfirmingByCode = (failure: Error | null): string | undefined => {
  if (failure === null || isTooMany(failure)) return undefined;
  if (!(failure instanceof CodeRefused)) return STOCK.unconfirmed;
  if (failure.status === SIGNED_OUT) return STOCK.session;
  return failure.word === "no-authenticator" ? STOCK.gone : AUTHENTICATOR_CODE_WRONG;
};

function AuthenticatorWay(properties: {
  readonly primary: boolean;
  readonly fieldRef: FocusOnArrival | undefined;
  readonly waitSecondsAtArrival: number;
  readonly others: readonly OtherWay[];
  readonly onConfirmed: () => void;
}) {
  const { primary, fieldRef, waitSecondsAtArrival, others, onConfirmed } = properties;
  const fieldId = useId();
  const hintId = useId();
  const refusedId = useId();
  const confirm = useConfirmByAuthenticator();
  const { held, said, lifted, refused } = useThrottledSend(
    confirm,
    waitSecondsAtArrival,
    others,
    saidOfConfirmingByCode,
  );
  const digits = useSixDigits(fieldId, held, (code, onRefused) => {
    confirm.mutate(code, {
      onSuccess: onConfirmed,
      onError: (failure) => {
        refused(failure, onRefused);
      },
    });
  });
  useKeystroke(TO_THE_CODE, () => {
    focusOn(fieldId);
  });

  return (
    <form onSubmit={digits.submit} className="mt-6">
      <AuthenticatorCodeField
        id={fieldId}
        label={CONFIRM_WORDS.codeField}
        digits={digits}
        readOnly={held}
        wrong={isAWrongCode(confirm.error)}
        describedBy={said === undefined ? hintId : `${hintId} ${refusedId}`}
        fieldRef={fieldRef}
      />
      <p id={hintId} className="mt-1 text-muted-foreground">
        {CONFIRM_WORDS.codeHint}
      </p>
      <Button
        type="submit"
        variant={primary ? "default" : "outline"}
        className="mt-4 aria-disabled:opacity-50"
        aria-disabled={held}
      >
        {CONFIRM_WORDS.confirm}
      </Button>
      <CodeOutcomes lifted={lifted} said={said} refusedId={refusedId} />
    </form>
  );
}

const whyOf = (held: SecondFactor): string => {
  if (held.operator) return CONFIRM_WORDS.whyTheOperator;
  return held.mustHoldOne ? CONFIRM_WORDS.whyAnAdmin : CONFIRM_WORDS.why;
};

function WhatCanConfirm(properties: { readonly held: SecondFactor }) {
  const { held } = properties;
  const leadId = useId();
  return (
    <Card className="mt-6 p-4">
      <p id={leadId}>{PROMOTION_WORDS.lead}</p>
      <ul aria-labelledby={leadId} className="mt-2 flex flex-col gap-1">
        {held.passkeys.map((passkey) => (
          <li key={passkey.id}>{passkeyThatConfirms(passkey.name, passkey.createdAt)}</li>
        ))}
        {authenticatorHeld(held) ? <li>{PROMOTION_WORDS.authenticator}</li> : null}
      </ul>
      <p className="mt-2 text-muted-foreground">{PROMOTION_WORDS.after}</p>
    </Card>
  );
}

const confirmKeystrokes = (held: SecondFactor): readonly Keystroke[] => [
  ...(passkeyHere(held) ? [USE_YOUR_PASSKEY] : []),
  ...(authenticatorHeld(held) ? [TO_THE_CODE] : []),
  USE_A_RECOVERY_CODE,
];

function ConfirmWays(properties: {
  readonly held: SecondFactor;
  readonly query: string;
  readonly onConfirmed: () => void;
}) {
  const { held, query } = properties;
  const first = useArrivalFocus();
  const passkey = passkeyHere(held);
  const authenticator = authenticatorHeld(held);

  return (
    <>
      <p className="mt-2 text-muted-foreground">{whyOf(held)}</p>
      {held.promoted ? <WhatCanConfirm held={held} /> : null}
      {passkey ? <PasskeyWay buttonRef={first} onConfirmed={properties.onConfirmed} /> : null}
      {authenticator ? (
        <AuthenticatorWay
          primary={!passkey}
          fieldRef={passkey ? undefined : first}
          waitSecondsAtArrival={held.waits.authenticator}
          others={otherWays(held, ["passkey", "recovery-code"])}
          onConfirmed={properties.onConfirmed}
        />
      ) : null}
      <StepLink
        href={`${RECOVERY_STEP}${query}`}
        keystroke={USE_A_RECOVERY_CODE}
        linkRef={passkey || authenticator ? undefined : first}
      />
    </>
  );
}

export function ConfirmPage() {
  const read = useSecondFactor();
  const [query] = useState(pageQuery);
  const [confirmedHere, setConfirmedHere] = useState(false);
  const held = read.data;
  const elsewhere = held === undefined ? undefined : confirmElsewhere(held, query, confirmedHere);
  useGoingTo(elsewhere);

  return (
    <PendingFrame
      title={CONFIRM_WORDS.heading}
      read={read}
      keystrokes={held === undefined ? [] : confirmKeystrokes(held)}
    >
      {held === undefined || elsewhere !== undefined ? null : (
        <ConfirmWays
          held={held}
          query={query}
          onConfirmed={() => {
            setConfirmedHere(true);
          }}
        />
      )}
    </PendingFrame>
  );
}

export function RecoveryPage() {
  const read = useSecondFactor();
  const spend = useSpendARecoveryCode();
  const first = useArrivalFocus();
  const [query] = useState(pageQuery);
  const [granted, setGranted] = useState(false);
  const held = read.data;
  const elsewhere = held === undefined || granted ? undefined : recoveryElsewhere(held, query);
  useGoingTo(granted ? `${SETUP_STEP}${query}` : elsewhere);

  return (
    <PendingFrame title={RECOVERY_WORDS.heading} read={read} keystrokes={[BACK_TO_CONFIRM]}>
      {held === undefined || elsewhere !== undefined ? null : (
        <>
          <p className="mt-2 text-muted-foreground">{RECOVERY_WORDS.why}</p>
          <OneTimeCodeForm
            label={RECOVERY_WORDS.field}
            sending={spend}
            wrong={SAID_OF_SECOND_FACTOR["recovery-code-wrong"]}
            others={otherWays(held, ["passkey", "authenticator"])}
            waitSecondsAtArrival={held.waits["recovery-code"]}
            fieldRef={first}
            onGranted={() => {
              setGranted(true);
            }}
          />
          <StepLink href={`${CONFIRM_STEP}${query}`} keystroke={BACK_TO_CONFIRM} />
          <p className="mt-6 text-muted-foreground">{RECOVERY_WORDS.operator}</p>
        </>
      )}
    </PendingFrame>
  );
}
