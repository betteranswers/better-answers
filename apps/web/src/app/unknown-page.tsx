import type { Page } from "@/shared/navigation.ts";

import { GoHome } from "./go-home.tsx";
import { UNKNOWN_PAGE } from "./words.ts";

/** `home` for a reader who holds no role, as in the console; otherwise the role's own. */
export function UnknownPage(properties: { readonly home?: Page | undefined }) {
  return (
    <>
      <h1>{UNKNOWN_PAGE.heading}</h1>
      <GoHome home={properties.home} className="mt-6" />
    </>
  );
}
