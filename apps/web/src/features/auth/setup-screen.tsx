import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { KeystrokesAct, type Keystroke } from "@/shared/keystrokes.tsx";

import { ActButton } from "./account-sections.tsx";
import {
  ACCOUNT_WORDS,
  PASSKEY_WORDS,
  passkeyNameFor,
  RECOVERY_CODE_WORDS,
} from "./account-words.ts";
import { CodeRefused, useSession } from "./auth-hooks.ts";
import { AuthScreen, Outcome, Refused } from "./auth-screen.tsx";
import { AuthenticatorSetup, COPY_KEY } from "./authenticator-part.tsx";
import { leavingFor, pageQuery } from "./carried-flow.ts";
import { useAcceptARestoreCode } from "./confirm-hooks.ts";
import { passkeysHere, type PasskeyAdded } from "./passkey-hooks.ts";
import { AddAPasskey } from "./passkeys-part.tsx";
import {
  CODES_KEYSTROKES,
  codesUnanswered,
  RecoveryCodes,
  saidOfAcknowledging,
  type CodesInHand,
} from "./recovery-codes.tsx";
import {
  CODES_UNANSWERED,
  RECOVERY_UNANSWERED,
  RESTORE_CODE_WRONG,
  saidOfASecondFactorRefusal,
} from "./refusal-words.ts";
import {
  FIRST_AUTHENTICATOR,
  NEW_AUTHENTICATOR,
  useAcknowledgeRecoveryCodes,
  useFinishingTheSetup,
  useReplaceRecoveryCodes,
  useSecondFactor,
  useStartAuthenticator,
  type CodesIssued,
  type SecondFactor,
} from "./second-factor-hooks.ts";
import {
  holdsAFactor,
  OneTimeCodeForm,
  PendingFrame,
  sessionOf,
  useArrivalFocus,
  useGoingTo,
} from "./second-factor-parts.tsx";
import { CONFIRM_STEP, stepAfterTheCodes, stepAfterTheFactors } from "./second-factor-steps.ts";
import { SETUP_WORDS } from "./second-factor-words.ts";
import { SignOutButton } from "./sign-out-button.tsx";

const SET_UP_INSTEAD: Keystroke = { key: "s", act: SETUP_WORDS.authenticatorInstead };

/** First: holds none. New: a recovery code granted this session. Restored: by the operator. */
type Variant = "first" | "new" | "restored";

type SettingUp = {
  readonly kind: "setting-up";
  readonly variant: Variant;
  readonly granted: boolean;
};

type Standing = { readonly kind: "elsewhere"; readonly to: string } | SettingUp;

/** A session that holds a factor but no grant must confirm, and setup never shows it. */
const standingOf = (held: SecondFactor, query: string): Standing => {
  const { setupGranted } = sessionOf(held);
  if (held.restoreRequired)
    return { kind: "setting-up", variant: "restored", granted: setupGranted };
  if (setupGranted) return { kind: "setting-up", variant: "new", granted: true };
  if (holdsAFactor(held)) return { kind: "elsewhere", to: `${CONFIRM_STEP}${query}` };
  return { kind: "setting-up", variant: "first", granted: false };
};

const HEADINGS = {
  first: { title: SETUP_WORDS.heading, why: SETUP_WORDS.why },
  new: { title: SETUP_WORDS.newHeading, why: SETUP_WORDS.newWhy },
  restored: { title: SETUP_WORDS.heading, why: SETUP_WORDS.why },
} satisfies Record<Variant, { readonly title: string; readonly why: string }>;

/** Promoted mid-session, the person is told which workspace made them an Admin. */
const whyOf = (held: SecondFactor, variant: Variant): string => {
  const adminOf = held.thisSession?.adminOf ?? null;
  const promotedHere = variant !== "new" && held.promoted && adminOf !== null;
  const why = HEADINGS[variant].why;
  return promotedHere ? `${SETUP_WORDS.nowAnAdmin(adminOf)} ${why}` : why;
};

/** A restored person's ways wait on the restore code; everyone else's are open at once. */
const waysOpen = (standing: Standing | undefined): boolean =>
  standing?.kind === "setting-up" && (standing.variant !== "restored" || standing.granted);

const isNotGranted = (failure: Error): boolean =>
  failure instanceof CodeRefused && failure.word === "setup-not-granted";

const headingRefOnMount = (node: HTMLHeadingElement | null): void => {
  node?.focus();
};

