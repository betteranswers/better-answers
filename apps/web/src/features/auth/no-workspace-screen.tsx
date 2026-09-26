import { KeystrokesAct } from "@/shared/keystrokes.tsx";

import { ASK_TO_JOIN, AskToJoin } from "./ask-to-join.tsx";
import { AuthScreen } from "./auth-screen.tsx";
import { SignOutButton } from "./sign-out-button.tsx";
import { NO_WORKSPACE_HEADING } from "./workspace-words.ts";

/** Asking to join is the one way on, so the screen says nothing before it. */
export function NoWorkspaceScreen() {
  return (
    <AuthScreen title={NO_WORKSPACE_HEADING}>
      <AskToJoin />

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <SignOutButton />
        <KeystrokesAct screen="this screen" keystrokes={[ASK_TO_JOIN]} />
      </div>
    </AuthScreen>
  );
}
