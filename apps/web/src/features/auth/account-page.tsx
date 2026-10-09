import { Link, useLocation } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";

import { useBreadcrumbLastPart } from "@/shared/breadcrumb-last-part.ts";
import { KeystrokesAction, usePageKeystrokes, type Keystroke } from "@/shared/keystrokes.tsx";
import { NO_RESPONSE, NO_RESPONSE_TO_A_READ } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";

import {
  AUTHENTICATOR_HEADING,
  AuthenticatorSection,
  RecoveryCodesSection,
  SET_UP,
  type Landing,
  type LandsAt,
} from "./account-sections.tsx";
import {
  ACCOUNT_HEADING,
  ACCOUNT_WORDS,
  ACTION_LANDED,
  PASSKEY_WORDS,
  passkeyNameFor,
} from "./account-words.ts";
import { useSession } from "./auth-hooks.ts";
import { AuthPage, focusOn, Outcome } from "./auth-page.tsx";
import { COPY_KEY } from "./authenticator-part.tsx";
import { passkeysHere, useRemovePasskey, type PasskeyAdded } from "./passkey-hooks.ts";
import {
  ADD_A_PASSKEY,
  ADD_A_PASSKEY_BUTTON,
  PasskeysSection,
  type Passkey,
} from "./passkeys-part.tsx";
import {
  CODES_KEYSTROKES,
  codesUnanswered,
  saidOfAcknowledging,
  type CodesInHand,
} from "./recovery-codes.tsx";
import { PASSKEY_REMOVAL_UNANSWERED, REMOVAL_UNANSWERED } from "./refusal-words.ts";
import {
  FIRST_AUTHENTICATOR,
  NEW_AUTHENTICATOR,
  useAcknowledgeRecoveryCodes,
  useFinishingTheSetup,
  useRemoveAuthenticator,
  useReplaceRecoveryCodes,
  useSecondFactor,
  useStartAuthenticator,
  type AuthenticatorRoutes,
  type CodesIssued,
  type SecondFactorRead,
} from "./second-factor-hooks.ts";
import { READ_AGAIN, readUnanswered, SecondFactorRefused } from "./second-factor-parts.tsx";
import { SignOutButton } from "./sign-out-button.tsx";

const SIGN_IN_HEADING = "sign-in-heading";

const REFUSED = "account-refused";

