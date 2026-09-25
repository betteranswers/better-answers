import { KeystrokesAct } from "@/shared/keystrokes.tsx";

import { ASK_TO_JOIN, AskToJoin } from "./ask-to-join.tsx";
import { AuthScreen } from "./auth-screen.tsx";
import { SignOutButton } from "./sign-out-button.tsx";

export function NoWorkspaceScreen() {
  return (
    <AuthScreen title="No workspace yet">
      <p className="mt-2">
        You are signed in, but you are not a member of a workspace. An Admin adds people to a
        workspace: ask yours to add you and sign in again once they have, or ask to join below.
      </p>

      <AskToJoin />

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <SignOutButton />
        <KeystrokesAct screen="this screen" keystrokes={[ASK_TO_JOIN]} />
      </div>
    </AuthScreen>
  );
}
