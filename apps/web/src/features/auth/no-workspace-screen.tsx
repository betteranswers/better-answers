import { useQuery } from "@tanstack/react-query";
import { useId } from "react";

import { refusalOf, useTRPC, type ApiError, type Refusal } from "@/shared/api/trpc.ts";
import { KeystrokesAct, useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { SAID_OF_CLASS, type Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";

import { ASK_TO_JOIN, AskToJoin } from "./ask-to-join.tsx";
import { AuthScreen, ReadAgain, Refused } from "./auth-screen.tsx";
import { carriedFlow, invitationAt, pageQuery } from "./carried-flow.ts";
import { INVITATIONS_UNANSWERED } from "./refusal-words.ts";
import { SignOutButton } from "./sign-out-button.tsx";
import { NO_WORKSPACE_ACTS, NO_WORKSPACE_HEADING, NO_WORKSPACE_WORDS } from "./workspace-words.ts";

const TO_INVITATIONS: Keystroke = { key: "i", act: NO_WORKSPACE_ACTS.toInvitations };

const READ_AGAIN: Keystroke = { key: "r", act: NO_WORKSPACE_ACTS.readAgain };

const INVITATIONS_HEADING = "invitations-heading";

const INVITATION_LIST = "invitation-list";

const INVITATIONS_REFUSED = "invitations-refused";

const useOpenInvitations = () => {
  const api = useTRPC();
  return useQuery(api.person.invitations.queryOptions());
};

type InvitationsRead = ReturnType<typeof useOpenInvitations>;

type OpenInvitation = NonNullable<InvitationsRead["data"]>[number];

const saidOf = (refusal: Refusal): Said => SAID_OF_CLASS[refusal.class];

/** A list already read stands through a refetch that fails, so only a first read's failure is said. */
const failureOf = (read: InvitationsRead): Error | ApiError | null =>
  read.data === undefined ? read.error : null;

const unanswered = (read: InvitationsRead): boolean => {
  const failure = failureOf(read);
  return failure !== null && refusalOf(failure) === undefined;
};

const listedIn = (read: InvitationsRead): readonly OpenInvitation[] => read.data ?? [];

const focusTheFirstInvitation = () => {
  document.getElementById(INVITATION_LIST)?.querySelector("a")?.focus();
};

function InvitationItem(properties: {
  readonly invitation: OpenInvitation;
  readonly carried: string;
  readonly first: boolean;
}) {
  const { invitation } = properties;
  const invitedById = useId();
  return (
    <li>
      <Button asChild variant="outline" className="w-full justify-start">
        {/* A document navigation, so the router never re-serialises a carried signed query. */}
        <a
          href={`${invitationAt(invitation.invitationId)}${properties.carried}`}
          aria-describedby={invitedById}
          aria-keyshortcuts={properties.first ? TO_INVITATIONS.key : undefined}
        >
          {invitation.workspaceName}
        </a>
      </Button>
      <p id={invitedById} className="mt-1 text-muted-foreground">
        {NO_WORKSPACE_WORDS.invitedAs(invitation.invitedBy, invitation.role)}
      </p>
    </li>
  );
}

function InvitationList(properties: {
  readonly invitations: readonly OpenInvitation[];
  readonly carried: string;
}) {
  useKeystroke(TO_INVITATIONS, focusTheFirstInvitation);

  return (
    <section aria-labelledby={INVITATIONS_HEADING} className="mt-8">
      <h2 id={INVITATIONS_HEADING}>{NO_WORKSPACE_WORDS.invitations}</h2>
      <ul id={INVITATION_LIST} className="mt-4 flex flex-col gap-4">
        {properties.invitations.map((invitation, at) => (
          <InvitationItem
            key={invitation.invitationId}
            invitation={invitation}
            carried={properties.carried}
            first={at === 0}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * The refusal's region stands empty from the first render. Nothing else shows while the read is
 * out, or when it finds none.
 */
function Invitations(properties: { readonly read: InvitationsRead; readonly carried: string }) {
  const { read } = properties;
  const listed = listedIn(read);
  return (
    <>
      <Refused
        id={INVITATIONS_REFUSED}
        failure={failureOf(read)}
        saidOf={saidOf}
        unanswered={INVITATIONS_UNANSWERED}
      />
      {unanswered(read) ? (
        <ReadAgain
          keystroke={READ_AGAIN}
          reading={read.isFetching}
          words={NO_WORKSPACE_WORDS}
          onReadAgain={() => {
            void read.refetch();
          }}
          className="mt-4"
        />
      ) : null}
      {listed.length > 0 ? (
        <InvitationList invitations={listed} carried={properties.carried} />
      ) : null}
    </>
  );
}

/** In the order the screen shows their acts. */
const keystrokesOf = (read: InvitationsRead): readonly Keystroke[] => [
  ...(unanswered(read) ? [READ_AGAIN] : []),
  ...(listedIn(read).length > 0 ? [TO_INVITATIONS] : []),
  ASK_TO_JOIN,
];

/** A waiting invitation is the quickest way in, so it stands above asking to join. */
export function NoWorkspaceScreen() {
  const carried = carriedFlow(pageQuery());
  const invitations = useOpenInvitations();

  return (
    <AuthScreen title={NO_WORKSPACE_HEADING}>
      {carried === "" ? null : <p className="mt-2">{NO_WORKSPACE_WORDS.claudeAfterJoining}</p>}

      <Invitations read={invitations} carried={carried} />

      <AskToJoin />

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <SignOutButton />
        <KeystrokesAct screen="this screen" keystrokes={keystrokesOf(invitations)} />
      </div>
    </AuthScreen>
  );
}
