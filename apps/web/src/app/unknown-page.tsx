import { Link } from "@tanstack/react-router";

import { AuthPage } from "@/features/auth/auth-page.tsx";
import { refusalOf } from "@/shared/api/trpc.ts";
import { useBreadcrumbLastPart } from "@/shared/breadcrumb-last-part.ts";
import { NO_SESSION, useMemberAskedOnce } from "@/shared/member.ts";
import type { Page } from "@/shared/navigation.ts";
import { PageHead } from "@/shared/page-head.tsx";
import { Button } from "@/shared/ui/button.tsx";

import { WorkspaceFrame } from "./frame.tsx";
import { GoHome } from "./go-home.tsx";
import { UNKNOWN_PAGE } from "./words.ts";

export function UnknownPage(properties: { readonly home?: Page | undefined }) {
  useBreadcrumbLastPart(UNKNOWN_PAGE.heading);

  return (
    <>
      <PageHead heading={UNKNOWN_PAGE.heading} />
      <GoHome home={properties.home} className="mt-6" />
    </>
  );
}

function UnknownSignedOut() {
  return (
    <>
      <PageHead heading={UNKNOWN_PAGE.heading} />
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
