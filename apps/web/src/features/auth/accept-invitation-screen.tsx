import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { FormEvent, ReactNode } from "react";

import {
  refusalOf,
  useTRPC,
  type ApiError,
  type Refusal,
  type RefusalWord,
} from "@/shared/api/trpc.ts";
import { KeystrokesAct, useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { SummaryRow } from "@/shared/summary-row.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { dayWords } from "@/shared/words.ts";

import { useAcceptInvitation, useSession, useSignOut } from "./auth-hooks.ts";
import { AuthScreen, Outcome, Refused, type Said } from "./auth-screen.tsx";
import { leavingFor } from "./carried-flow.ts";
import { SignOutButton } from "./sign-out-button.tsx";

const JOIN: Keystroke = { key: "j", act: "Join the workspace" };

const SCREEN = "this screen";

const UNTITLED = "Your invitation";

const CONSEQUENCE = "join-consequence";

const READ_REFUSED = "invitation-refused";

const JOIN_REFUSED = "join-refused";

const SAID_OF_WORD = {
  "no-such-invitation": {
    why: "No invitation stands at this link: it was cancelled, replaced by a newer one, or never sent.",
    next: "Ask the Admin who invited you to send a new one.",
  },
  "invitation-expired": {
    why: "This invitation has expired.",
    next: "Ask the Admin who invited you to send it again.",
  },
  "invitation-for-another-address": {
    why: "This invitation was sent to another email address than the one you are signed in with.",
    next: "Sign in with the address it was sent to.",
  },
  "already-a-member": {
    why: "You are already a member of this workspace.",
    next: "Open it from your workspaces.",
  },
  "no-display-name": {
    why: "A workspace credits its members by name, and you have not given one yet.",
    next: "Give a display name, then join.",
  },
} satisfies Partial<Record<RefusalWord, Said>>;

const WORDS = new Map<string, Said>(Object.entries(SAID_OF_WORD));

const REFUSED_OTHERWISE: Said = {
  why: "The platform could not read this invitation link.",
  next: "Open the link in the email again.",
};

const saidOf = (refusal: Refusal): Said => WORDS.get(refusal.word) ?? REFUSED_OTHERWISE;

const aRole = (role: string): string => `${role === "Viewer" ? "a" : "an"} ${role}`;

const displayNameThenBackTo = (here: string): string =>
  `/display-name?redirect=${encodeURIComponent(here)}`;

function SignInWithAnotherAddress(properties: { readonly here: string }) {
  const { signOut, signingOut } = useSignOut(properties.here);
  return (
    <Button type="button" variant="outline" disabled={signingOut} onClick={signOut}>
      Sign in with another address
    </Button>
  );
}

function GoTo(properties: { readonly href: string; readonly children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        void navigate(leavingFor(properties.href));
      }}
    >
      {properties.children}
    </Button>
  );
}

/** The one act a refusal leaves the person, where there is one. */
function WayOn(properties: { readonly failure: Error | ApiError; readonly here: string }) {
  const word = refusalOf(properties.failure)?.word;
  if (word === "invitation-for-another-address") {
    return <SignInWithAnotherAddress here={properties.here} />;
  }
  if (word === "already-a-member") {
    return <GoTo href="/choose-workspace">Go to your workspaces</GoTo>;
  }
  if (word === "no-display-name") {
    return <GoTo href={displayNameThenBackTo(properties.here)}>Give a display name</GoTo>;
  }
  return null;
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
  readonly onRetry: () => void;
}) {
  const unanswered = refusalOf(properties.failure) === undefined;
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
          <Button type="button" variant="outline" onClick={properties.onRetry}>
            Try again
          </Button>
        ) : (
          <WayOn failure={properties.failure} here={properties.here} />
        )}
      </div>
      <Leaving keystrokes={[]} />
    </AuthScreen>
  );
}

type Invitation = {
  readonly workspaceName: string;
  readonly role: string;
  readonly invitedBy: string;
  readonly expiresAt: string;
};

function InvitationToJoin(properties: {
  readonly invitationId: string;
  readonly invitation: Invitation;
  readonly here: string;
}) {
  const { invitation } = properties;
  const address = useSession().data?.user.email;
  const accept = useAcceptInvitation();

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
        <>
          <Refused
            id={JOIN_REFUSED}
            failure={accept.error}
            saidOf={saidOf}
            unanswered="The platform did not answer, so you have not joined. Try again in a moment."
            signInAt={properties.here}
          />
          <div className="mt-4">
            <WayOn failure={accept.error} here={properties.here} />
          </div>
        </>
      )}

      <Leaving keystrokes={[JOIN]} />
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
        onRetry={() => {
          void invitation.refetch();
        }}
      />
    );
  }
  return <InvitationToJoin invitationId={invitationId} invitation={invitation.data} here={here} />;
}
