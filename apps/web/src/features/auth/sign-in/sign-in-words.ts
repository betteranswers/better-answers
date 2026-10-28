import { STOCK } from "@/shared/refusal-words.ts";

export type CarriedOn = "joining" | "connecting";

export type Arrival = "signed-out" | "session-ended" | "confirm-timed-out";

type EmailStep = { readonly title: string; readonly hint: string };

const HINT = "Enter your work email address to sign in.";

export const SIGN_IN_WORDS = {
  emailStep: {
    nothing: { title: "Sign In", hint: HINT },
    joining: {
      title: "Sign In to Join a Workspace",
      hint: "Enter the email address your invitation was sent to.",
    },
    connecting: { title: "Sign In to Connect Claude", hint: HINT },
  } satisfies Record<CarriedOn | "nothing", EmailStep>,
  arrived: {
    "signed-out": "You have signed out successfully.",
    "session-ended": STOCK.session,
    "confirm-timed-out": "Your sign-in wasn’t confirmed within an hour. Please sign in again.",
  } satisfies Record<Arrival, string>,
  emailField: "Email Address",
  send: "Send Code",
  sending: "Sending",
  codeTitle: "Enter Your Code",
  codeField: "Verification Code",
  signIn: "Sign In",
  signingIn: "Signing In",
  sendAgain: "Send a New Code",
  otherAddress: "Use a Different Email Address",
  or: "Or",
  passkey: "Sign In with a Passkey",
  passkeyWaiting: "Waiting for your passkey.",
  passkeyNotUsed: "No passkey was used. Please try again, or sign in by email.",
} as const;

const ENTER_IT = "Please enter it below.";

export const codeSent = (address: string): string =>
  `We’ve sent a 6-digit code to ${address}. ${ENTER_IT}`;

export const sendingANewCode = (address: string): string =>
  `Sending a new sign-in email to ${address}.`;

export const newCodeSent = (address: string): string =>
  `We’ve sent a new 6-digit code to ${address}. ${ENTER_IT}`;