/** The codes as the page itself: its `h1`, then Finish setup and on to the display name. */
function CodesToFinish(properties: { readonly inHand: CodesInHand; readonly query: string }) {
  const navigate = useNavigate();
  const acknowledge = useAcknowledgeRecoveryCodes();
  const address = useSession().data?.user.email ?? "";

  return (
    <AuthScreen>
      <RecoveryCodes
        inHand={properties.inHand}
        address={address}
        acknowledging={acknowledge.isPending || acknowledge.isSuccess}
        failure={saidOfAcknowledging(acknowledge.error)}
        headingRef={headingRefOnMount}
        headingLevel={1}
        doneLabel={RECOVERY_CODE_WORDS.finish}
        onDone={(madeAt) => {
          acknowledge.mutate(
            { madeAt },
            {
              onSuccess: () => {
                void navigate(leavingFor(stepAfterTheCodes(properties.query)));
              },
            },
          );
        }}
      />
      <div className="mt-10 flex flex-wrap items-center gap-2">
        <KeystrokesAct screen={RECOVERY_CODE_WORDS.saveHeading} keystrokes={CODES_KEYSTROKES} />
        <SignOutButton />
      </div>
    </AuthScreen>
  );
}

/** Once per mount, though React may run a mount's effects twice. */
const useOnArrival = (run: () => void) => {
  const arrived = useRef(false);
  const runOnce = useEffectEvent(run);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    runOnce();
  }, []);
};

const keystrokesOf = (ready: boolean, open: boolean, keyShown: boolean): readonly Keystroke[] => {
  if (!ready) return [];
  if (!open) return [SET_UP_INSTEAD];
  return keyShown ? [COPY_KEY] : [];
};

/** The authenticator's disclosure and its start live here, so the keystrokes list follows them. */
const useSetup = (standing: Standing | undefined, onNotGranted: () => void) => {
  const granted = standing?.kind === "setting-up" && standing.granted;
  const routes = granted ? NEW_AUTHENTICATOR : FIRST_AUTHENTICATOR;
  const starting = useStartAuthenticator(routes);
  const [open, setOpen] = useState(() => !passkeysHere());
  const refused = (failure: Error) => {
    if (isNotGranted(failure)) onNotGranted();
  };
  const mint = () => {
    if (starting.data === undefined && !starting.isPending) {
      starting.mutate(undefined, { onError: refused });
    }
  };

  return {
    starting,
    open,
    routes,
    refused,
    mint,
    toggle: () => {
      if (!open) mint();
      setOpen(!open);
    },
    keystrokes: (ready: boolean) => keystrokesOf(ready, open, starting.data !== undefined),
  };
};

type Setup = ReturnType<typeof useSetup>;

/** A passkey first, where one can be made; the authenticator behind its disclosure. */
function SetupWays(properties: {
  readonly setup: Setup;
  readonly onCodes: (codes: readonly string[], madeAt: string) => void;
  readonly onNoCodes: () => void;
}) {
  const { setup } = properties;
  const first = useArrivalFocus();
  const passkeyId = useId();
  const setupId = useId();
  const [here] = useState(passkeysHere);
  const [suggested] = useState(() =>
    typeof navigator === "undefined" ? PASSKEY_WORDS.unnamed : passkeyNameFor(navigator.userAgent),
  );
  const finishing = useFinishingTheSetup(setup.routes);
  // Open from the first draw where no passkey can be made, so the key is minted as it mounts.
  useOnArrival(() => {
    if (setup.open) setup.mint();
  });

  const added = (passkey: PasskeyAdded) => {
    if (passkey.recoveryCodes === null) properties.onNoCodes();
    else properties.onCodes(passkey.recoveryCodes, passkey.madeAt);
  };
  const finished = (issued: CodesIssued | null) => {
    if (issued === null) properties.onNoCodes();
    else properties.onCodes(issued.recoveryCodes, issued.madeAt);
  };

  return (
    <>
      {here ? (
        <div className="mt-6">
          <p>{SETUP_WORDS.passkey}</p>
          <AddAPasskey
            id={passkeyId}
            suggested={suggested}
            commit={SETUP_WORDS.addPasskey}
            focused
            onAdded={added}
            onRefused={setup.refused}
          />
        </div>
      ) : null}
      <ActButton
        actRef={here ? null : first}
        unavailable={finishing}
        label={SETUP_WORDS.authenticatorInstead}
        className="mt-6"
        expanded={setup.open}
        controls={setup.open ? setupId : undefined}
        keystroke={SET_UP_INSTEAD}
        onAct={setup.toggle}
      />
      {setup.open ? (
        <AuthenticatorSetup
          id={setupId}
          starting={setup.starting}
          routes={setup.routes}
          onFinished={finished}
          onRefused={setup.refused}
        />
      ) : null}
    </>
  );
}

