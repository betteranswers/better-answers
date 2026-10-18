import { useId, useRef, useState, type Ref } from "react";

import { ActionDialog } from "@/shared/action-dialog.tsx";
import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { Button } from "@/shared/ui/button.tsx";

import {
  ACCOUNT_ACTIONS,
  AUTHENTICATOR_WORDS,
  codesLeft,
  RECOVERY_CODE_WORDS,
} from "./account-words.ts";
import { AuthenticatorSetup } from "./authenticator-part.tsx";
import { RecoveryCodes, type CodesInHand } from "./recovery-codes.tsx";
import { SAID_OF_SECOND_FACTOR } from "./refusal-words.ts";
import type {
  AuthenticatorRoutes,
  CodesIssued,
  SecondFactor,
  StartingTheSetup,
} from "./second-factor-hooks.ts";

export const SET_UP: Keystroke = { key: "s", action: ACCOUNT_ACTIONS.setUp };

export const AUTHENTICATOR_HEADING = "authenticator-heading";

const RECOVERY_CODES_HEADING = "recovery-codes-heading";

export type Landing =
  | "set-up"
  | "save-codes"
  | "recovery-codes"
  | "passkeys"
  | "add-a-passkey"
  | "sessions"
  | `passkey:${string}`
  | `session:${string}`;

export type LandsAt = (landing: Landing) => (node: HTMLElement | null) => void;

export const useLanding = (first: Landing | undefined) => {
  const awaited = useRef<Landing | undefined>(first);
  const at: LandsAt = (landing) => (node) => {
    if (node === null || awaited.current !== landing) return;
    awaited.current = undefined;
    node.focus();
  };
  return {
    at,
    expect: (landing: Landing | undefined) => {
      awaited.current = landing;
    },
  };
};

function ActionKeystroke(properties: {
  readonly keystroke: Keystroke;
  readonly onKey: () => void;
}) {
  useKeystroke(properties.keystroke, properties.onKey);
  return null;
}

export function ActionButton(properties: {
  readonly id?: string;
  readonly unavailable: boolean;
  readonly label: string;
  readonly describedBy?: string | undefined;
  readonly actionRef?: Ref<HTMLButtonElement>;
  readonly className?: string;
  readonly expanded?: boolean;
  readonly controls?: string | undefined;
  readonly keystroke?: Keystroke;
  readonly onAction: () => void;
}) {
  const {
    id,
    unavailable,
    label,
    describedBy,
    actionRef,
    className,
    expanded,
    controls,
    keystroke,
    onAction,
  } = properties;
  const action = () => {
    if (!unavailable) onAction();
  };
  return (
    <>
      <Button
        id={id}
        ref={actionRef}
        type="button"
        variant="outline"
        className={cn("aria-disabled:opacity-50", className)}
        aria-disabled={unavailable}
        aria-describedby={describedBy}
        aria-expanded={expanded}
        aria-controls={controls}
        aria-keyshortcuts={keystroke?.key}
        onClick={action}
      >
        {label}
      </Button>
      {keystroke === undefined ? null : (
        <ActionKeystroke
          keystroke={keystroke}
          onKey={() => {
            if (expanded !== true) action();
          }}
        />
      )}
    </>
  );
}

function NoAuthenticator(properties: {
  readonly setupOpen: boolean;
  readonly routes: AuthenticatorRoutes;
  readonly starting: StartingTheSetup;
  readonly finishing: boolean;
  readonly landsAt: LandsAt;
  readonly onSetUp: () => void;
  readonly onFinished: (issued: CodesIssued | null) => void;
}) {
  const setupId = useId();

  return (
    <>
      <p className="mt-2">{AUTHENTICATOR_WORDS.none}</p>
      <ActionButton
        actionRef={properties.landsAt("set-up")}
        unavailable={properties.finishing}
        label={AUTHENTICATOR_WORDS.setUp}
        className="mt-3"
        expanded={properties.setupOpen}
        controls={properties.setupOpen ? setupId : undefined}
        keystroke={SET_UP}
        onAction={properties.onSetUp}
      />
      {properties.setupOpen ? (
        <AuthenticatorSetup
          id={setupId}
          starting={properties.starting}
          routes={properties.routes}
          onFinished={properties.onFinished}
        />
      ) : null}
    </>
  );
}

export type RemovalWords = {
  readonly remove: string;
  readonly title: string;
  readonly consequence: string;
  readonly commit: string;
};

