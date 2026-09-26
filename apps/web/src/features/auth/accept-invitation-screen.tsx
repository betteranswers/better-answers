import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { useState, type FormEvent } from "react";

import {
  refusalOf,
  useTRPC,
  type ApiError,
  type Refusal,
  type RefusalWord,
} from "@/shared/api/trpc.ts";
import { DISPLAY_NAME_REFUSED, DISPLAY_NAME_WORDS } from "@/shared/display-name-words.ts";
import { KeystrokesAct, useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { saidOfRefusal, type Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import {
  hasADisplayName,
  useAcceptInvitation,
  useSession,
  useSetDisplayName,
  useSignOut,
} from "./auth-hooks.ts";
import { AuthScreen, Outcome, Refused } from "./auth-screen.tsx";
import { invitationAt, leavingFor } from "./carried-flow.ts";
import { INVITATION_ACTS, INVITATION_WORDS } from "./invitation-words.ts";
import { INVITATION_UNANSWERED, JOIN_UNANSWERED, SAID_OF_ACCEPTING } from "./refusal-words.ts";
import { SignOutButton } from "./sign-out-button.tsx";

type Invitation = inferOutput<ReturnType<typeof useTRPC>["person"]["invitation"]>;

const JOIN: Keystroke = { key: "j", act: INVITATION_ACTS.join };

const READ_AGAIN: Keystroke = { key: "r", act: INVITATION_ACTS.readAgain };

const SCREEN = "this screen";

const READ_REFUSED = "invitation-refused";

const JOIN_REFUSED = "join-refused";

const NAME_FIELD = "display-name";

const NAME_HINT = "display-name-hint";

const NAME_REFUSED = "display-name-refused";

/** The one act a refusal leaves the person: a screen to go to, from the path of this page. */
type WayOn = {
  readonly keystroke: Keystroke;
  readonly to: (here: string) => string;

  /** Signed out first, so the sign-in screen can take another address and come back here. */
  readonly signingOutFirst?: true;
};

const WAY_OF_WORD = {
  "invitation-for-another-address": {
    keystroke: { key: "s", act: INVITATION_ACTS.anotherAddress },
    to: (here) => here,
    signingOutFirst: true,
  },
  "already-a-member": {
    keystroke: { key: "w", act: INVITATION_ACTS.yourWorkspaces },
    to: () => "/choose-workspace",
  },
} satisfies Partial<Record<RefusalWord, WayOn>>;

const WAYS = new Map<string, WayOn>(Object.entries(WAY_OF_WORD));

const saidOf = (refusal: Refusal): Said =>
  saidOfRefusal(SAID_OF_ACCEPTING, refusal.word, refusal.class);

const nameSaidOf = (refusal: Refusal): Said =>
  saidOfRefusal(DISPLAY_NAME_REFUSED, refusal.word, refusal.class);

const wayOf = (failure: Error | ApiError | null): WayOn | undefined => {
  const word = failure === null ? undefined : refusalOf(failure)?.word;
  return word === undefined ? undefined : WAYS.get(word);
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
      {properties.reading ? INVITATION_WORDS.readingAgain : INVITATION_WORDS.tryAgain}
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
    <AuthScreen title={INVITATION_WORDS.untitled}>
      <Refused
        id={READ_REFUSED}
        failure={properties.failure}
        saidOf={saidOf}
        unanswered={INVITATION_UNANSWERED}
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

/** Above the join, for a person who has given no name: saving it is the join's first act. */
function NameAsked(properties: {
  readonly name: string;
  readonly onName: (name: string) => void;
  readonly failure: Error | ApiError | null;
  readonly here: string;
}) {
  const { failure } = properties;
  const refusedAs = failure === null ? undefined : refusalOf(failure)?.class;
  return (
    <div className="mb-4">
      <Label htmlFor={NAME_FIELD}>{DISPLAY_NAME_WORDS.label}</Label>
      <p id={NAME_HINT} className="mt-1 text-muted-foreground">
        {DISPLAY_NAME_WORDS.hint}
      </p>
      <Input
        id={NAME_FIELD}
        name="displayName"
        autoComplete="name"
        required
        aria-describedby={failure === null ? NAME_HINT : `${NAME_HINT} ${NAME_REFUSED}`}
        aria-invalid={refusedAs === "malformed"}
        className="mt-2"
        value={properties.name}
        onChange={(event) => properties.onName(event.target.value)}
      />
      {failure === null ? null : (
        <Refused
          id={NAME_REFUSED}
          failure={failure}
          saidOf={nameSaidOf}
          signInAt={properties.here}
        />
      )}
    </div>
  );
}

function JoinRefused(properties: {
  readonly failure: Error | ApiError;
  readonly way: WayOn | undefined;
  readonly here: string;
}) {
  const { way, here } = properties;
  return (
    <>
      <Refused
        id={JOIN_REFUSED}
        failure={properties.failure}
        saidOf={saidOf}
        unanswered={JOIN_UNANSWERED}
        signInAt={here}
      />
      {way === undefined ? null : (
        <div className="mt-4">
          <WayOnAct way={way} here={here} />
        </div>
      )}
    </>
  );
}

function InvitationToJoin(properties: {
  readonly invitationId: string;
  readonly invitation: Invitation;
  readonly here: string;
}) {
  const { invitation, invitationId, here } = properties;
  const session = useSession().data;
  // Kept for the screen's life, so the field stays under the reader once their name lands.
  const [asksAName, setAsksAName] = useState(() => {
    const given = session?.user.name;
    return given !== undefined && !hasADisplayName(given);
  });
  const [name, setName] = useState("");
  const naming = useSetDisplayName();
  const accept = useAcceptInvitation();
  const way = wayOf(accept.error);
  const joining = naming.isPending || accept.isPending;

  const acceptIt = () => {
    accept.mutate(
      { invitationId },
      {
        onError: (failure) => {
          if (refusalOf(failure)?.word === "no-display-name") setAsksAName(true);
        },
      },
    );
  };

  const join = () => {
    // The button stays enabled while joining, so the focus a click gave it is not dropped.
    if (joining) return;
    // A name already saved is not saved again, which would record a second naming.
    const named = !asksAName || (naming.isSuccess && naming.variables.displayName === name);
    if (named) {
      acceptIt();
      return;
    }
    accept.reset();
    naming.mutate({ displayName: name }, { onSuccess: acceptIt });
  };
  useKeystroke(JOIN, join);

  const submitted = (event: FormEvent) => {
    event.preventDefault();
    join();
  };

  return (
    <AuthScreen title={INVITATION_WORDS.heading(invitation.workspaceName)}>
      <p className="mt-2">{INVITATION_WORDS.body(invitation.invitedBy, invitation.role)}</p>

      <form onSubmit={submitted} className="mt-6">
        {asksAName ? (
          <NameAsked name={name} onName={setName} failure={naming.error} here={here} />
        ) : null}
        <Button
          type="submit"
          className="aria-disabled:opacity-50"
          aria-disabled={joining}
          aria-describedby={accept.error === null ? undefined : JOIN_REFUSED}
          aria-keyshortcuts={JOIN.key}
        >
          {joining ? INVITATION_WORDS.joining : INVITATION_WORDS.join(invitation.workspaceName)}
        </Button>
      </form>

      {accept.error === null ? null : <JoinRefused failure={accept.error} way={way} here={here} />}

      <Leaving keystrokes={way === undefined ? [JOIN] : [JOIN, way.keystroke]} />
    </AuthScreen>
  );
}

/**
 * Reached from the invitation email's link. The route has already sent a signed-out person on,
 * and brings them back here.
 */
export function AcceptInvitationScreen(properties: { readonly invitationId: string }) {
  const api = useTRPC();
  const { invitationId } = properties;
  const here = invitationAt(invitationId);
  const invitation = useQuery(api.person.invitation.queryOptions({ invitationId }));

  if (invitation.isPending) {
    return (
      <AuthScreen title={INVITATION_WORDS.untitled}>
        <Outcome tone="said">{INVITATION_WORDS.reading}</Outcome>
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
