import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "@/shared/ui/button.tsx";

import {
  useListOrganizations,
  useOAuthContinue,
  useSession,
  useSetActiveOrganization,
  type ResumeAnswer,
} from "./auth-hooks.ts";
import { AuthScreen, Outcome } from "./auth-screen.tsx";
import { carriedFlow } from "./carried-flow.ts";
import { WORKSPACE_WORDS } from "./workspace-words.ts";

const addressIn = (answer: ResumeAnswer): string | undefined => {
  const next = answer.url;
  return typeof next === "string" && next !== "" ? next : undefined;
};

/**
 * The workspace picker — a screen this platform writes, on the module's own hooks
 * (`auth-hooks.ts`, T-046 slice 2). Its heading is the platform's word, read straight
 * from `workspace-words.ts`.
 *
 * It answers three shapes of visit:
 *
 * - **A member of several workspaces** chooses one, and everything after is scoped to it.
 * - **A member of exactly one** is never asked: the screen makes that workspace active if
 *   the session has not already — a session made before the membership existed has not —
 *   and carries them on.
 * - **A member of none** is sent to the refused screen; there is nothing here to pick and
 *   nothing to create. There is no create-workspace control on this screen or anywhere
 *   else in the product: workspaces are platform-provisioned (T-004 judgement call 1).
 *
 * A visit carrying a host's signed query resumes the authorization through Better Auth's
 * continue endpoint and follows where it says — consent, on the authorization server's own
 * origin. A visit without one lands in the shell.
 *
 * Every outcome is said in words, including the two that are nobody's fault: a pick the
 * platform refused, and a resume that answered with nowhere to go. A screen that went
 * quiet would leave a person looking at a list of buttons that had stopped working
 * (`[UX2]`).
 *
 * WCAG 2.2 AA (`[A11Y1]`): the choices are buttons in a list, in DOM order, each naming
 * its workspace; the outcome of a pick is announced in a live region.
 */
export function ChooseWorkspaceScreen() {
  const navigate = useNavigate();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const carried = carriedFlow(search);

  const session = useSession();
  const workspaces = useListOrganizations();
  const pick = useSetActiveOrganization();
  const resume = useOAuthContinue();
  /** The resume answered, and named nowhere to go. Held so the screen can say so. */
  const [wentNowhere, setWentNowhere] = useState(false);

  const signedOut = !session.isPending && (session.data === null || session.data === undefined);
  const held = workspaces.data ?? [];
  const sole = held.length === 1 ? held[0] : undefined;
  const active = session.data?.session.activeOrganizationId ?? undefined;
  const settled = !session.isPending && !workspaces.isPending;

  /**
   * Resume the host's flow, or land in the shell. Better Auth answers the continue
   * endpoint with the address the person goes to next, on the authorization server's
   * origin — a whole-page navigation, because consent is a page this product does not
   * render and must not be rendered inside.
   */
  const goOn = () => {
    if (carried === "") {
      void navigate({ href: "/", replace: true });
      return;
    }
    // The signed query is not passed here: the OAuth client plugin's own request hook
    // reads it off this screen's address and attaches it as `oauth_query`, which is why
    // every screen in the walk keeps the query whole.
    resume.mutate(
      { postLogin: true },
      {
        onSuccess: (answer) => {
          const next = addressIn(answer);
          if (next === undefined) {
            // The flow cannot be resumed and the person is not told to wait for something
            // that will not happen. They are signed in, so the product is still theirs.
            setWentNowhere(true);
            return;
          }
          globalThis.location.assign(next);
        },
      },
    );
  };

  /** Make the one workspace active if it is not, then go on. */
  const openSoleWorkspace = () => {
    if (sole === undefined) return;
    if (active !== undefined) {
      goOn();
      return;
    }
    // A session made before this membership existed carries no active workspace, and the
    // person still has nothing to choose between. Choosing for them is the whole of the
    // "a person in one workspace never sees a picker" promise (user story 3).
    pick.mutate({ organizationId: sole.id }, { onSuccess: goOn });
  };

  // The visits that ask the person nothing. Kept in one effect so the screen has one place
  // where it decides it has no question, and so a redraw cannot ask twice: the mutations'
  // own pending states are part of the condition.
  const decided = settled && !pick.isPending && !resume.isPending && !wentNowhere;
  useEffect(() => {
    if (!decided) return;
    if (signedOut) {
      void navigate({ href: `/sign-in${carried}`, replace: true });
      return;
    }
    if (held.length === 0) {
      void navigate({ href: "/no-workspace", replace: true });
      return;
    }
    if (sole !== undefined) openSoleWorkspace();
    // `openSoleWorkspace` closes over this render's mutations; re-running the effect on a
    // new identity for it would resume a flow that is already resuming.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decided, signedOut, held.length, sole?.id, active, carried, navigate]);

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

  if (held.length < 2) {
    // One workspace, none, or no session: the effect above is carrying the person on, and
    // this is what they read while it does — unless the pick that carries them was
    // refused, which is said rather than left as a screen that never moves.
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
