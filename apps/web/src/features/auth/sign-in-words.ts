/** What a sign-in carries the person on to once it is done, when it carries anything. */
export type CarriedOn = "joining" | "connecting";

/** Why the person is on the sign-in screen, when this browser knows. */
export type Arrival = "signed-out" | "session-ended";

type EmailStep = { readonly title: string; readonly hint: string };

const CODE_LIFETIME = "five minutes";

const HINT = "Enter your work email address to get a six-digit code.";

export const SIGN_IN_WORDS = {
  emailStep: {
    nothing: { title: "Sign in", hint: HINT },
    joining: {
      title: "Sign in to join a workspace",
      hint: "Enter the email address your invitation was sent to. You'll get a six-digit code.",
    },
    connecting: { title: "Sign in to connect Claude", hint: HINT },
  } satisfies Record<CarriedOn | "nothing", EmailStep>,
  arrived: {
    "signed-out": "You have signed out.",
    "session-ended": "Your session has ended.",
  } satisfies Record<Arrival, string>,
  emailField: "Email address",
  send: "Send code",
  sending: "Sending",
  codeTitle: "Enter your code",
  codeField: "Code",
  signIn: "Sign in",
  signingIn: "Signing in",
  sendAgain: "Send a new code",
  otherAddress: "Use a different email address",
} as const;

export const codeSent = (address: string): string =>
  `Code sent to ${address}. It works for ${CODE_LIFETIME}.`;

export const sendingANewCode = (address: string): string => `Sending a new code to ${address}.`;

export const newCodeSent = (address: string): string =>
  `New code sent to ${address}. It works for ${CODE_LIFETIME}.`;
