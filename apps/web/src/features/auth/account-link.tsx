import { Link } from "@tanstack/react-router";

import { Button } from "@/shared/ui/button.tsx";

import { ACCOUNT_HEADING } from "./account-words.ts";

/** For the pages outside the shell, which have no avatar menu to reach it from. */
export function AccountLink() {
  return (
    <Button asChild variant="link" className="px-0">
      <Link to="/account">{ACCOUNT_HEADING}</Link>
    </Button>
  );
}
