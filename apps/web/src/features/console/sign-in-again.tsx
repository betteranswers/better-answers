import { Link } from "@tanstack/react-router";
import type { Ref } from "react";

import { SIGN_IN_AGAIN } from "@/shared/refusal-words.ts";

/** A stale sign-in's way on: sign in again, and land back where the act was refused. */
export function SignInAgain(properties: {
  readonly back: string;
  readonly linkRef?: Ref<HTMLAnchorElement>;
}) {
  const { back, linkRef } = properties;
  return (
    <Link
      ref={linkRef}
      to="/sign-in"
      search={{ redirect: back }}
      className="justify-self-start text-brand underline"
    >
      {SIGN_IN_AGAIN}
    </Link>
  );
}
