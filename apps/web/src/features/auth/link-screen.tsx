import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { KeystrokesAct, useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { RefusalLine } from "@/shared/refusal-outcome.tsx";
import type { Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";

import {
  CodeRefused,
  dropTheLinkToken,
  linkTokenOnThisPage,
  useDescribeTheLink,
  useSignInByLink,
  type LinkDescribed,
  type SignedInByLink,
} from "./auth-hooks.ts";
import { AuthScreen, Outcome, ReadAgain } from "./auth-screen.tsx";
import { carriedOnTo, leavingFor, nextAfterSignIn } from "./carried-flow.ts";
import {
  CODE_NOT_COPIED,
  codeShown,
  codeSpelled,
  LINK_ACTS,
  LINK_UNREAD,
  LINK_WORDS,
  signingInAs,
  worksUntil,
} from "./link-words.ts";
import { SIGN_IN_UNANSWERED, tooManyCodesTried } from "./refusal-words.ts";
import { SIGN_IN_WORDS } from "./sign-in-words.ts";

const COPY: Keystroke = { key: "c", act: LINK_ACTS.copy };

const READ_AGAIN: Keystroke = { key: "r", act: LINK_ACTS.readAgain };

const BACK_TO_SIGN_IN: Keystroke = { key: "s", act: LINK_ACTS.backToSignIn };

const REFUSED = "link-refused";

const TOO_MANY_REQUESTS = 429;

type Bound = Extract<LinkDescribed, { state: "bound" }>;

type Elsewhere = Extract<LinkDescribed, { state: "elsewhere" }>;

type Seen =
  | LinkDescribed
  | { readonly state: "checking" }
  | { readonly state: "unread"; readonly failure: Error };

const DEAD: Seen = { state: "dead" };

const CHECKING: Seen = { state: "checking" };

/** Any other refusal is a link spent since its read, or bound to another browser. */
const isTooMany = (failure: Error): failure is CodeRefused =>
  failure instanceof CodeRefused && failure.status === TOO_MANY_REQUESTS;

const linkDied = (failure: Error | null): boolean =>
  failure instanceof CodeRefused && !isTooMany(failure);

const saidOfFailure = (failure: Error, unanswered: Said): Said =>
  isTooMany(failure) ? tooManyCodesTried(failure.waitSeconds) : unanswered;

type Read = { readonly data: LinkDescribed | undefined; readonly error: Error | null };

/** What the person clicked Sign in on stands: success clears every held read, this one too. */
const seenOf = (
  token: string | undefined,
  read: Read,
  clicked: Bound | undefined,
  signInFailure: Error | null,
): Seen => {
  if (token === undefined || linkDied(signInFailure)) return DEAD;
  if (clicked !== undefined) return clicked;
  if (read.data !== undefined) return read.data;
  return read.error === null ? CHECKING : { state: "unread", failure: read.error };
};

/** What the screen's acts stand on, handed to whichever state is shown. */
type Acting = {
  readonly signingIn: boolean;
  readonly signInFailure: Error | null;
  readonly onSignIn: (bound: Bound) => void;
  readonly copied: boolean | undefined;
  readonly onCopy: (code: string) => void;
  readonly reading: boolean;
  readonly onReadAgain: () => void;
};

type Slots = {
  readonly title: string;
  readonly said: string | null;
  readonly body: ReactNode;
  readonly refused: Said | undefined;
  readonly acts: ReactNode;
};

function SignInHere(properties: { readonly signingIn: boolean; readonly onSignIn: () => void }) {
  return (
    // Enabled while signing in, so the focus the page gave the button is not dropped.
    <Button
      type="button"
      className="mt-6 aria-disabled:opacity-50"
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- the person opened the link to press this, so Enter does
      autoFocus
      aria-disabled={properties.signingIn}
      onClick={properties.onSignIn}
    >
      {properties.signingIn ? SIGN_IN_WORDS.signingIn : SIGN_IN_WORDS.signIn}
    </Button>
  );
}

function CodeToType(properties: {
  readonly elsewhere: Elsewhere;
  readonly copied: boolean;
  readonly onCopy: () => void;
}) {
  const { code, until } = properties.elsewhere;
  useKeystroke(COPY, properties.onCopy);

  return (
    <>
      <p className="mt-6 font-mono text-4xl font-medium tracking-wide tabular-nums">
        <span aria-hidden="true">{codeShown(code)}</span>
        <span className="sr-only">{codeSpelled(code)}</span>
      </p>
      <p className="mt-2 text-muted-foreground">{worksUntil(until)}</p>
      <Button
        type="button"
        variant="outline"
        className="mt-4"
        aria-keyshortcuts={COPY.key}
        onClick={properties.onCopy}
      >
        {LINK_WORDS.copy}
      </Button>
      <Outcome tone="said">{properties.copied ? LINK_WORDS.copied : null}</Outcome>
      <p className="mt-6">
        <strong className="font-medium">
          <span className="sr-only">{LINK_WORDS.warning} </span>
          {LINK_WORDS.neverShare}
        </strong>
      </p>
    </>
  );
}

function BackToSignIn(properties: { readonly focused: boolean }) {
  const navigate = useNavigate();
  useKeystroke(BACK_TO_SIGN_IN, () => {
    void navigate({ to: "/sign-in" });
  });
  // The Sign in button this replaces held focus; a link takes no `autoFocus` from React.
  const focusedOnArrival = useCallback(
    (link: HTMLAnchorElement | null) => {
      if (properties.focused) link?.focus();
    },
    [properties.focused],
  );

  return (
    <div className="mt-6 flex flex-wrap items-center gap-4">
      <Link
        ref={focusedOnArrival}
        to="/sign-in"
        className="text-brand underline"
        aria-keyshortcuts={BACK_TO_SIGN_IN.key}
      >
        {LINK_WORDS.backToSignIn}
      </Link>
      <KeystrokesAct screen={KEYSTROKE_WORDS.thisScreen} keystrokes={[BACK_TO_SIGN_IN]} />
    </div>
  );
}

const SIGN_IN_TITLE = SIGN_IN_WORDS.emailStep.nothing.title;

const CHECKING_SLOTS: Slots = {
  title: SIGN_IN_TITLE,
  said: LINK_WORDS.checking,
  body: null,
  refused: undefined,
  acts: null,
};

const unreadSlots = (failure: Error, acting: Acting): Slots => ({
  title: SIGN_IN_TITLE,
  said: null,
  body: null,
  refused: saidOfFailure(failure, LINK_UNREAD),
  // The fragment is gone from the address, so a reload would show the dead page.
  acts: (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <ReadAgain
        keystroke={READ_AGAIN}
        reading={acting.reading}
        words={LINK_WORDS}
        onReadAgain={acting.onReadAgain}
      />
      <KeystrokesAct screen={KEYSTROKE_WORDS.thisScreen} keystrokes={[READ_AGAIN]} />
    </div>
  ),
});

const boundSlots = (bound: Bound, acting: Acting): Slots => ({
  title: SIGN_IN_WORDS.emailStep[carriedOnTo(bound.carried) ?? "nothing"].title,
  said: signingInAs(bound.address),
  body: (
    <SignInHere
      signingIn={acting.signingIn}
      onSignIn={() => {
        acting.onSignIn(bound);
      }}
    />
  ),
  refused:
    acting.signInFailure === null
      ? undefined
      : saidOfFailure(acting.signInFailure, SIGN_IN_UNANSWERED),
  acts: null,
});

const elsewhereSlots = (elsewhere: Elsewhere, acting: Acting): Slots => ({
  title: LINK_WORDS.elsewhereTitle,
  said: LINK_WORDS.elsewhere,
  body: (
    <CodeToType
      elsewhere={elsewhere}
      copied={acting.copied === true}
      onCopy={() => {
        acting.onCopy(elsewhere.code);
      }}
    />
  ),
  refused: acting.copied === false ? CODE_NOT_COPIED : undefined,
  acts: (
    <div className="mt-6">
      <KeystrokesAct screen={KEYSTROKE_WORDS.thisScreen} keystrokes={[COPY]} />
    </div>
  ),
});

const deadSlots = (afterSignIn: boolean): Slots => ({
  title: LINK_WORDS.deadTitle,
  said: LINK_WORDS.dead,
  body: null,
  refused: undefined,
  acts: <BackToSignIn focused={afterSignIn} />,
});

const slotsOf = (seen: Seen, acting: Acting): Slots => {
  switch (seen.state) {
    case "checking":
      return CHECKING_SLOTS;
    case "unread":
      return unreadSlots(seen.failure, acting);
    case "bound":
      return boundSlots(seen, acting);
    case "elsewhere":
      return elsewhereSlots(seen, acting);
    case "dead":
      return deadSlots(acting.signInFailure !== null);
  }
};

/** Written whole on the clipboard, with no space, so it pastes into the code field as it is. */
const copied = (code: string): Promise<boolean> =>
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(code))
    .then(
      () => true,
      () => false,
    );

/**
 * Signs in only the browser that asked for the code, and only on a click, so a scanner opening
 * the link changes nothing.
 */
export function LinkScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [token] = useState(linkTokenOnThisPage);
  const [clicked, setClicked] = useState<Bound | undefined>(undefined);
  const [copiedIt, setCopiedIt] = useState<boolean | undefined>(undefined);
  const read = useDescribeTheLink(token, clicked === undefined);
  const signIn = useSignInByLink();

  // The browser's history is outside React; the token leaves it once this page has read it.
  useEffect(dropTheLinkToken, []);

  const landAfterSignIn = (signedIn: SignedInByLink) => {
    queryClient.clear();
    const { carried } = signedIn;
    const next = signedIn.displayNameGiven ? nextAfterSignIn(carried) : `/display-name${carried}`;
    void navigate(leavingFor(next));
  };

  const acting: Acting = {
    signingIn: signIn.isPending || signIn.isSuccess,
    signInFailure: signIn.error,
    onSignIn: (bound) => {
      if (token === undefined || signIn.isPending || signIn.isSuccess) return;
      setClicked(bound);
      signIn.mutate(token, { onSuccess: landAfterSignIn });
    },
    copied: copiedIt,
    onCopy: (code) => {
      void copied(code).then(setCopiedIt);
    },
    reading: read.isFetching,
    onReadAgain: () => {
      void read.refetch();
    },
  };

  const slots = slotsOf(seenOf(token, read, clicked, signIn.error), acting);

  // Each slot keeps its element across the states, so each new state speaks in the regions that
  // stood.
  return (
    <AuthScreen title={slots.title}>
      <Outcome tone="said">{slots.said}</Outcome>
      {slots.body}
      <Outcome tone="refused" id={REFUSED}>
        {slots.refused === undefined ? null : <RefusalLine said={slots.refused} />}
      </Outcome>
      {slots.acts}
    </AuthScreen>
  );
}
