import { Link } from "@tanstack/react-router";

import { Button } from "@/shared/ui/button.tsx";

import { ACCOUNT_HEADING } from "../account-words.ts";

export function AccountLink() {
  return (
    <Button asChild variant="outline">
      <Link to="/account">{ACCOUNT_HEADING}</Link>
    </Button>
  );
}
