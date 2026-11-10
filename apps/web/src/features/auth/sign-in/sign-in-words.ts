import { STOCK } from "@/shared/refusal-words.ts";

export type CarriedOn = "joining" | "connecting";

export type Arrival = "signed-out" | "session-ended" | "confirm-timed-out";

type EmailStep = { readonly title: string; readonly hint: string };

const HINT = "Enter your work email address to sign in.";

export const SIGN_IN_WORDS = {
  emailStep: {
    nothing: { title: "Sign in", hint: HINT },
    joining: {
      title: "Sign in to join a workspace",
      hint: "Enter the email address your invitation was sent to.",
    },
    connecting: { title: "Sign in to connect Claude", hint: HINT },
  } satisfies Record<CarriedOn | "nothing", EmailStep>,
  arrived: {
    "signed-out": "You’ve signed out.",
    "session-ended": STOCK.session,
    "confirm-timed-out": "Your sign-in wasn’t confirmed within an hour. Sign in again.",
  } satisfies Record<Arrival, string>,
  emailAddress: "Email address",
  send: "Send code",
  sending: "Sending",
  codeTitle: "Enter your code",
  codeField: "Verification code",
  signIn: "Sign in",
  signingIn: "Signing in",
  sendAgain: "Send a new code",
  otherAddress: "Use a different email address",
  or: "Or",
  passkey: "Sign in with a passkey",
  passkeyWaiting: "Waiting for your passkey…",
  passkeyNotUsed: "No passkey was used. Try again, or sign in by email.",
} as const;

const ENTER_IT = "Enter it below.";

export const codeSent = (address: string): string =>
  `We’ve sent a 6-digit code to ${address}. ${ENTER_IT}`;

export const sendingANewCode = (address: string): string => `Sending a new code to ${address}.`;

export const newCodeSent = (address: string): string =>
  `We’ve sent a new 6-digit code to ${address}. ${ENTER_IT}`;
