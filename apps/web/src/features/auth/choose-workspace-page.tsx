import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { refusedWith } from "@/shared/refusal-outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";

import { AccountLink } from "./account-link.tsx";
import {
  hasADisplayName,
  useListOrganizations,
  useOAuthContinue,
  useSession,
  useSetActiveOrganization,
  type ResumeAnswer,
  type SwitchRefused,
} from "./auth-hooks.ts";
import { AuthPage } from "./auth-page.tsx";
import { carriedFlow, leavingFor, pageQuery } from "./carried-flow.ts";
import {
  CONNECTION_UNFINISHED,
  noLongerAMember,
  PICK_REFUSED,
  SOLE_PICK_REFUSED,
  WORKSPACES_UNREAD,
} from "./refusal-words.ts";
import { NOT_CONNECTED, PICKER_WORDS } from "./workspace-words.ts";

type Session = ReturnType<typeof useSession>;
type Workspaces = ReturnType<typeof useListOrganizations>;
type Workspace = NonNullable<Workspaces["data"]>[number];

const WORKSPACE_LIST = "workspace-list";

const addressIn = (answer: ResumeAnswer): string | undefined => {
  const next = answer.url;
  return typeof next === "string" && next !== "" ? next : undefined;
};

const whatTheSessionSays = (session: Session) => ({
  signedOut: !session.isPending && (session.data === null || session.data === undefined),
  unnamed:
    session.data !== null && session.data !== undefined && !hasADisplayName(session.data.user.name),
  active: session.data?.session.activeOrganizationId ?? undefined,
});

/** A workspace refused as no longer held is left out at once, before the list is read again. */
const whereThePersonStands = (
  session: Session,
  workspaces: Workspaces,
  noLongerHeld: Workspace | undefined,
) => {
  const held = (workspaces.data ?? []).filter((workspace) => workspace.id !== noLongerHeld?.id);
  return {
    ...whatTheSessionSays(session),
    held,
    sole: held.length === 1 ? held[0] : undefined,
    settled: !session.isPending && !workspaces.isPending,
  };
};

const endedTheMembership = (refused: SwitchRefused | null): boolean =>
  refused?.noLongerAMember === true;

/** Once a pick is refused, the list or the refusal stands to be read rather than a pick retried. */
const whereThePickStands = (
  held: readonly Workspace[],
  noLongerHeld: Workspace | undefined,
  went: {
    readonly pick: SwitchRefused | null;
    readonly resume: Error | null;
    readonly nowhere: boolean;
  },
) => {
  const one = held.length === 1;
  return {
    notConnected: went.nowhere || went.resume !== null,
    listed: held.length > 1 || (one && noLongerHeld !== undefined),
    refused: went.pick !== null,
    removedFrom: endedTheMembership(went.pick) ? noLongerHeld : undefined,
    opensAlone: one && noLongerHeld === undefined && went.pick === null && went.resume === null,
  };
};

const focusTheFirstWorkspace = () => {
  document.getElementById(WORKSPACE_LIST)?.querySelector("button")?.focus();
};

/**
 * Opens a sole workspace without asking; a carried connection resumes after any pick. No session,
 * display name or workspace sends the person on.
 */
export function ChooseWorkspacePage() {
  const navigate = useNavigate();
  const carried = carriedFlow(pageQuery());

  const session = useSession();
  const workspaces = useListOrganizations();
  const pick = useSetActiveOrganization();
  const resume = useOAuthContinue();

  const [wentNowhere, setWentNowhere] = useState(false);
  const [noLongerHeld, setNoLongerHeld] = useState<Workspace | undefined>(undefined);

  const { signedOut, unnamed, held, sole, active, settled } = whereThePersonStands(
    session,
    workspaces,
    noLongerHeld,
  );
  const { opensAlone, ...pickStanding } = whereThePickStands(held, noLongerHeld, {
    pick: pick.error,
    resume: resume.error,
    nowhere: wentNowhere,
  });

  const goOn = () => {
    if (carried === "") {
      void navigate({ href: "/", replace: true });
      return;
    }

    resume.mutate(
      { postLogin: true },
      {
        onSuccess: (answer) => {
          const next = addressIn(answer);
          if (next === undefined) {
            setWentNowhere(true);
            return;
          }
          globalThis.location.assign(next);
        },
      },
    );
  };

  const openWorkspace = (workspace: Workspace) => {
    pick.mutate(
      { organizationId: workspace.id },
      {
        onSuccess: goOn,
        onError: (refused) => {
          if (!refused.noLongerAMember) return;
          flushSync(() => {
            setNoLongerHeld(workspace);
          });
          focusTheFirstWorkspace();
          void workspaces.refetch();
        },
      },
    );
  };

  const openSoleWorkspace = () => {
    if (sole === undefined) return;
    // A session can still name a workspace the person has just left.
    if (active === sole.id) {
      goOn();
      return;
    }

    openWorkspace(sole);
  };

  const decided = settled && !pick.isPending && !resume.isPending && !wentNowhere;
  useEffect(() => {
    if (!decided) return;
    if (signedOut) {
      void navigate(leavingFor(`/sign-in${carried}`));
      return;
    }
    if (unnamed) {
      void navigate(leavingFor(`/display-name${carried}`));
      return;
    }

    if (held.length === 0 && !workspaces.isError) {
      void navigate(leavingFor(`/no-workspace${carried}`));
      return;
    }
    if (opensAlone) openSoleWorkspace();

    // eslint-disable-next-line react-hooks/exhaustive-deps -- adding `openSoleWorkspace` re-runs this on every render and resumes a flow that is already resuming
  }, [
    decided,
    signedOut,
    unnamed,
    held.length,
    workspaces.isError,
    sole?.id,
    opensAlone,
    active,
    carried,
    navigate,
  ]);

  return (
    <WorkspaceChoice
      standing={{
        settled,
        unread: workspaces.isError,
        ...pickStanding,
      }}
      held={held}
      busy={pick.isPending || resume.isPending}
      onRetry={() => {
        void workspaces.refetch();
      }}
      onPick={openWorkspace}
      onCarryOn={() => {
        void navigate({ href: "/", replace: true });
      }}
    />
  );
}

