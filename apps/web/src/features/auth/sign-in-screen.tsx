import type { BetterFetchError } from "better-auth/client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { useSendVerificationOtp, useSignInEmailOtp, type SignedIn } from "./auth-hooks.ts";
import { AuthScreen, Outcome } from "./auth-screen.tsx";
import { leavingFor, nextAfterSignIn, pageQuery } from "./carried-flow.ts";

const CODE_LIFETIME = "five minutes";

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
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | undefined>(undefined);

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
