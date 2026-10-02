import { useId, useRef, useState, type Ref } from "react";

import { ActDialog } from "@/shared/act-dialog.tsx";
import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { sentenceOf, type Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";

import {
  ACCOUNT_ACTS,
  AUTHENTICATOR_WORDS,
  codesLeft,
  RECOVERY_CODE_WORDS,
} from "./account-words.ts";
import { AuthenticatorSetup } from "./authenticator-part.tsx";
import { RecoveryCodes, type CodesInHand } from "./recovery-codes.tsx";
import { SAID_OF_SECOND_FACTOR } from "./refusal-words.ts";
import type { SecondFactor, StartingTheSetup } from "./second-factor-hooks.ts";

export const SET_UP: Keystroke = { key: "s", act: ACCOUNT_ACTS.setUp };

export const AUTHENTICATOR_HEADING = "authenticator-heading";

const RECOVERY_CODES_HEADING = "recovery-codes-heading";

/** Where focus goes once an act's result is drawn: each is a node the act brings in. */
export type Landing = "set-up" | "save-codes" | "recovery-codes";

export type LandsAt = (landing: Landing) => (node: HTMLElement | null) => void;

/** An act's own button, focusable while it cannot run, so focus never drops as it waits. */
function ActButton(properties: {
  readonly unavailable: boolean;
  readonly label: string;
  readonly describedBy?: string | undefined;
  readonly actRef?: Ref<HTMLButtonElement>;
  readonly onAct: () => void;
}) {
  const { unavailable, label, describedBy, actRef, onAct } = properties;
  return (
    <Button
      ref={actRef}
      type="button"
      variant="outline"
      className="aria-disabled:opacity-50"
      aria-disabled={unavailable}
      aria-describedby={describedBy}
      onClick={() => {
        if (!unavailable) onAct();
      }}
    >
      {label}
    </Button>
  );
}

function NoAuthenticator(properties: {
  readonly setupOpen: boolean;
  readonly starting: StartingTheSetup;
  readonly finishing: boolean;
  readonly landsAt: LandsAt;
  readonly onSetUp: () => void;
  readonly onFinished: (recoveryCodes: readonly string[] | null) => void;
}) {
  const setupId = useId();
  useKeystroke(SET_UP, () => {
    if (!properties.setupOpen) properties.onSetUp();
  });

  return (
    <>
      <p className="mt-2">{AUTHENTICATOR_WORDS.none}</p>
      <Button
        ref={properties.landsAt("set-up")}
        type="button"
        variant="outline"
        className="mt-3 aria-disabled:opacity-50"
        aria-disabled={properties.finishing}
        aria-expanded={properties.setupOpen}
        aria-controls={properties.setupOpen ? setupId : undefined}
        aria-keyshortcuts={SET_UP.key}
        onClick={properties.onSetUp}
      >
        {AUTHENTICATOR_WORDS.setUp}
      </Button>
      {properties.setupOpen ? (
        <AuthenticatorSetup
          id={setupId}
          starting={properties.starting}
          onFinished={properties.onFinished}
        />
      ) : null}
    </>
  );
}

/** An Admin's only factor stays: Remove says why beside it rather than after a press. */
function HeldAuthenticator(properties: {
  readonly last: boolean;
  readonly removing: boolean;
  readonly onRemove: () => void;
}) {
  const reasonId = useId();
  const removeRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <p className="mt-2">{AUTHENTICATOR_WORDS.held}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <ActButton
          actRef={removeRef}
          unavailable={properties.last || properties.removing}
          label={AUTHENTICATOR_WORDS.remove}
          describedBy={properties.last ? reasonId : undefined}
          onAct={() => {
            setConfirming(true);
          }}
        />
        {properties.last ? (
          <p id={reasonId} className="text-muted-foreground">
            {sentenceOf(SAID_OF_SECOND_FACTOR["last-second-factor"])}
          </p>
        ) : null}
      </div>
      <ActDialog
        open={confirming}
        onOpenChange={setConfirming}
        content={{
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            removeRef.current?.focus();
          },
        }}
        title={AUTHENTICATOR_WORDS.removeTitle}
        consequence={AUTHENTICATOR_WORDS.removeConsequence}
        commit={
          <Button
            variant="destructive"
            onClick={() => {
              setConfirming(false);
              properties.onRemove();
            }}
          >
            {AUTHENTICATOR_WORDS.removeCommit}
          </Button>
        }
      />
    </>
  );
}

type AuthenticatorProperties = {
  readonly held: SecondFactor | undefined;
  readonly setupOpen: boolean;
  readonly starting: StartingTheSetup;
  readonly finishing: boolean;
  readonly removing: boolean;
  readonly landsAt: LandsAt;
  readonly onSetUp: () => void;
  readonly onFinished: (recoveryCodes: readonly string[] | null) => void;
  readonly onRemove: () => void;
};