type Standing = {
  /** A carried connection that could not be handed back once the workspace was open. */
  readonly notConnected: boolean;
  readonly settled: boolean;
  readonly unread: boolean;
  readonly listed: boolean;
  readonly refused: boolean;
  /** Set only while the latest pick's refusal is the ended membership. */
  readonly removedFrom: Workspace | undefined;
};

const pickOutcome = (standing: Standing): Outcome | undefined => {
  if (standing.removedFrom !== undefined) {
    return { tone: "refused", words: noLongerAMember(standing.removedFrom.name) };
  }
  if (standing.refused) return refusedWith(standing.listed ? PICK_REFUSED : SOLE_PICK_REFUSED);
  return standing.listed ? undefined : { tone: "said", words: PICKER_WORDS.opening };
};

const outcomeOf = (standing: Standing): Outcome | undefined => {
  if (standing.notConnected) return refusedWith(CONNECTION_UNFINISHED);
  if (!standing.settled) return { tone: "said", words: PICKER_WORDS.reading };
  if (standing.unread) return { tone: "refused", words: WORKSPACES_UNREAD };
  return pickOutcome(standing);
};

function WorkspaceList(properties: {
  readonly held: readonly Workspace[];
  readonly busy: boolean;
  readonly onPick: (workspace: Workspace) => void;
}) {
  return (
    <>
      <p className="mt-2 text-muted-foreground">{PICKER_WORDS.lead}</p>

      <ul id={WORKSPACE_LIST} className="mt-6 flex flex-col gap-2">
        {properties.held.map((workspace) => (
          <li key={workspace.id}>
            {/* Enabled while a pick is open, so a refused pick can hand focus to what is left. */}
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start aria-disabled:opacity-50"
              aria-disabled={properties.busy}
              onClick={() => {
                if (!properties.busy) properties.onPick(workspace);
              }}
            >
              {workspace.name}
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}

function NextAct(properties: {
  readonly standing: Standing;
  readonly onRetry: () => void;
  readonly onCarryOn: () => void;
}) {
  if (properties.standing.notConnected) {
    return (
      <Button type="button" className="mt-6" onClick={properties.onCarryOn}>
        {NOT_CONNECTED.carryOn}
      </Button>
    );
  }
  if (!properties.standing.unread) return null;
  return (
    <Button type="button" className="mt-6" onClick={properties.onRetry}>
      {PICKER_WORDS.tryAgain}
    </Button>
  );
}

/** The outcome's regions stand in one place through every state, so each change is announced. */
function WorkspaceChoice(properties: {
  readonly standing: Standing;
  readonly held: readonly Workspace[];
  readonly busy: boolean;
  readonly onRetry: () => void;
  readonly onPick: (workspace: Workspace) => void;
  readonly onCarryOn: () => void;
}) {
  const { standing } = properties;
  const listing = standing.listed && !standing.notConnected;

  return (
    <AuthPage title={standing.notConnected ? NOT_CONNECTED.heading : PICKER_WORDS.heading}>
      {listing ? (
        <WorkspaceList held={properties.held} busy={properties.busy} onPick={properties.onPick} />
      ) : null}
      <OutcomeLine outcome={outcomeOf(standing)} className="mt-4" />
      <NextAct standing={standing} onRetry={properties.onRetry} onCarryOn={properties.onCarryOn} />
      {listing ? (
        <div className="mt-8">
          <AccountLink />
        </div>
      ) : null}
    </AuthPage>
  );
}
