import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { inferOutput } from "@trpc/tanstack-react-query";
import type { FormEvent } from "react";

import {
  refusalOf,
  useTRPC,
  type ApiError,
  type Refusal,
  type RefusalWord,
} from "@/shared/api/trpc.ts";
import { KeystrokesAct, useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { aRole } from "@/shared/role-words.ts";
import { SummaryRow } from "@/shared/summary-row.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { dayWords } from "@/shared/words.ts";

import { useAcceptInvitation, useSession, useSignOut } from "./auth-hooks.ts";
import { AuthScreen, Outcome, Refused, type Said } from "./auth-screen.tsx";
import { backTo, leavingFor } from "./carried-flow.ts";
import { SignOutButton } from "./sign-out-button.tsx";

type Invitation = inferOutput<ReturnType<typeof useTRPC>["person"]["invitation"]>;

const JOIN: Keystroke = { key: "j", act: "Join the workspace" };

const READ_AGAIN: Keystroke = { key: "r", act: "Read the invitation again" };

const SCREEN = "this screen";

const UNTITLED = "Your invitation";

const CONSEQUENCE = "join-consequence";

const READ_REFUSED = "invitation-refused";

const JOIN_REFUSED = "join-refused";

/** The one act a refusal leaves the person: a screen to go to, from the path of this page. */
type WayOn = {
  readonly keystroke: Keystroke;
  readonly to: (here: string) => string;

  /** Signed out first, so the sign-in screen can take another address and come back here. */
  readonly signingOutFirst?: true;
};

type Answer = { readonly said: Said; readonly way?: WayOn };

const ANSWER_OF_WORD = {
  "no-such-invitation": {
    said: {
      why: "No invitation stands at this link: it was cancelled, replaced by a newer one, or never sent.",
      next: "Ask the Admin who invited you to send a new one.",
    },
  },
  "invitation-expired": {
    said: {
      why: "This invitation has expired.",
      next: "Ask the Admin who invited you to send it again.",
    },
  },
  "invitation-for-another-address": {
    said: {
      why: "This invitation was sent to another email address than the one you are signed in with.",
      next: "Sign in with the address it was sent to.",
    },
    way: {
      keystroke: { key: "s", act: "Sign in with another address" },
      to: (here) => here,
      signingOutFirst: true,
    },
  },
  "already-a-member": {
    said: {
      why: "You are already a member of this workspace.",
      next: "Open it from your workspaces.",
    },
    way: { keystroke: { key: "w", act: "Go to your workspaces" }, to: () => "/choose-workspace" },
  },
  "no-display-name": {
    said: {
      why: "A workspace credits its members by name, and you have not given one yet.",
      next: "Give a display name, then join.",
    },
    way: {
      keystroke: { key: "d", act: "Give a display name" },
      to: (here) => backTo("/display-name", here),
    },
  },
} satisfies Partial<Record<RefusalWord, Answer>>;

const ANSWERS = new Map<string, Answer>(Object.entries(ANSWER_OF_WORD));

const REFUSED_OTHERWISE: Said = {
  why: "The platform could not read what this page sent.",
  next: "Open the link in the email again.",
};

const saidOf = (refusal: Refusal): Said => ANSWERS.get(refusal.word)?.said ?? REFUSED_OTHERWISE;

const wayOf = (failure: Error | ApiError | null): WayOn | undefined => {
  const word = failure === null ? undefined : refusalOf(failure)?.word;
  return word === undefined ? undefined : ANSWERS.get(word)?.way;
};

function WayOnAct(properties: { readonly way: WayOn; readonly here: string }) {
  const { way, here } = properties;
  const navigate = useNavigate();
  const { signOut, signingOut } = useSignOut(way.to(here));

  const go = () => {
    // Enabled while signing out, so the focus a click gave the button is not dropped.
    if (signingOut) return;
    if (way.signingOutFirst === true) signOut();
    else void navigate(leavingFor(way.to(here)));
  };
  useKeystroke(way.keystroke, go);

  return (
    <Button
      type="button"
      variant="outline"
      className="aria-disabled:opacity-50"
      aria-disabled={signingOut}
      aria-keyshortcuts={way.keystroke.key}
      onClick={go}
    >
      {way.keystroke.act}
    </Button>
  );
}

function ReadAgain(properties: { readonly reading: boolean; readonly onReadAgain: () => void }) {
  const readAgain = () => {
    if (!properties.reading) properties.onReadAgain();
  };
  useKeystroke(READ_AGAIN, readAgain);

  return (
    <Button
      type="button"
      variant="outline"
      className="aria-disabled:opacity-50"
      aria-disabled={properties.reading}
      aria-keyshortcuts={READ_AGAIN.key}
      onClick={readAgain}
    >
      {properties.reading ? "Reading" : "Try again"}
    </Button>
  );
}

function Leaving(properties: { readonly keystrokes: readonly Keystroke[] }) {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-2">
      <SignOutButton />
      <KeystrokesAct screen={SCREEN} keystrokes={properties.keystrokes} />
    </div>
  );
}

