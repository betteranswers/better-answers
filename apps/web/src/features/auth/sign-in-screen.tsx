import type { BetterFetchError } from "better-auth/client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { useSendVerificationOtp, useSignInEmailOtp } from "./auth-hooks.ts";
import { AuthScreen, Outcome } from "./auth-screen.tsx";
import { carriedFlow, safeReturnPath } from "./carried-flow.ts";

/**
 * Sign in with a six-digit code, in two steps: the address, then the code sent to it.
 * There is no password, no sign-up and no social provider anywhere on this screen,
 * because there is none in the product (ADR 0009): a person exists because an Admin
 * added them to a workspace.
 *
 * The two acts are the module's own mutations (`auth-hooks.ts`) over Better Auth's
 * endpoints; the words are the platform's. Every outcome the person could not predict is said in a sentence —
 * that a code was sent, that it did not work, that too many have been asked for — and
 * each sits in a live region so a screen reader hears it (`[A11Y1]`, `[UX2]`).
 *
 * WCAG 2.2 AA, checked with a keyboard and a screen reader.
 */

/** How long a code lasts, as the api mints it (`EMAIL_CODE_LIFETIME_SECONDS`). */
const CODE_LIFETIME = "five minutes";

/** What the counters answer with when an address has been asked about too often. */
const TOO_MANY_REQUESTS = 429;

const TOO_MANY =
  "Too many codes have been asked for. Wait a few minutes before asking for another.";

const couldNotSend = (error: BetterFetchError): string =>
  error.status === TOO_MANY_REQUESTS ? TOO_MANY : "We could not send a code. Try again.";

const didNotWork = (error: BetterFetchError): string =>
  error.status === TOO_MANY_REQUESTS
    ? TOO_MANY
    : "That code did not work. Check it and try again, or ask for a new one.";

export function SignInScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | undefined>(undefined);

  const sendCode = useSendVerificationOtp();
  const signIn = useSignInEmailOtp();

  /**
   * Where a signed-in person goes. A host's OAuth flow is carried on to the picker, which
   * is the screen that resumes it; an ended session returns the person to the address they
   * were reading; anyone else lands in the shell.
   */
  const landAfterSignIn = () => {
    // Everything in the cache was read as whoever was here before — including the refusal
    // that sent this person to sign in. Left in place, the shell would read that refusal
    // again and send them straight back.
    queryClient.clear();
    const carried = carriedFlow(search);
    if (carried !== "") {
      void navigate({ href: `/choose-workspace${carried}`, replace: true });
      return;
    }
    const back = safeReturnPath(new URLSearchParams(search).get("redirect"));
    void navigate({ href: back ?? "/", replace: true });
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
          setCode("");
        },
      },
    );
  };

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    if (sentTo === undefined) return;
    signIn.mutate({ email: sentTo, otp: code.trim() }, { onSuccess: landAfterSignIn });
  };

  if (sentTo === undefined) {
    return (
      <AuthScreen title="Sign in">
        <p className="mt-2 text-muted-foreground">
          Enter your work email address. We will send you a six-digit code.
        </p>

        <form onSubmit={askForCode} className="mt-6">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            className="mt-2"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
          <Button type="submit" className="mt-4" disabled={sendCode.isPending}>
            {sendCode.isPending ? "Sending" : "Send code"}
          </Button>
        </form>

        {sendCode.error === null ? null : (
          <Outcome tone="refused">{couldNotSend(sendCode.error)}</Outcome>
        )}
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="Enter your code">
      <Outcome tone="said">
        We have sent a six-digit code to {sentTo}. It is valid for {CODE_LIFETIME}.
      </Outcome>

      <form onSubmit={submitCode} className="mt-6">
        <Label htmlFor="code">Code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          required
          className="mt-2"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <Button type="submit" className="mt-4" disabled={signIn.isPending}>
          {signIn.isPending ? "Signing in" : "Sign in"}
        </Button>
      </form>

      {signIn.error === null ? null : <Outcome tone="refused">{didNotWork(signIn.error)}</Outcome>}

      <Button
        type="button"
        variant="link"
        className="mt-6 px-0"
        onClick={() => {
          setSentTo(undefined);
          sendCode.reset();
          signIn.reset();
        }}
      >
        Use a different email address
      </Button>
    </AuthScreen>
  );
}