export function RemoveKeepingTheLast(properties: {
  readonly words: RemovalWords;
  readonly last: boolean;
  readonly removing: boolean;
  readonly reasonClassName?: string;
  readonly onRemove: () => void;
}) {
  const { words } = properties;
  const reasonId = useId();
  const removeRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <ActionButton
        actionRef={removeRef}
        unavailable={properties.last || properties.removing}
        label={words.remove}
        describedBy={properties.last ? reasonId : undefined}
        onAction={() => {
          setConfirming(true);
        }}
      />
      {properties.last ? (
        <p id={reasonId} className={cn("text-muted-foreground", properties.reasonClassName)}>
          {SAID_OF_SECOND_FACTOR["last-second-factor"]}
        </p>
      ) : null}
      <ActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        content={{
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            removeRef.current?.focus();
          },
        }}
        title={words.title}
        consequence={words.consequence}
        commit={
          <Button
            variant="destructive"
            onClick={() => {
              setConfirming(false);
              properties.onRemove();
            }}
          >
            {words.commit}
          </Button>
        }
      />
    </>
  );
}

const AUTHENTICATOR_REMOVAL: RemovalWords = {
  remove: AUTHENTICATOR_WORDS.remove,
  title: AUTHENTICATOR_WORDS.removeTitle,
  consequence: AUTHENTICATOR_WORDS.removeConsequence,
  commit: AUTHENTICATOR_WORDS.removeCommit,
};

function HeldAuthenticator(properties: {
  readonly last: boolean;
  readonly removing: boolean;
  readonly onRemove: () => void;
}) {
  return (
    <>
      <p className="mt-2">{AUTHENTICATOR_WORDS.held}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <RemoveKeepingTheLast words={AUTHENTICATOR_REMOVAL} {...properties} />
      </div>
    </>
  );
}

type AuthenticatorProperties = {
  readonly held: SecondFactor | undefined;
  readonly setupOpen: boolean;
  readonly routes: AuthenticatorRoutes;
  readonly starting: StartingTheSetup;
  readonly finishing: boolean;
  readonly removing: boolean;
  readonly landsAt: LandsAt;
  readonly onSetUp: () => void;
  readonly onFinished: (issued: CodesIssued | null) => void;
  readonly onRemove: () => void;
};

function AuthenticatorState(properties: AuthenticatorProperties & { readonly held: SecondFactor }) {
  const { held } = properties;
  if (held.authenticator !== "set-up") return <NoAuthenticator {...properties} />;
  return (
    <HeldAuthenticator
      last={held.mustHoldOne && held.passkeys.length === 0}
      removing={properties.removing}
      onRemove={properties.onRemove}
    />
  );
}

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
  const actionRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <p className="mt-2 tabular-nums">
        {codesLeft(properties.left.unused, properties.left.madeAt)}
      </p>
      <div className="mt-3">
        <ActionButton
          actionRef={actionRef}
          unavailable={properties.making}
          label={properties.making ? RECOVERY_CODE_WORDS.making : RECOVERY_CODE_WORDS.replace}
          onAction={() => {
            setConfirming(true);
          }}
        />
      </div>
      <ActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        content={{
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            actionRef.current?.focus();
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

function MakeCodes(properties: {
  readonly making: boolean;
  readonly onMake: (replacing: boolean) => void;
}) {
  return (
    <>
      <p className="mt-2">{RECOVERY_CODE_WORDS.none}</p>
      <div className="mt-3">
        <ActionButton
          unavailable={properties.making}
          label={properties.making ? RECOVERY_CODE_WORDS.making : RECOVERY_CODE_WORDS.make}
          onAction={() => {
            properties.onMake(false);
          }}
        />
      </div>
    </>
  );
}

const offersCodes = (held: SecondFactor): boolean =>
  held.recoveryCodes !== undefined || held.authenticator === "set-up" || held.passkeys.length > 0;

export function RecoveryCodesSection(properties: {
  readonly held: SecondFactor | undefined;
  readonly inHand: CodesInHand | undefined;
  readonly address: string;
  readonly making: boolean;
  readonly acknowledging: boolean;
  readonly acknowledgeFailure: string | undefined;
  readonly landsAt: LandsAt;
  readonly onMake: (replacing: boolean) => void;
  readonly onDone: (madeAt: string) => void;
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
