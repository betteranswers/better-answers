import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { ceilingLiftsIn, refusalOf, type ApiError, type Refusal } from "@/shared/api/trpc.ts";
import { KeystrokesAct, type Keystroke } from "@/shared/keystrokes.tsx";
import {
  NO_RESPONSE,
  NO_RESPONSE_TO_A_READ,
  saidOfRefusal,
  type Said,
} from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";

import {
  AUTHENTICATOR_HEADING,
  AuthenticatorSection,
  RecoveryCodesSection,
  SET_UP,
  type Landing,
  type LandsAt,
} from "./account-sections.tsx";
import { ACCOUNT_ACTS, ACCOUNT_HEADING, ACCOUNT_WORDS, ACT_LANDED } from "./account-words.ts";
import { useSession } from "./auth-hooks.ts";
import { AuthScreen, focusOn, Outcome, ReadAgain, Refused } from "./auth-screen.tsx";
import { COPY_KEY } from "./authenticator-part.tsx";
import { CODES_KEYSTROKES, type CodesInHand } from "./recovery-codes.tsx";
import {
  CODES_UNANSWERED,
  codesMadeTooOften,
  REMOVAL_UNANSWERED,
  SAID_OF_SECOND_FACTOR,
} from "./refusal-words.ts";
import {
  useAcknowledgeRecoveryCodes,
  useRemoveAuthenticator,
  useReplaceRecoveryCodes,
  useSecondFactor,
  useStartAuthenticator,
  type SecondFactorRead,
} from "./second-factor-hooks.ts";
import { SignOutButton } from "./sign-out-button.tsx";

const READ_AGAIN: Keystroke = { key: "r", act: ACCOUNT_ACTS.readAgain };

const SIGN_IN_HEADING = "sign-in-heading";

const REFUSED = "account-refused";

const saidOf = (refusal: Refusal): Said =>
  saidOfRefusal(SAID_OF_SECOND_FACTOR, refusal.word, refusal.class);

/** A ceiling carries no word, only the wait until it lifts. */
const codesUnanswered = (failure: Error | ApiError): Said => {
  const liftsIn = ceilingLiftsIn(failure);
  return liftsIn === undefined ? CODES_UNANSWERED : codesMadeTooOften(liftsIn);
};

const saidOfAcknowledging = (failure: Error | ApiError | null): Said | undefined => {
  if (failure === null) return undefined;
  const refusal = refusalOf(failure);
  return refusal === undefined ? NO_RESPONSE : saidOf(refusal);
};

