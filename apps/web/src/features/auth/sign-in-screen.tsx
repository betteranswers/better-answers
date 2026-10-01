import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
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
  useSignInEmailOtp,
  type SignedIn,
} from "./auth-hooks.ts";
import { AuthScreen, focusOn, Outcome } from "./auth-screen.tsx";
import { carriedOnTo, leavingFor, nextAfterSignIn, pageQuery } from "./carried-flow.ts";
import {
  CODE_NOT_SENT,
  CODE_REFUSED,
  CODE_UNANSWERED,
  SIGN_IN_UNANSWERED,
  tooManyCodesAskedFor,
  tooManyCodesTried,
} from "./refusal-words.ts";
import { codeSent, newCodeSent, sendingANewCode, SIGN_IN_WORDS } from "./sign-in-words.ts";

const SEND_A_NEW_CODE: Keystroke = { key: "n", act: SIGN_IN_WORDS.sendAgain };

const CHANGE_ADDRESS: Keystroke = { key: "e", act: SIGN_IN_WORDS.otherAddress };

const EMAIL_FIELD = "email";

const CODE_FIELD = "code";

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

const SAID_OF_SIGNING_IN: SaidOfAnAct = {
  tooMany: tooManyCodesTried,
  refused: CODE_REFUSED,
  unanswered: SIGN_IN_UNANSWERED,
};

const saidOf = (act: SaidOfAnAct, failure: Error): Said => {
  if (!(failure instanceof CodeRefused)) return act.unanswered;
  return failure.status === TOO_MANY_REQUESTS ? act.tooMany(failure.waitSeconds) : act.refused;
};

/** Each act clears the other as it starts, so at most one has failed. */
const failureSaid = (sendFailure: Error | null, signInFailure: Error | null): Said | undefined => {
  if (signInFailure !== null) return saidOf(SAID_OF_SIGNING_IN, signInFailure);
  return sendFailure === null ? undefined : saidOf(SAID_OF_SENDING, sendFailure);
};

const saidOfTheCode = (sentTo: string, sending: boolean, resent: boolean): string => {
  if (sending) return sendingANewCode(sentTo);
  return resent ? newCodeSent(sentTo) : codeSent(sentTo);
};

function CodeStepActs(properties: {
  readonly sending: boolean;
  readonly onSendANewCode: () => void;
  readonly onChangeAddress: () => void;
}) {
  useKeystroke(SEND_A_NEW_CODE, properties.onSendANewCode);
  useKeystroke(CHANGE_ADDRESS, properties.onChangeAddress);

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      {/* Enabled while sending, so the focus a click gave the button is not dropped. */}
      <Button
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
        screen={KEYSTROKE_WORDS.thisScreen}
        keystrokes={[SEND_A_NEW_CODE, CHANGE_ADDRESS]}
      />
    </div>
  );
}

export function SignInScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [emailStep] = useState(
    () => SIGN_IN_WORDS.emailStep[carriedOnTo(pageQuery()) ?? "nothing"],
  );
  const arrival = useArrival();
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | undefined>(undefined);
  const [resent, setResent] = useState(false);
  const [arriving, setArriving] = useState(true);

  const sendCode = useSendVerificationOtp();
  const signIn = useSignInEmailOtp();

  /**
   * The query rides along, a connector's signed one included, so that screen sends the person
   * where this one would have.
   */
  const landAfterSignIn = (signedIn: SignedIn) => {
    queryClient.clear();
    const query = pageQuery();
    const next = signedIn.displayNameGiven ? nextAfterSignIn(query) : `/display-name${query}`;
    void navigate(leavingFor(next));
  };

  const askForCode = (event: FormEvent) => {
    event.preventDefault();
    const asked = address.trim();
    if (asked === "") return;
    sendCode.mutate(
      { email: asked, type: "sign-in" },
      {
        onSuccess: () => {
          setSentTo(asked);
          setResent(false);
          setArriving(false);
          setCode("");
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

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    if (sentTo === undefined) return;
    sendCode.reset();
    signIn.mutate({ email: sentTo, otp: code.trim() }, { onSuccess: landAfterSignIn });
  };

  const failure = failureSaid(sendCode.error, signIn.error);
  const described = failure === undefined ? undefined : REFUSED;

  const step =
    sentTo === undefined
      ? {
          title: emailStep.title,
          said: arriving && arrival !== undefined ? SIGN_IN_WORDS.arrived[arrival] : null,
          hint: <p className="mt-2 text-muted-foreground">{emailStep.hint}</p>,
          form: (
            <form onSubmit={askForCode} className="mt-6">
              <Label htmlFor={EMAIL_FIELD}>{SIGN_IN_WORDS.emailField}</Label>
              <Input
                id={EMAIL_FIELD}
                name="email"
                type="email"
                autoComplete="username"
                required
                aria-describedby={described}
                className="mt-2"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
              <Button type="submit" className="mt-4" disabled={sendCode.isPending}>
                {sendCode.isPending ? SIGN_IN_WORDS.sending : SIGN_IN_WORDS.send}
              </Button>
            </form>
          ),
          acts: null,
        }
      : {
          title: SIGN_IN_WORDS.codeTitle,
          said: saidOfTheCode(sentTo, sendCode.isPending, resent),
          hint: null,
          form: (
            <form onSubmit={submitCode} className="mt-6">
              <Label htmlFor={CODE_FIELD}>{SIGN_IN_WORDS.codeField}</Label>
              <Input
                id={CODE_FIELD}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
                aria-describedby={described}
                aria-invalid={failure === CODE_REFUSED}
                className="mt-2"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <Button type="submit" className="mt-4" disabled={signIn.isPending}>
                {signIn.isPending ? SIGN_IN_WORDS.signingIn : SIGN_IN_WORDS.signIn}
              </Button>
            </form>
          ),
          acts: (
            <CodeStepActs
              sending={sendCode.isPending}
              onSendANewCode={() => {
                sendANewCode(sentTo);
              }}
              onChangeAddress={changeAddress}
            />
          ),
        };

  // Each slot keeps its element across the steps, so the code step speaks in the regions that
  // stood and focus stays in the field.
  return (
    <AuthScreen title={step.title}>
      <Outcome tone="said">{step.said}</Outcome>
      {step.hint}
      {step.form}
      <Outcome tone="refused" id={REFUSED}>
        {failure === undefined ? null : <RefusalLine said={failure} />}
      </Outcome>
      {step.acts}
    </AuthScreen>
  );
}