/** An unfinished setup holds no authenticator, so it offers a setup as none does. */
function AuthenticatorState(properties: AuthenticatorProperties & { readonly held: SecondFactor }) {
  const { held } = properties;
  if (held.authenticator !== "set-up") return <NoAuthenticator {...properties} />;
  return (
    <HeldAuthenticator
      last={held.mustHoldOne && held.passkeys === 0}
      removing={properties.removing}
      onRemove={properties.onRemove}
    />
  );
}

/** The heading stands while the read is out or has failed; the state comes once it is read. */
export function AuthenticatorSection(properties: AuthenticatorProperties) {
  const { held } = properties;
  return (
    <section aria-labelledby={AUTHENTICATOR_HEADING} className="mt-6">
      <h3 id={AUTHENTICATOR_HEADING} tabIndex={-1} className="font-medium">
        {AUTHENTICATOR_WORDS.heading}
      </h3>
      {held === undefined ? null : <AuthenticatorState {...properties} held={held} />}
    </section>
  );
}

function ReplaceCodes(properties: {
  readonly left: NonNullable<SecondFactor["recoveryCodes"]>;
  readonly making: boolean;
  readonly onMake: (replacing: boolean) => void;
}) {
  const actRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <p className="mt-2 tabular-nums">
        {codesLeft(properties.left.unused, properties.left.madeAt)}
      </p>
      <div className="mt-3">
        <ActButton
          actRef={actRef}
          unavailable={properties.making}
          label={properties.making ? RECOVERY_CODE_WORDS.making : RECOVERY_CODE_WORDS.replace}
          onAct={() => {
            setConfirming(true);
          }}
        />
      </div>
      <ActDialog
        open={confirming}
        onOpenChange={setConfirming}
        content={{
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            actRef.current?.focus();
          },
        }}
        title={RECOVERY_CODE_WORDS.replaceTitle}
        consequence={RECOVERY_CODE_WORDS.replaceConsequence}
        commit={
          <Button
            variant="destructive"
            onClick={() => {
              setConfirming(false);
              properties.onMake(true);
            }}
          >
            {RECOVERY_CODE_WORDS.replaceCommit}
          </Button>
        }
      />
    </>
  );
}

/** Nothing is voided by a first set, so making one asks nothing first. */
function MakeCodes(properties: {
  readonly making: boolean;
  readonly onMake: (replacing: boolean) => void;
}) {
  return (
    <>
      <p className="mt-2">{RECOVERY_CODE_WORDS.none}</p>
      <div className="mt-3">
        <ActButton
          unavailable={properties.making}
          label={properties.making ? RECOVERY_CODE_WORDS.making : RECOVERY_CODE_WORDS.make}
          onAct={() => {
            properties.onMake(false);
          }}
        />
      </div>
    </>
  );
}

/** Codes are offered only to a person holding a second factor for them to stand in for. */
const offersCodes = (held: SecondFactor): boolean =>
  held.recoveryCodes !== undefined || held.authenticator === "set-up" || held.passkeys > 0;

export function RecoveryCodesSection(properties: {
  readonly held: SecondFactor | undefined;
  readonly inHand: CodesInHand | undefined;
  readonly address: string;
  readonly making: boolean;
  readonly acknowledging: boolean;
  readonly acknowledgeFailure: Said | undefined;
  readonly landsAt: LandsAt;
  readonly onMake: (replacing: boolean) => void;
  readonly onDone: () => void;
}) {
  const { held, inHand } = properties;
  if (inHand !== undefined) {
    return (
      <RecoveryCodes
        inHand={inHand}
        address={properties.address}
        acknowledging={properties.acknowledging}
        failure={properties.acknowledgeFailure}
        headingRef={properties.landsAt("save-codes")}
        onDone={properties.onDone}
      />
    );
  }
  if (held === undefined || !offersCodes(held)) return null;

  return (
    <section aria-labelledby={RECOVERY_CODES_HEADING} className="mt-6">
      <h3
        id={RECOVERY_CODES_HEADING}
        ref={properties.landsAt("recovery-codes")}
        tabIndex={-1}
        className="font-medium"
      >
        {RECOVERY_CODE_WORDS.heading}
      </h3>
      {held.recoveryCodes === undefined ? (
        <MakeCodes making={properties.making} onMake={properties.onMake} />
      ) : (
        <ReplaceCodes
          left={held.recoveryCodes}
          making={properties.making}
          onMake={properties.onMake}
        />
      )}
    </section>
  );
}
