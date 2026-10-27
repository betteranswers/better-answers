import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { KeystrokesAction, useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { STOCK } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";

import {
  CodeRefused,
  dropTheLinkToken,
  isTooMany,
  linkTokenOnThisPage,
  useDescribeTheLink,
  useSignInByLink,
  type LinkDescribed,
  type SignedInByLink,
} from "./auth-hooks.ts";
import { AuthPage, Outcome, ReadAgain } from "./auth-page.tsx";
import { carriedOnTo, leavingFor } from "./carried-flow.ts";
import { copiedToTheClipboard } from "./clipboard.ts";
import {
  CODE_NOT_COPIED,
  codeShown,
  codeSpelled,
  LINK_ACTIONS,
  LINK_WORDS,
  SIGN_IN_UNCONFIRMED,
  signingInAs,
  worksUntil,
} from "./link-words.ts";
import { saidOfAFailure } from "./refusal-words.ts";
import { useStepAfterSignIn } from "./second-factor-steps.ts";
import { SIGN_IN_WORDS } from "./sign-in-words.ts";

const COPY: Keystroke = { key: "c", action: LINK_ACTIONS.copy };

const READ_AGAIN: Keystroke = { key: "r", action: LINK_ACTIONS.readAgain };

const BACK_TO_SIGN_IN: Keystroke = { key: "s", action: LINK_ACTIONS.backToSignIn };

const REFUSED = "link-refused";

type Bound = Extract<LinkDescribed, { state: "bound" }>;

type Elsewhere = Extract<LinkDescribed, { state: "elsewhere" }>;

type Seen =
  | LinkDescribed
  | { readonly state: "checking" }
  | { readonly state: "unread"; readonly failure: Error };

const DEAD: Seen = { state: "dead" };

const CHECKING: Seen = { state: "checking" };

const linkDied = (failure: Error | null): boolean =>
  failure instanceof CodeRefused && !isTooMany(failure);

type Read = { readonly data: LinkDescribed | undefined; readonly error: Error | null };

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

type Acting = {
  readonly signingIn: boolean;
  readonly signInFailure: Error | null;
  readonly onSignIn: (bound: Bound) => void;
  readonly copied: boolean | undefined;
  readonly onCopy: (code: string) => void;
  readonly reading: boolean;
  readonly onReadAgain: () => void;
  readonly carried: string;
};

type Slots = {
  readonly title: string;
  readonly said: string | null;
  readonly body: ReactNode;
  readonly refused: string | undefined;
  readonly actions: ReactNode;
};

function SignInHere(properties: { readonly signingIn: boolean; readonly onSignIn: () => void }) {
  return (
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

function BackToSignIn(properties: { readonly focused: boolean; readonly carried: string }) {
  const navigate = useNavigate();
  const back = `/sign-in${properties.carried}`;
  useKeystroke(BACK_TO_SIGN_IN, () => {
    void navigate(leavingFor(back));
  });
  // The Sign in button this replaces held focus; a link takes no `autoFocus` from React.
  const focusedOnArrival = useCallback(
    (link: HTMLAnchorElement | null) => {
      if (properties.focused) link?.focus();
    },
    [properties.focused],
  );

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      {/* A plain link: the router would re-serialise a signed query and break its signature. */}
      <Button asChild variant="outline">
        <a ref={focusedOnArrival} href={back} aria-keyshortcuts={BACK_TO_SIGN_IN.key}>
          {LINK_WORDS.backToSignIn}
        </a>
      </Button>
      <KeystrokesAction page={KEYSTROKE_WORDS.thisPage} keystrokes={[BACK_TO_SIGN_IN]} />
    </div>
  );
}

const SIGN_IN_TITLE = SIGN_IN_WORDS.emailStep.nothing.title;

const CHECKING_SLOTS: Slots = {
  title: SIGN_IN_TITLE,
  said: LINK_WORDS.checking,
  body: null,
  refused: undefined,
  actions: null,
};

const unreadSlots = (failure: Error, acting: Acting): Slots => ({
  title: SIGN_IN_TITLE,
  said: null,
  body: null,
  refused: saidOfAFailure(failure, STOCK.tryAgain),
  actions: (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <ReadAgain
        keystroke={READ_AGAIN}
        reading={acting.reading}
        words={LINK_WORDS}
        onReadAgain={acting.onReadAgain}
      />
      <KeystrokesAction page={KEYSTROKE_WORDS.thisPage} keystrokes={[READ_AGAIN]} />
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
      : saidOfAFailure(acting.signInFailure, SIGN_IN_UNCONFIRMED),
  actions: null,
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
  actions: (
    <div className="mt-6">
      <KeystrokesAction page={KEYSTROKE_WORDS.thisPage} keystrokes={[COPY]} />
    </div>
  ),
});

const deadSlots = (acting: Acting): Slots => ({
  title: LINK_WORDS.deadTitle,
  said: LINK_WORDS.dead,
  body: null,
  refused: undefined,
  actions: <BackToSignIn focused={acting.signInFailure !== null} carried={acting.carried} />,
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
      return deadSlots(acting);
  }
};

export function LinkPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const stepAfterSignIn = useStepAfterSignIn();
  const [token] = useState(linkTokenOnThisPage);
  const [clicked, setClicked] = useState<Bound | undefined>(undefined);
  const [copiedIt, setCopiedIt] = useState<boolean | undefined>(undefined);
  const read = useDescribeTheLink(token, clicked === undefined);
  const signIn = useSignInByLink();

  useEffect(dropTheLinkToken, []);

  const landAfterSignIn = (signedIn: SignedInByLink) => {
    queryClient.clear();
    void stepAfterSignIn(signedIn.carried, signedIn.displayNameGiven).then((after) =>
      navigate(leavingFor(after)),
    );
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
      void copiedToTheClipboard(code).then(setCopiedIt);
    },
    reading: read.isFetching,
    onReadAgain: () => {
      void read.refetch();
    },
    carried: clicked?.carried ?? "",
  };

  const slots = slotsOf(seenOf(token, read, clicked, signIn.error), acting);

  return (
    <AuthPage title={slots.title}>
      <Outcome tone="said">{slots.said}</Outcome>
      {slots.body}
      <Outcome tone="refused" id={REFUSED}>
        {slots.refused}
      </Outcome>
      {slots.actions}
    </AuthPage>
  );
}
