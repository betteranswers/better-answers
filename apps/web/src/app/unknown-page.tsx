import { Link } from "@tanstack/react-router";

import { AuthPage } from "@/features/auth/auth-page.tsx";
import { NO_SESSION, useMemberAskedOnce } from "@/features/auth/member.ts";
import { refusalOf } from "@/shared/api/trpc.ts";
import { useBreadcrumbLastPart } from "@/shared/breadcrumb-last-part.ts";
import type { Page } from "@/shared/navigation.ts";
import { Button } from "@/shared/ui/button.tsx";

import { WorkspaceFrame } from "./frame.tsx";
import { GoHome } from "./go-home.tsx";
import { UNKNOWN_PAGE } from "./words.ts";

/** `home` for a reader who holds no role, as in the console; otherwise the role's own. */
export function UnknownPage(properties: { readonly home?: Page | undefined }) {
  useBreadcrumbLastPart(UNKNOWN_PAGE.heading);

  return (
    <>
      <h1>{UNKNOWN_PAGE.heading}</h1>
      <GoHome home={properties.home} className="mt-6" />
    </>
  );
}

/** A signed-out visitor has no home yet, so signing in is the one way on. */
function UnknownSignedOut() {
  return (
    <>
      <h1>{UNKNOWN_PAGE.heading}</h1>
      <p className="mt-6">
        <Button asChild variant="link" className="px-0">
          <Link to="/sign-in">{UNKNOWN_PAGE.signIn}</Link>
        </Button>
      </p>
    </>
  );
}

/**
 * An address no route names reaches no shell's route, so it draws a member's shell itself, and
 * the sign-in pages' layout for anyone else.
 */
export function UnknownAddress() {
  const member = useMemberAskedOnce();
  if (member.data !== undefined) return <WorkspaceFrame page={{ draw: <UnknownPage /> }} />;
  // Only a first read in flight draws nothing: a refusal read again keeps its page, and offline draws.
  if (!member.isFetched && member.fetchStatus === "fetching") return null;

  // A person in no workspace is refused in the same class, so the word tells them apart.
  const signedOut = member.error !== null && refusalOf(member.error)?.word === NO_SESSION;
  return <AuthPage>{signedOut ? <UnknownSignedOut /> : <UnknownPage />}</AuthPage>;
}