/** The node an action brings in takes focus as it mounts, since it is not there when the action ends. */
const useLanding = (first: Landing | undefined) => {
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

/** Each action clears what the last one said, so the page speaks of one action at a time. */
const useAccountActions = (
  address: string,
  firstLanding: Landing | undefined,
  routes: AuthenticatorRoutes,
) => {
  const starting = useStartAuthenticator(routes);
  const finishing = useFinishingTheSetup(routes);
  const remove = useRemoveAuthenticator();
  const removePasskey = useRemovePasskey();
  const make = useReplaceRecoveryCodes();
  const acknowledge = useAcknowledgeRecoveryCodes();
  const landing = useLanding(firstLanding);
  const [said, setSaid] = useState<string | undefined>(undefined);
  const [setupOpen, setSetupOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [suggestedName, setSuggestedName] = useState("");
  const [inHand, setInHand] = useState<CodesInHand | undefined>(undefined);

  const begin = () => {
    setSaid(undefined);
    remove.reset();
    removePasskey.reset();
    if (!make.isPending) make.reset();
    acknowledge.reset();
  };

  /** The name is suggested as the add opens, from the browser that will hold the passkey. */
  const toggleAdd = () => {
    if (!addOpen) setSuggestedName(passkeyNameFor(navigator.userAgent));
    setAddOpen(!addOpen);
  };

  const passkeyAdded = (added: PasskeyAdded, name: string) => {
    begin();
    setAddOpen(false);
    setSaid(ACTION_LANDED.passkeyAdded(name, address));
    if (added.recoveryCodes === null) {
      landing.expect(`passkey:${added.passkeyId}`);
      return;
    }
    landing.expect("save-codes");
    setInHand({ codes: added.recoveryCodes, replacing: false, madeAt: added.madeAt });
  };

  const passkeyRenamed = (name: string) => {
    begin();
    setSaid(ACTION_LANDED.passkeyRenamed(name));
  };

  const removeAPasskey = (passkey: Passkey) => {
    begin();
    removePasskey.mutate(
      { passkeyId: passkey.id },
      {
        onSuccess: () => {
          landing.expect("passkeys");
          setSaid(ACTION_LANDED.passkeyRemoved(passkey.name ?? PASSKEY_WORDS.unnamed, address));
        },
      },
    );
  };

  const toggleSetup = () => {
    setSetupOpen(!setupOpen);
    if (!setupOpen && starting.data === undefined && !starting.isPending) starting.mutate();
  };

  const finished = (issued: CodesIssued | null) => {
    begin();
    setSetupOpen(false);
    starting.reset();
    setSaid(ACTION_LANDED.setUp(address));
    if (issued === null) {
      focusOn(AUTHENTICATOR_HEADING);
      return;
    }
    landing.expect("save-codes");
    setInHand({ codes: issued.recoveryCodes, replacing: false, madeAt: issued.madeAt });
  };

  const removeTheAuthenticator = () => {
    begin();
    landing.expect("set-up");
    remove.mutate(undefined, {
      onSuccess: () => {
        setSaid(ACTION_LANDED.removed(address));
      },
      onError: () => {
        landing.expect(undefined);
      },
    });
  };

  const makeCodes = (replacing: boolean) => {
    begin();
    make.mutate(
      { replacing },
      {
        onSuccess: ({ recoveryCodes, madeAt }) => {
          landing.expect("save-codes");
          setInHand({ codes: recoveryCodes, replacing, madeAt });
          setSaid(replacing ? ACTION_LANDED.replaced(address) : ACTION_LANDED.made(address));
        },
      },
    );
  };

  const done = (madeAt: string) => {
    acknowledge.mutate(
      { madeAt },
      {
        onSuccess: () => {
          landing.expect("recovery-codes");
          setInHand(undefined);
        },
      },
    );
  };

  return {
    routes,
    starting,
    finishing,
    remove,
    removePasskey,
    make,
    acknowledge,
    landsAt: landing.at,
    said,
    setupOpen,
    addOpen,
    suggestedName,
    inHand,
    toggleSetup,
    toggleAdd,
    passkeyAdded,
    passkeyRenamed,
    removeAPasskey,
    finished,
    removeTheAuthenticator,
    makeCodes,
    done,
  };
};

type AccountActions = ReturnType<typeof useAccountActions>;

/** A read already drawn stands through a refetch that fails, so only a first read's is said. */
const failureOnThePage = (read: SecondFactorRead, actions: AccountActions) => {
  if (read.data === undefined && read.error !== null) {
    return { failure: read.error, unanswered: NO_RESPONSE_TO_A_READ };
  }
  if (actions.remove.error !== null)
    return { failure: actions.remove.error, unanswered: REMOVAL_UNANSWERED };
  if (actions.removePasskey.error !== null)
    return { failure: actions.removePasskey.error, unanswered: PASSKEY_REMOVAL_UNANSWERED };
  const made = actions.make.error;
  return { failure: made, unanswered: made === null ? NO_RESPONSE : codesUnanswered(made) };
};

/** The opening actions of the passkeys and the authenticator, each offered while it is closed. */
const openingKeystrokes = (
  read: SecondFactorRead,
  actions: AccountActions,
): readonly Keystroke[] => {
  if (read.data === undefined) return [];
  const offersAdd = !actions.addOpen && passkeysHere();
  const offersSetup = !actions.setupOpen && read.data.authenticator !== "set-up";
  return [...(offersAdd ? [ADD_A_PASSKEY] : []), ...(offersSetup ? [SET_UP] : [])];
};

/** In the order the page shows their actions. */
const keystrokesOf = (read: SecondFactorRead, actions: AccountActions): readonly Keystroke[] => {
  const keyShown = actions.setupOpen && actions.starting.data !== undefined;
  return [
    ...(readUnanswered(read) ? [READ_AGAIN] : []),
    ...openingKeystrokes(read, actions),
    ...(keyShown ? [COPY_KEY] : []),
    ...(actions.inHand === undefined ? [] : CODES_KEYSTROKES),
  ];
};

const sameKeys = (one: readonly Keystroke[], other: readonly Keystroke[]): boolean =>
  one.length === other.length && one.every((keystroke, at) => keystroke === other[at]);

/** The same list while its keys are, so the shell registers it once per change, not per draw. */
const useSteadyKeystrokes = (keystrokes: readonly Keystroke[]): readonly Keystroke[] => {
  const [steady, keep] = useState(keystrokes);
  if (!sameKeys(steady, keystrokes)) keep(keystrokes);
  return steady;
};

/** In the shell, whose band holds sign-out and the way on, and whose list holds these keys. */
function InTheShell(properties: {
  readonly keystrokes: readonly Keystroke[];
  readonly children: ReactNode;
}) {
  usePageKeystrokes(useSteadyKeystrokes(properties.keystrokes));
  useBreadcrumbLastPart(ACCOUNT_HEADING);

  return (
    <>
      <h1>{ACCOUNT_HEADING}</h1>
      {properties.children}
    </>
  );
}

/** `framed` in a member's shell; outside it, so a person with no workspace reaches it too. */
export function AccountPage(properties: { readonly framed?: boolean }) {
  const read = useSecondFactor();
  const address = useSession().data?.user.email ?? "";
  const hash = useLocation({ select: (location) => location.hash });
  // A session a code granted must swap the factors, which only the replacing routes do.
  const routes =
    read.data?.thisSession?.setupGranted === true ? NEW_AUTHENTICATOR : FIRST_AUTHENTICATOR;
  const actions = useAccountActions(
    address,
    hash === ADD_A_PASSKEY_BUTTON ? "add-a-passkey" : undefined,
    routes,
  );
  const { failure, unanswered } = failureOnThePage(read, actions);
  const keystrokes = keystrokesOf(read, actions);

  const sections = (
    <section aria-labelledby={SIGN_IN_HEADING} className="mt-8">
      <h2 id={SIGN_IN_HEADING}>{ACCOUNT_WORDS.signIn}</h2>
      <Outcome tone="said">{actions.said}</Outcome>
      <SecondFactorRefused id={REFUSED} read={read} failure={failure} unanswered={unanswered} />

      <PasskeysSection
        held={read.data}
        here={passkeysHere()}
        addOpen={actions.addOpen}
        suggestedName={actions.suggestedName}
        removing={actions.removePasskey.isPending}
        landsAt={actions.landsAt}
        onAddOpen={actions.toggleAdd}
        onAdded={actions.passkeyAdded}
        onRenamed={actions.passkeyRenamed}
        onRemove={actions.removeAPasskey}
      />
      <AuthenticatorSection
        held={read.data}
        setupOpen={actions.setupOpen}
        routes={actions.routes}
        starting={actions.starting}
        finishing={actions.finishing}
        removing={actions.remove.isPending}
        landsAt={actions.landsAt}
        onSetUp={actions.toggleSetup}
        onFinished={actions.finished}
        onRemove={actions.removeTheAuthenticator}
      />
      <RecoveryCodesSection
        held={read.data}
        inHand={actions.inHand}
        address={address}
        making={actions.make.isPending}
        acknowledging={actions.acknowledge.isPending}
        acknowledgeFailure={saidOfAcknowledging(actions.acknowledge.error)}
        landsAt={actions.landsAt}
        onMake={actions.makeCodes}
        onDone={actions.done}
      />
    </section>
  );
  if (properties.framed === true)
    return <InTheShell keystrokes={keystrokes}>{sections}</InTheShell>;

  return (
    <AuthPage title={ACCOUNT_HEADING}>
      {sections}

      <div className="mt-10 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline">
          <Link to="/">{ACCOUNT_WORDS.goOn}</Link>
        </Button>
        <SignOutButton />
        <KeystrokesAction page={ACCOUNT_HEADING} keystrokes={keystrokes} />
      </div>
    </AuthPage>
  );
}
