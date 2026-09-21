import { AuthScreen } from "./auth-screen.tsx";
import { SignOutButton } from "./sign-out-button.tsx";

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