/** The node an act brings in takes focus as it mounts, since it is not there when the act ends. */
const useLanding = () => {
  const awaited = useRef<Landing | undefined>(undefined);
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

const madeNow = (): string => new Date().toISOString();

/** Each act clears what the last one said, so the page speaks of one act at a time. */
const useAccountActs = (address: string) => {
  const starting = useStartAuthenticator();
  const remove = useRemoveAuthenticator();
  const make = useReplaceRecoveryCodes();
  const acknowledge = useAcknowledgeRecoveryCodes();
  const landing = useLanding();
  const [said, setSaid] = useState<string | undefined>(undefined);
  const [setupOpen, setSetupOpen] = useState(false);
  const [inHand, setInHand] = useState<CodesInHand | undefined>(undefined);

  const begin = () => {
    setSaid(undefined);
    remove.reset();
    make.reset();
    acknowledge.reset();
  };

  const toggleSetup = () => {
    setSetupOpen(!setupOpen);
    if (!setupOpen && starting.data === undefined && !starting.isPending) starting.mutate();
  };

  const finished = (codes: readonly string[] | null) => {
    begin();
    setSetupOpen(false);
    starting.reset();
    setSaid(ACT_LANDED.setUp(address));
    if (codes === null) {
      focusOn(AUTHENTICATOR_HEADING);
      return;
    }
    landing.expect("save-codes");
    setInHand({ codes, replacing: false, madeAt: madeNow() });
  };

  const removeTheAuthenticator = () => {
    begin();
    landing.expect("set-up");
    remove.mutate(undefined, {
      onSuccess: () => {
        setSaid(ACT_LANDED.removed(address));
      },
      onError: () => {
        landing.expect(undefined);
      },
    });
  };

  const makeCodes = (replacing: boolean) => {
    begin();
    make.mutate(undefined, {
      onSuccess: ({ recoveryCodes }) => {
        landing.expect("save-codes");
        setInHand({ codes: recoveryCodes, replacing, madeAt: madeNow() });
        if (replacing) setSaid(ACT_LANDED.replaced(address));
      },
    });
  };

  const done = () => {
    acknowledge.mutate(undefined, {
      onSuccess: () => {
        landing.expect("recovery-codes");
        setInHand(undefined);
      },
    });
  };

  return {
    starting,
    remove,
    make,
    acknowledge,
    landsAt: landing.at,
    said,
    setupOpen,
    inHand,
    toggleSetup,
    finished,
    removeTheAuthenticator,
    makeCodes,
    done,
  };
};

type AccountActs = ReturnType<typeof useAccountActs>;

/** A read already drawn stands through a refetch that fails, so only a first read's is said. */
const failureOnThePage = (read: SecondFactorRead, acts: AccountActs) => {
  if (read.data === undefined && read.error !== null) {
    return { failure: read.error, unanswered: NO_RESPONSE_TO_A_READ };
  }
  if (acts.remove.error !== null)
    return { failure: acts.remove.error, unanswered: REMOVAL_UNANSWERED };
  const made = acts.make.error;
  return { failure: made, unanswered: made === null ? NO_RESPONSE : codesUnanswered(made) };
};

const unread = (read: SecondFactorRead): boolean =>
  read.data === undefined && read.error !== null && refusalOf(read.error) === undefined;

/** In the order the page shows their acts. */
const keystrokesOf = (read: SecondFactorRead, acts: AccountActs): readonly Keystroke[] => {
  const offersSetup = read.data !== undefined && read.data.authenticator !== "set-up";
  const keyShown = acts.setupOpen && acts.starting.data !== undefined;
  return [
    ...(unread(read) ? [READ_AGAIN] : []),
    ...(offersSetup ? [SET_UP] : []),
    ...(keyShown ? [COPY_KEY] : []),
    ...(acts.inHand === undefined ? [] : CODES_KEYSTROKES),
  ];
};

/** Outside the shell, so a person with no workspace and the operator reach it too. */
export function AccountPage() {
  const read = useSecondFactor();
  const address = useSession().data?.user.email ?? "";
  const acts = useAccountActs(address);
  const { failure, unanswered } = failureOnThePage(read, acts);

  return (
    <AuthScreen title={ACCOUNT_HEADING}>
      <section aria-labelledby={SIGN_IN_HEADING} className="mt-8">
        <h2 id={SIGN_IN_HEADING}>{ACCOUNT_WORDS.signIn}</h2>
        <Outcome tone="said">{acts.said}</Outcome>
        <Refused id={REFUSED} failure={failure} saidOf={saidOf} unanswered={unanswered} />
        {unread(read) ? (
          <ReadAgain
            keystroke={READ_AGAIN}
            reading={read.isFetching}
            words={ACCOUNT_WORDS}
            onReadAgain={() => {
              void read.refetch();
            }}
            className="mt-4"
          />
        ) : null}

        <AuthenticatorSection
          held={read.data}
          setupOpen={acts.setupOpen}
          starting={acts.starting}
          removing={acts.remove.isPending}
          landsAt={acts.landsAt}
          onSetUp={acts.toggleSetup}
          onFinished={acts.finished}
          onRemove={acts.removeTheAuthenticator}
        />
        <RecoveryCodesSection
          held={read.data}
          inHand={acts.inHand}
          address={address}
          making={acts.make.isPending}
          acknowledging={acts.acknowledge.isPending}
          acknowledgeFailure={saidOfAcknowledging(acts.acknowledge.error)}
          landsAt={acts.landsAt}
          onMake={acts.makeCodes}
          onDone={acts.done}
        />
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-2">
        <Button asChild variant="link" className="px-0">
          <Link to="/">{ACCOUNT_WORDS.goOn}</Link>
        </Button>
        <SignOutButton />
        <KeystrokesAct screen={ACCOUNT_HEADING} keystrokes={keystrokesOf(read, acts)} />
      </div>
    </AuthScreen>
  );
}
