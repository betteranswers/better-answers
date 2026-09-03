import { AuthScreen } from "./auth-screen.tsx";
import { SignOutButton } from "./sign-out-button.tsx";

/**
 * A person who is signed in and is a member of no workspace. They are told so, and given
 * the one act that is theirs: sign out.
 *
 * There is deliberately no way forward from here. Workspaces are platform-provisioned
 * (T-004 judgement call 1, ADR 0009): a person cannot create one, so a control offering
 * to would be a button that refuses, and an empty screen would leave them guessing which
 * of the two it was.
 */
export function NoWorkspaceScreen() {
  return (
    <AuthScreen title="No workspace yet">
      <p className="mt-2">
        You are signed in, but you are not a member of a workspace. An Admin adds people to a
        workspace; ask yours to add you, and sign in again once they have.
      </p>

      <div className="mt-6">
        <SignOutButton />
      </div>
    </AuthScreen>
  );
}
