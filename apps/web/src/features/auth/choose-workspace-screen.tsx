import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "@/shared/ui/button.tsx";

import {
  hasADisplayName,
  useListOrganizations,
  useOAuthContinue,
  useSession,
  useSetActiveOrganization,
  type ResumeAnswer,
} from "./auth-hooks.ts";
import { AuthScreen, Outcome } from "./auth-screen.tsx";
import { carriedFlow, leavingFor, pageQuery } from "./carried-flow.ts";
import { WORKSPACE_WORDS } from "./workspace-words.ts";

const addressIn = (answer: ResumeAnswer): string | undefined => {
  const next = answer.url;
  return typeof next === "string" && next !== "" ? next : undefined;
};

export function ChooseWorkspaceScreen() {
  const navigate = useNavigate();
  const carried = carriedFlow(pageQuery());

  const session = useSession();
  const workspaces = useListOrganizations();
  const pick = useSetActiveOrganization();
  const resume = useOAuthContinue();

  const [wentNowhere, setWentNowhere] = useState(false);

  const signedOut = !session.isPending && (session.data === null || session.data === undefined);
  const unnamed =
    session.data !== null && session.data !== undefined && !hasADisplayName(session.data.user.name);
  const held = workspaces.data ?? [];
  const sole = held.length === 1 ? held[0] : undefined;
  const active = session.data?.session.activeOrganizationId ?? undefined;
  const settled = !session.isPending && !workspaces.isPending;

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

  const openSoleWorkspace = () => {
    if (sole === undefined) return;
    if (active !== undefined) {
      goOn();
      return;
    }

    pick.mutate({ organizationId: sole.id }, { onSuccess: goOn });
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
      void navigate({ href: "/no-workspace", replace: true });
      return;
    }
    if (sole !== undefined) openSoleWorkspace();

    // Adding `openSoleWorkspace` to the deps re-runs this on every render and resumes a flow
    // that is already resuming.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    decided,
    signedOut,
    unnamed,
    held.length,
    workspaces.isError,
    sole?.id,
    active,
    carried,
    navigate,
  ]);

  const refused = pick.error !== null || resume.error !== null;

  if (wentNowhere) {
    return (
      <AuthScreen title="The connection could not be finished">
        <Outcome tone="refused">
          You are signed in, but this connection could not be resumed. Start it again from the app
          you were connecting, or carry on in Better Answers.
        </Outcome>

        <Button
          type="button"
          className="mt-6"
          onClick={() => {
            void navigate({ href: "/", replace: true });
          }}
        >
          Go to Better Answers
        </Button>
      </AuthScreen>
    );
  }

  if (!settled) {
    return (
      <AuthScreen title={WORKSPACE_WORDS.organizations}>
        <Outcome tone="said">Reading your workspaces.</Outcome>
      </AuthScreen>
    );
  }

  if (workspaces.isError) {
    return (
      <AuthScreen title={WORKSPACE_WORDS.organizations}>
        <Outcome tone="refused">Your workspaces could not be read. Try again.</Outcome>

        <Button
          type="button"
          className="mt-6"
          onClick={() => {
            void workspaces.refetch();
          }}
        >
          Try again
        </Button>
      </AuthScreen>
    );
  }

  if (held.length < 2) {
    return (
      <AuthScreen title={WORKSPACE_WORDS.organizations}>
        {refused ? (
          <Outcome tone="refused">
            Your workspace could not be opened. Sign out and sign in again.
          </Outcome>
        ) : (
          <Outcome tone="said">Taking you to your workspace.</Outcome>
        )}
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="Choose a workspace">
      <p className="mt-2 text-muted-foreground">
        You are a member of more than one. Everything you see next is the one you pick.
      </p>

      <ul className="mt-6 flex flex-col gap-2">
        {held.map((workspace) => (
          <li key={workspace.id}>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              disabled={pick.isPending || resume.isPending}
              onClick={() => {
                pick.mutate({ organizationId: workspace.id }, { onSuccess: goOn });
              }}
            >
              {workspace.name}
            </Button>
          </li>
        ))}
      </ul>

      {refused ? (
        <Outcome tone="refused">
          That workspace could not be opened. Choose again, or sign out and back in.
        </Outcome>
      ) : null}
    </AuthScreen>
  );
}
