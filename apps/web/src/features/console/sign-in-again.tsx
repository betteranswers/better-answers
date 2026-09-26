import { Link } from "@tanstack/react-router";
import type { Ref } from "react";

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
      Sign in again
    </Link>
  );
}
