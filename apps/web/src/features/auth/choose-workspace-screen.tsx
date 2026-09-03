import { organizationPlugin } from "@better-auth-ui/core/plugins/organization";
import { useAuthPlugin, useSession } from "@better-auth-ui/react";
import { useOAuthContinue } from "@better-auth-ui/react/plugins/oauth-provider";
import {
  useListOrganizations,
  useSetActiveOrganization,
} from "@better-auth-ui/react/plugins/organization";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import { Button } from "@/shared/ui/button.tsx";

import { authClient } from "./auth-client.ts";
import { AuthScreen, Outcome } from "./auth-screen.tsx";
import { carriedFlow } from "./carried-flow.ts";

/**
 * What Better Auth answers a resumed authorization with: where the person goes next. The
 * shape is stated here because the client's own type for it is `any`, and a screen that
 * navigates somewhere should say what it read to decide.
 */
type ResumeAnswer = { readonly redirect?: boolean; readonly url?: string };

/**
 * The workspace picker — a screen this platform writes, on better-auth-ui's headless
 * hooks rather than its organisation switcher. The switcher is a dropdown for a shell and
 * cannot be had on its own: it arrives inside a registry item implementing create, delete,
 * leave, invite, teams and roles, every one of them an act this product refuses
 * (`docs/research/t-022-better-auth-ui.md` § 1). The hooks are what a picker needs, and
 * the resume is by the library's own account "application-owned".
 *
 * It answers three shapes of visit:
 *
 * - **A member of several workspaces** chooses one, and everything after is scoped to it.
 * - **A member of exactly one** never sees it: the session already names their workspace,
 *   set when it was created, so the screen carries them straight on.
 * - **A member of none** is sent to the refused screen; there is nothing here to pick and
 *   nothing to create.
 *
 * A visit carrying a host's signed query resumes the authorization through Better Auth's
 * continue endpoint and follows where it says — consent, on the authorization server's own
 * origin. A visit without one lands in the shell.
 *
 * WCAG 2.2 AA (`[A11Y1]`): the choices are buttons in a list, in DOM order, each naming
 * its workspace; the outcome of a pick is announced in a live region.
 */
export function ChooseWorkspaceScreen() {
  const navigate = useNavigate();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const carried = carriedFlow(search);

  const { localization } = useAuthPlugin(organizationPlugin);
  const session = useSession(authClient);
  const workspaces = useListOrganizations(authClient);
  const pick = useSetActiveOrganization(authClient);
  const resume = useOAuthContinue(authClient);

  const signedOut = !session.isPending && (session.data === null || session.data === undefined);
  const held = workspaces.data ?? [];
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
    // every screen in the walk keeps the query whole. Better Auth answers with where the
    // person goes next — consent, on the authorization server's origin — and that is a
    // whole-page navigation, because consent is a page this product must never render
    // inside its own shell.
    resume.mutate(
      { postLogin: true },
      {
        onSuccess: (answer: ResumeAnswer) => {
          const next = answer.url;
          if (typeof next === "string" && next !== "") globalThis.location.assign(next);
        },
      },
    );
  };

  // The three visits that ask the person nothing. Kept in one effect so the screen has one
  // place where it decides it has no question, and so a redraw cannot ask twice: the
  // mutation's own pending state is part of the condition.
  const decided = settled && !pick.isPending && !resume.isPending;
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
    if (held.length === 1 && active !== undefined) goOn();
    // `goOn` closes over this render's mutations; re-running it on a new identity would
    // resume a flow that is already resuming.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decided, signedOut, held.length, active, carried, navigate]);

  if (!settled) {
    return (
      <AuthScreen title={localization.organizations}>
        <Outcome tone="said">Reading your workspaces.</Outcome>
      </AuthScreen>
    );
  }

  if (held.length < 2) {
    // One workspace, none, or no session: the effect above is carrying the person on, and
    // this is what they read while it does.
    return (
      <AuthScreen title={localization.organizations}>
        <Outcome tone="said">Taking you to your workspace.</Outcome>
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

      {pick.error === null && resume.error === null ? null : (
        <Outcome tone="refused">
          That workspace could not be opened. Choose again, or sign out and back in.
        </Outcome>
      )}
    </AuthScreen>
  );
}
