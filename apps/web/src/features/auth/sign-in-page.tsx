import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { KeystrokesAct, useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { RefusalLine } from "@/shared/refusal-outcome.tsx";
import type { Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import {
  CodeRefused,
  useArrival,
  useSendVerificationOtp,
  useSession,
  useSignInEmailOtp,
  type SignedIn,
} from "./auth-hooks.ts";
import { AuthPage, focusOn, Outcome } from "./auth-page.tsx";
import { carriedOnTo, leavingFor, pageQuery } from "./carried-flow.ts";
import { codeSpent, digitsOf, selectTheCode, triesLeft, worthSending } from "./code-entry.ts";
import { passkeysHere, usePasskeySignIn } from "./passkey-hooks.ts";
import {
  PasskeyAct,
  saidOfAPasskeySignIn,
  saidWhileSigningInWithAPasskey,
} from "./passkey-sign-in.tsx";
import {
  CODE_NOT_SENT,
  CODE_UNANSWERED,
  codeWrong,
  SIGN_IN_UNANSWERED,
  tooManyCodesAskedFor,
  tooManyCodesTried,
} from "./refusal-words.ts";
import { useStepAfterSignIn } from "./second-factor-steps.ts";
import { hearASignInElsewhere } from "./session-memory.ts";
import {
  codeSent,
  newCodeSent,
  sendingANewCode,
  SIGN_IN_WORDS,
  type Arrival,
} from "./sign-in-words.ts";

const SEND_A_NEW_CODE: Keystroke = { key: "n", act: SIGN_IN_WORDS.sendAgain };

const CHANGE_ADDRESS: Keystroke = { key: "e", act: SIGN_IN_WORDS.otherAddress };

const EMAIL_FIELD = "email";

const CODE_FIELD = "code";

const SEND_AGAIN_BUTTON = "send-a-new-code";

const REFUSED = "sign-in-refused";

const TOO_MANY_REQUESTS = 429;

/** What each act's failure says: past a ceiling, refused otherwise, or never answered. */
type SaidOfAnAct = {
  readonly tooMany: (waitSeconds: number | undefined) => Said;
  readonly refused: Said;
  readonly unanswered: Said;
};

const SAID_OF_SENDING: SaidOfAnAct = {
  tooMany: tooManyCodesAskedFor,
  refused: CODE_NOT_SENT,
  unanswered: CODE_UNANSWERED,
};

const saidOfSigningIn = (left: number): SaidOfAnAct => ({
  tooMany: tooManyCodesTried,
  refused: codeWrong(left),
  unanswered: SIGN_IN_UNANSWERED,
});

/** One reading of a failed act, which the page's words, tries count and styling all follow. */
type Failed =
  | { readonly kind: "unanswered" }
  | { readonly kind: "too-many"; readonly waitSeconds: number | undefined }
  | { readonly kind: "refused"; readonly spent: boolean };

const failedAs = (failure: Error): Failed => {
  if (!(failure instanceof CodeRefused)) return { kind: "unanswered" };
  if (failure.status === TOO_MANY_REQUESTS) {
    return { kind: "too-many", waitSeconds: failure.waitSeconds };
  }
  return { kind: "refused", spent: codeSpent(failure) };
};

const saidOf = (act: SaidOfAnAct, failure: Error): Said => {
  const failed = failedAs(failure);
  if (failed.kind === "too-many") return act.tooMany(failed.waitSeconds);
  return failed.kind === "refused" ? act.refused : act.unanswered;
};

/** Each act clears the other as it starts, so at most one has failed. */
const failureSaid = (
  sendFailure: Error | null,
  signInFailure: Error | null,
  left: number,
): Said | undefined => {
  if (signInFailure !== null) return saidOf(saidOfSigningIn(left), signInFailure);
  return sendFailure === null ? undefined : saidOf(SAID_OF_SENDING, sendFailure);
};

/** A ceiling's refusal says nothing of the code, so it spends none of its tries. */
const isAWrongCode = (failure: Error | null): boolean =>
  failure !== null && failedAs(failure).kind === "refused";

const triesLeftAfter = (refused: readonly string[], failure: Error | null): number => {
  const failed = failure === null ? undefined : failedAs(failure);
  return failed?.kind === "refused" && failed.spent ? 0 : triesLeft(refused.length);
};

const saidOfTheCode = (sentTo: string, sending: boolean, resent: boolean): string => {
  if (sending) return sendingANewCode(sentTo);
  return resent ? newCodeSent(sentTo) : codeSent(sentTo);
};

const saidOnArriving = (arriving: boolean, arrival: Arrival | undefined): string | null =>
  arriving && arrival !== undefined ? SIGN_IN_WORDS.arrived[arrival] : null;

type PasskeyState = { readonly pending: boolean; readonly failure: Error | null };

const saidOnTheEmailStep = (
  passkey: PasskeyState,
  arriving: boolean,
  arrival: Arrival | undefined,
): string | null =>
  saidWhileSigningInWithAPasskey(passkey.pending, passkey.failure) ??
  saidOnArriving(arriving, arrival);

type SessionRead = {
  readonly isError: boolean;
  readonly data:
    | { readonly session: { readonly id: string }; readonly user: { readonly email: string } }
    | null
    | undefined;
};

/** Undefined for a failed read, which keeps whatever it held before and proves nothing. */
const sessionIdOf = (read: SessionRead): string | null | undefined =>
  read.isError ? undefined : (read.data?.session.id ?? null);

/** Until the standing session is known nothing is new, and another address's sign-in is not awaited. */
const isANewSignInOf = (
  read: SessionRead,
  standing: string | null | undefined,
  sentTo: string,
): boolean => {
  const id = sessionIdOf(read);
  return (
    standing !== undefined &&
    typeof id === "string" &&
    id !== standing &&
    read.data?.user.email.toLowerCase() === sentTo.toLowerCase()
  );
};

/**
 * Moves on once another browser tab signs in: on hearing it announced, or on being shown again,
 * having missed the announcement.
 */
function useFollowsASignInElsewhere(waiting: boolean, sentTo: string, follow: () => void) {
  const session = useSession();
  // Signing in again starts here with a session standing, and only a different one is a sign-in.
  const standing = useRef<string | null | undefined>(undefined);
  const readWhatStands = useEffectEvent(() => {
    void session.refetch().then((read) => {
      standing.current = sessionIdOf(read);
    });
  });
  const followIfNew = useEffectEvent((read: SessionRead) => {
    if (waiting && isANewSignInOf(read, standing.current, sentTo)) follow();
  });
  const recheck = useEffectEvent(() => {
    if (!waiting) return;
    // With no standing session read yet there is nothing to compare, so this read becomes it.
    if (standing.current === undefined) readWhatStands();
    else void session.refetch().then(followIfNew);
  });

  useEffect(() => {
    readWhatStands();
    const shown = () => {
      if (document.visibilityState === "visible") recheck();
    };
    document.addEventListener("visibilitychange", shown);
    const stopHearing = hearASignInElsewhere(recheck);
    return () => {
      document.removeEventListener("visibilitychange", shown);
      stopHearing();
    };
  }, []);
}

function CodeStepActs(properties: {
  readonly sending: boolean;
  readonly waiting: boolean;
  readonly sentTo: string;
  readonly onSendANewCode: () => void;
  readonly onChangeAddress: () => void;
  readonly onSignedInElsewhere: () => void;
}) {
  useKeystroke(SEND_A_NEW_CODE, properties.onSendANewCode);
  useKeystroke(CHANGE_ADDRESS, properties.onChangeAddress);
  useFollowsASignInElsewhere(properties.waiting, properties.sentTo, properties.onSignedInElsewhere);

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      {/* Enabled while sending, so the focus a click gave the button is not dropped. */}
      <Button
        id={SEND_AGAIN_BUTTON}
        type="button"
        variant="outline"
        className="aria-disabled:opacity-50"
        aria-disabled={properties.sending}
        aria-keyshortcuts={SEND_A_NEW_CODE.key}
        onClick={properties.onSendANewCode}
      >
        {SIGN_IN_WORDS.sendAgain}
      </Button>
      <Button
        type="button"
        variant="link"
        aria-keyshortcuts={CHANGE_ADDRESS.key}
        onClick={properties.onChangeAddress}
      >
        {SIGN_IN_WORDS.otherAddress}
      </Button>
      <KeystrokesAct
        page={KEYSTROKE_WORDS.thisPage}
        keystrokes={[SEND_A_NEW_CODE, CHANGE_ADDRESS]}
      />
    </div>
  );
}

type Step = {
  readonly title: string;
  readonly said: string | null;
  readonly hint: ReactNode;
  readonly form: ReactNode;
  readonly acts: ReactNode;
};

type EmailStep = {
  readonly words: { readonly title: string; readonly hint: string };
  readonly arrived: string | null;
  readonly address: string;
  readonly sending: boolean;
  readonly described: string | undefined;
  readonly onAddress: (address: string) => void;
  readonly onAsk: (event: FormEvent) => void;
  readonly acts: ReactNode;
};

const emailStepOf = (step: EmailStep): Step => ({
  title: step.words.title,
  said: step.arrived,
  hint: <p className="mt-2 text-muted-foreground">{step.words.hint}</p>,
  form: (
    <form onSubmit={step.onAsk} className="mt-6">
      <Label htmlFor={EMAIL_FIELD}>{SIGN_IN_WORDS.emailField}</Label>
      <Input
        id={EMAIL_FIELD}
        name="email"
        type="email"
        autoComplete="username webauthn"
        required
        aria-describedby={step.described}
        className="mt-2"
        value={step.address}
        onChange={(event) => {
          step.onAddress(event.target.value);
        }}
      />
      <Button type="submit" className="mt-4" disabled={step.sending}>
        {step.sending ? SIGN_IN_WORDS.sending : SIGN_IN_WORDS.send}
      </Button>
    </form>
  ),
  acts: step.acts,
});

type CodeStep = {
  readonly said: string;
  readonly code: string;
  readonly signingIn: boolean;
  readonly wrong: boolean;
  readonly described: string | undefined;
  readonly onCode: (entered: string) => void;
  readonly onSubmit: (event: FormEvent) => void;
  readonly acts: ReactNode;
};

/** No `maxLength`: a browser would cut a pasted `123-456` to `123-45` before it is read. */
const codeStepOf = (step: CodeStep): Step => ({
  title: SIGN_IN_WORDS.codeTitle,
  said: step.said,
  hint: null,
  form: (
    <form onSubmit={step.onSubmit} className="mt-6">
      <Label htmlFor={CODE_FIELD}>{SIGN_IN_WORDS.codeField}</Label>
      <Input
        id={CODE_FIELD}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        required
        readOnly={step.signingIn}
        aria-describedby={step.described}
        aria-invalid={step.wrong}
        className="mt-2"
        value={step.code}
        onChange={(event) => {
          step.onCode(event.target.value);
        }}
      />
      <Button type="submit" className="mt-4" disabled={step.signingIn}>
        {step.signingIn ? SIGN_IN_WORDS.signingIn : SIGN_IN_WORDS.signIn}
      </Button>
    </form>
  ),
  acts: step.acts,
});

export function SignInPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const stepAfterSignIn = useStepAfterSignIn();
  const [emailStep] = useState(
    () => SIGN_IN_WORDS.emailStep[carriedOnTo(pageQuery()) ?? "nothing"],
  );
  const arrival = useArrival();
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | undefined>(undefined);
  const [resent, setResent] = useState(false);
  const [arriving, setArriving] = useState(true);
  const [refused, setRefused] = useState<readonly string[]>([]);

  const sendCode = useSendVerificationOtp();
  const signIn = useSignInEmailOtp();
  const signingIn = signIn.isPending || signIn.isSuccess;
  const left = triesLeftAfter(refused, signIn.error);

  /**
   * The query rides along, a connector's signed one included, so that page sends the person
   * where this one would have.
   */
  const moveOnAfterSignIn = (signedIn: SignedIn) => {
    queryClient.clear();
    void stepAfterSignIn(pageQuery(), signedIn.displayNameGiven).then((next) =>
      navigate(leavingFor(next)),
    );
  };

  const passkey = usePasskeySignIn(sentTo === undefined, moveOnAfterSignIn);
  const [offersAPasskey] = useState(passkeysHere);

  const askForCode = (event: FormEvent) => {
    event.preventDefault();
    const asked = address.trim();
    if (asked === "") return;
    passkey.reset();
    sendCode.mutate(
      { email: asked, type: "sign-in" },
      {
        onSuccess: () => {
          setSentTo(asked);
          setResent(false);
          setArriving(false);
          setCode("");
          setRefused([]);
        },
      },
    );
  };

  const sendANewCode = (to: string) => {
    if (sendCode.isPending) return;
    signIn.reset();
    sendCode.mutate(
      { email: to, type: "sign-in" },
      {
        onSuccess: () => {
          setResent(true);
          setCode("");
          setRefused([]);
          focusOn(CODE_FIELD);
        },
      },
    );
  };

  const changeAddress = () => {
    flushSync(() => {
      setSentTo(undefined);
      sendCode.reset();
      signIn.reset();
    });
    focusOn(EMAIL_FIELD);
  };

  const countTheRefusal = (digits: string, failure: Error) => {
    if (!isAWrongCode(failure)) return;
    const nowRefused = [...refused, digits];
    // Committed before the mutation's own render, so the alert never names a try already spent.
    flushSync(() => {
      setRefused(nowRefused);
    });
    if (triesLeftAfter(nowRefused, failure) === 0) focusOn(SEND_AGAIN_BUTTON);
    else selectTheCode(CODE_FIELD);
  };

  const signInWith = (digits: string) => {
    if (sentTo === undefined || signingIn || left === 0 || !worthSending(digits, refused)) return;
    sendCode.reset();
    signIn.mutate(
      { email: sentTo, otp: digits },
      {
        onSuccess: moveOnAfterSignIn,
        onError: (failure) => {
          countTheRefusal(digits, failure);
        },
      },
    );
  };

  const enterCode = (entered: string) => {
    const digits = digitsOf(entered);
    setCode(digits);
    signInWith(digits);
  };

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    signInWith(code);
  };

  const failure =
    saidOfAPasskeySignIn(passkey.failure) ?? failureSaid(sendCode.error, signIn.error, left);
  const described = failure === undefined ? undefined : REFUSED;

  const step =
    sentTo === undefined
      ? emailStepOf({
          words: emailStep,
          arrived: saidOnTheEmailStep(passkey, arriving, arrival),
          address,
          sending: sendCode.isPending,
          described,
          onAddress: setAddress,
          onAsk: askForCode,
          acts: offersAPasskey ? (
            <PasskeyAct pending={passkey.pending} onSignIn={passkey.signIn} />
          ) : null,
        })
      : codeStepOf({
          said: saidOfTheCode(sentTo, sendCode.isPending, resent),
          code,
          signingIn,
          wrong: isAWrongCode(signIn.error),
          described,
          onCode: enterCode,
          onSubmit: submitCode,
          acts: (
            <CodeStepActs
              sending={sendCode.isPending}
              waiting={!signingIn}
              sentTo={sentTo}
              onSendANewCode={() => {
                sendANewCode(sentTo);
              }}
              onChangeAddress={changeAddress}
              // Nothing here read the name, so the display-name page's own read forwards a named person.
              onSignedInElsewhere={() => {
                moveOnAfterSignIn({ displayNameGiven: false });
              }}
            />
          ),
        });

  // Each slot keeps its element across the steps, so the code step speaks in the regions that
  // stood and focus stays in the field.
  return (
    <AuthPage title={step.title}>
      <Outcome tone="said">{step.said}</Outcome>
      {step.hint}
      {step.form}
      <Outcome tone="refused" id={REFUSED}>
        {failure === undefined ? null : <RefusalLine said={failure} />}
      </Outcome>
      {step.acts}
    </AuthPage>
  );
}
