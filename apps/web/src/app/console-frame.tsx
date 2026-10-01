import { Link } from "@tanstack/react-router";

import { AuthScreen, Outcome, Refused } from "@/features/auth/auth-screen.tsx";
import { SignOutButton } from "@/features/auth/sign-out-button.tsx";
import { useOperatorStanding } from "@/features/console/operator.ts";
import { ONLY_THE_OPERATOR, STANDING_UNANSWERED } from "@/features/console/refusal-words.ts";
import { CONSOLE_CLOSED, saidOf } from "@/features/console/words.ts";
import { CONSOLE, OPERATOR_READER, visibleTo } from "@/shared/navigation.ts";
import { RefusalLine } from "@/shared/refusal-outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";

import { Frame } from "./frame.tsx";

/** The console frame draws for the operator alone, so what it shows is theirs. */
const THE_OPERATORS = visibleTo(OPERATOR_READER, [CONSOLE]);

const BACK_TO_YOUR_WORKSPACES = {
  name: "Back to your workspaces",
  to: "/choose-workspace",
} as const;

function WaysOut() {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-4">
      <Link to={BACK_TO_YOUR_WORKSPACES.to} className="text-brand underline">
        {BACK_TO_YOUR_WORKSPACES.name}
      </Link>
      <SignOutButton />
    </div>
  );
}

/** Outside the shell, so a person who is not the operator never sees the console's screens. */
function ConsoleClosed(properties: { readonly standing: ReturnType<typeof useOperatorStanding> }) {
  const { standing } = properties;

  if (standing.isPending) {
    return (
      <AuthScreen title={CONSOLE.name}>
        <Outcome tone="said">Reading whether the console is open to you.</Outcome>
      </AuthScreen>
    );
  }

  if (standing.error !== null) {
    return (
      <AuthScreen title={CONSOLE.name}>
        <Refused
          id="console-unread"
          failure={standing.error}
          saidOf={saidOf}
          unanswered={STANDING_UNANSWERED}
        />
        <Button
          type="button"
          className="mt-6"
          onClick={() => {
            void standing.refetch();
          }}
        >
          Try again
        </Button>
        <WaysOut />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title={CONSOLE_CLOSED}>
      <Outcome tone="refused">
        <RefusalLine said={ONLY_THE_OPERATOR} />
      </Outcome>
      <WaysOut />
    </AuthScreen>
  );
}

export function ConsoleFrame() {
  const standing = useOperatorStanding();

  if (standing.data?.operator !== true) return <ConsoleClosed standing={standing} />;

  return (
    <Frame
      visible={THE_OPERATORS}
      here={{ name: CONSOLE.name, workspaceId: undefined }}
      person={{ name: standing.data.name }}
      offersTheConsole={false}
    />
  );
}