/** Asked first after an operator's restore; the ways open once it is accepted. */
function RestoreCode(properties: { readonly held: SecondFactor; readonly granted: boolean }) {
  const accept = useAcceptARestoreCode();
  const first = useArrivalFocus();
  return (
    <>
      <Outcome tone="said">{properties.granted ? SETUP_WORDS.restoreAccepted : null}</Outcome>
      {properties.granted ? null : (
        <OneTimeCodeForm
          label={SETUP_WORDS.restoreField}
          sending={accept}
          saids={{ wrong: RESTORE_CODE_WRONG, unanswered: RECOVERY_UNANSWERED }}
          others={[]}
          waitSecondsAtArrival={properties.held.waits["restore-code"]}
          fieldRef={first}
          onGranted={() => undefined}
        />
      )}
    </>
  );
}

function SettingUpBody(properties: {
  readonly held: SecondFactor;
  readonly settingUp: SettingUp;
  readonly setup: Setup;
  readonly onCodes: (codes: readonly string[], madeAt: string) => void;
  readonly onNoCodes: () => void;
}) {
  const { held, settingUp } = properties;
  return (
    <>
      <p className="mt-2 text-muted-foreground">{whyOf(held, settingUp.variant)}</p>
      {settingUp.variant === "restored" ? (
        <RestoreCode held={held} granted={settingUp.granted} />
      ) : null}
      {waysOpen(settingUp) ? (
        <SetupWays
          setup={properties.setup}
          onCodes={properties.onCodes}
          onNoCodes={properties.onNoCodes}
        />
      ) : null}
    </>
  );
}

/** Codes in hand hold the screen; a refusal of the grant, or a setup with none, moves on. */
const goesTo = (
  standing: Standing | undefined,
  inHand: CodesInHand | undefined,
  goingOn: string | undefined,
): string | undefined => {
  if (inHand !== undefined) return undefined;
  if (goingOn !== undefined) return goingOn;
  return standing?.kind === "elsewhere" ? standing.to : undefined;
};

const settingUpOf = (
  standing: Standing | undefined,
  goingOn: string | undefined,
): SettingUp | undefined =>
  goingOn === undefined && standing?.kind === "setting-up" ? standing : undefined;

/** No skip and no later: the person leaves by setting up a factor, or by signing out. */
export function SetupScreen() {
  const read = useSecondFactor();
  const [query] = useState(pageQuery);
  const [inHand, setInHand] = useState<CodesInHand | undefined>(undefined);
  const [goingOn, setGoingOn] = useState<string | undefined>(undefined);
  const held = read.data;
  const standing = held === undefined ? undefined : standingOf(held, query);
  const setup = useSetup(standing, () => {
    setGoingOn(`${CONFIRM_STEP}${query}`);
  });
  useGoingTo(goesTo(standing, inHand, goingOn));

  if (inHand !== undefined) return <CodesToFinish inHand={inHand} query={query} />;

  const settingUp = settingUpOf(standing, goingOn);
  return (
    <PendingFrame
      title={HEADINGS[settingUp?.variant ?? "first"].title}
      read={read}
      keystrokes={setup.keystrokes(waysOpen(settingUp))}
    >
      {held === undefined || settingUp === undefined ? null : (
        <SettingUpBody
          held={held}
          settingUp={settingUp}
          setup={setup}
          onCodes={(codes, madeAt) => {
            setInHand({ codes, replacing: settingUp.variant === "new", madeAt });
          }}
          onNoCodes={() => {
            setGoingOn(stepAfterTheFactors(held, query));
          }}
        />
      )}
    </PendingFrame>
  );
}

/** Each arrival makes a new set, voiding any unseen one; a reload never shows a set twice. */
export function CodesScreen() {
  const [query] = useState(pageQuery);
  const make = useReplaceRecoveryCodes();
  const refusedId = useId();
  const makeASet = () => {
    make.mutate({ replacing: true });
  };
  useOnArrival(makeASet);

  if (make.data !== undefined) {
    const { recoveryCodes, madeAt, replaced } = make.data;
    return (
      <CodesToFinish inHand={{ codes: recoveryCodes, replacing: replaced, madeAt }} query={query} />
    );
  }

  return (
    <AuthScreen title={RECOVERY_CODE_WORDS.saveHeading}>
      <Outcome tone="said">{make.isPending ? RECOVERY_CODE_WORDS.making : null}</Outcome>
      <Refused
        id={refusedId}
        failure={make.error}
        saidOf={saidOfASecondFactorRefusal}
        unanswered={make.error === null ? CODES_UNANSWERED : codesUnanswered(make.error)}
      />
      {make.error === null ? null : (
        <ActButton
          unavailable={make.isPending}
          label={ACCOUNT_WORDS.tryAgain}
          className="mt-4"
          onAct={makeASet}
        />
      )}
      <div className="mt-10 flex flex-wrap items-center gap-2">
        <SignOutButton />
      </div>
    </AuthScreen>
  );
}
