import { Link } from "@tanstack/react-router";

import { AuthPage, Outcome, Refused } from "@/features/auth/auth-page.tsx";
import { SignOutButton } from "@/features/auth/sign-out-button.tsx";
import { useOperatorStanding } from "@/features/console/operator.ts";
import { CONSOLE_CLOSED, saidOf } from "@/features/console/words.ts";
import { CONSOLE, OPERATOR_READER, visibleTo } from "@/shared/navigation.ts";
import { STOCK } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";

import { Frame } from "./frame.tsx";

/** The console frame draws for the operator alone, so what it shows is theirs. */
const THE_OPERATORS = visibleTo(OPERATOR_READER, [CONSOLE]);

const BACK_TO_YOUR_WORKSPACES = {
  name: "Back to Your Workspaces",
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

/** Outside the shell, so a person who is not the operator never sees the console's pages. */
function ConsoleClosed(properties: { readonly standing: ReturnType<typeof useOperatorStanding> }) {
  const { standing } = properties;

  if (standing.isPending) {
    return (
      <AuthPage title={CONSOLE.name}>
        <Outcome tone="said">Checking your access.</Outcome>
      </AuthPage>
    );
  }

  if (standing.error !== null) {
    return (
      <AuthPage title={CONSOLE.name}>
        <Refused
          id="console-unread"
          failure={standing.error}
          saidOf={saidOf}
          unanswered={STOCK.notLoaded}
        />
        <Button
          type="button"
          className="mt-6"
          onClick={() => {
            void standing.refetch();
          }}
        >
          Try Again
        </Button>
        <WaysOut />
      </AuthPage>
    );
  }

  return (
    <AuthPage title={CONSOLE_CLOSED}>
      <Outcome tone="refused">{STOCK.permission}</Outcome>
      <WaysOut />
    </AuthPage>
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
