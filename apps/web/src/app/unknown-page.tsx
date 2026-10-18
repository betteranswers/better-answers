import { Link } from "@tanstack/react-router";

import { AuthPage } from "@/features/auth/auth-page.tsx";
import { refusalOf } from "@/shared/api/trpc.ts";
import { useBreadcrumbLastPart } from "@/shared/breadcrumb-last-part.ts";
import { NO_SESSION, useMemberAskedOnce } from "@/shared/member.ts";
import type { Page } from "@/shared/navigation.ts";
import { Button } from "@/shared/ui/button.tsx";

import { WorkspaceFrame } from "./frame.tsx";
import { GoHome } from "./go-home.tsx";
import { UNKNOWN_PAGE } from "./words.ts";

export function UnknownPage(properties: { readonly home?: Page | undefined }) {
  useBreadcrumbLastPart(UNKNOWN_PAGE.heading);

  return (
    <>
      <h1>{UNKNOWN_PAGE.heading}</h1>
      <GoHome home={properties.home} className="mt-6" />
    </>
  );
}

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

export function UnknownAddress() {
  const member = useMemberAskedOnce();
  if (member.data !== undefined) return <WorkspaceFrame page={{ draw: <UnknownPage /> }} />;
  if (!member.isFetched && member.fetchStatus === "fetching") return null;

  const signedOut = member.error !== null && refusalOf(member.error)?.word === NO_SESSION;
  return <AuthPage>{signedOut ? <UnknownSignedOut /> : <UnknownPage />}</AuthPage>;
}