function InvitationUnread(properties: {
  readonly failure: Error | ApiError;
  readonly here: string;
  readonly reading: boolean;
  readonly onReadAgain: () => void;
}) {
  const unanswered = refusalOf(properties.failure) === undefined;
  const way = wayOf(properties.failure);
  const keystrokes = unanswered ? [READ_AGAIN] : way === undefined ? [] : [way.keystroke];
  return (
    <AuthScreen title={UNTITLED}>
      <Refused
        id={READ_REFUSED}
        failure={properties.failure}
        saidOf={saidOf}
        unanswered="The invitation could not be read, so nothing changed. Try again in a moment."
        signInAt={properties.here}
      />
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {unanswered ? (
          <ReadAgain reading={properties.reading} onReadAgain={properties.onReadAgain} />
        ) : null}
        {way === undefined ? null : <WayOnAct way={way} here={properties.here} />}
      </div>
      <Leaving keystrokes={keystrokes} />
    </AuthScreen>
  );
}

function InvitationToJoin(properties: {
  readonly invitationId: string;
  readonly invitation: Invitation;
  readonly here: string;
}) {
  const { invitation } = properties;
  const address = useSession().data?.user.email;
  const accept = useAcceptInvitation();
  const way = wayOf(accept.error);

  const join = () => {
    // The button stays enabled while joining, so the focus a click gave it is not dropped.
    if (accept.isPending) return;
    accept.mutate({ invitationId: properties.invitationId });
  };
  useKeystroke(JOIN, join);

  const submitted = (event: FormEvent) => {
    event.preventDefault();
    join();
  };

  const joinAs = `Join ${invitation.workspaceName} as ${aRole(invitation.role)}`;
  return (
    <AuthScreen title={`Join ${invitation.workspaceName}`}>
      <p className="mt-2">
        You are invited to join {invitation.workspaceName} as {aRole(invitation.role)}.
      </p>

      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <SummaryRow term="Invited by">{invitation.invitedBy}</SummaryRow>
        <SummaryRow term="Lasts until">{dayWords(invitation.expiresAt)}</SummaryRow>
        {address === undefined ? null : <SummaryRow term="Signed in as">{address}</SummaryRow>}
      </dl>

      <form onSubmit={submitted} className="mt-6">
        <Button
          type="submit"
          className="aria-disabled:opacity-50"
          aria-disabled={accept.isPending}
          aria-describedby={accept.error === null ? CONSEQUENCE : `${CONSEQUENCE} ${JOIN_REFUSED}`}
          aria-keyshortcuts={JOIN.key}
        >
          {accept.isPending ? "Joining" : joinAs}
        </Button>
        <p id={CONSEQUENCE} className="mt-2 text-muted-foreground">
          You become a member at once, and the workspace&apos;s audit log records that you joined.
        </p>
      </form>

      {accept.error === null ? null : (
        <Refused
          id={JOIN_REFUSED}
          failure={accept.error}
          saidOf={saidOf}
          unanswered="The platform did not answer, so you have not joined. Try again in a moment."
          signInAt={properties.here}
        />
      )}
      {way === undefined ? null : (
        <div className="mt-4">
          <WayOnAct way={way} here={properties.here} />
        </div>
      )}

      <Leaving keystrokes={way === undefined ? [JOIN] : [JOIN, way.keystroke]} />
    </AuthScreen>
  );
}

/**
 * Reached from the invitation email's link. The route has already sent a signed-out or unnamed
 * person on, and brings them back here.
 */
export function AcceptInvitationScreen(properties: { readonly invitationId: string }) {
  const api = useTRPC();
  const { invitationId } = properties;
  const here = `/invitations/${encodeURIComponent(invitationId)}`;
  const invitation = useQuery(api.person.invitation.queryOptions({ invitationId }));

  if (invitation.isPending) {
    return (
      <AuthScreen title={UNTITLED}>
        <Outcome tone="said">Reading the invitation.</Outcome>
      </AuthScreen>
    );
  }
  if (invitation.isError) {
    return (
      <InvitationUnread
        failure={invitation.error}
        here={here}
        reading={invitation.isFetching}
        onReadAgain={() => {
          void invitation.refetch();
        }}
      />
    );
  }
  return <InvitationToJoin invitationId={invitationId} invitation={invitation.data} here={here} />;
}
