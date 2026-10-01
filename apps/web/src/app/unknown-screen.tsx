import type { Screen } from "@/shared/navigation.ts";

import { GoHome } from "./go-home.tsx";
import { UNKNOWN_SCREEN } from "./words.ts";

/** `home` for a reader who holds no role, as in the console; otherwise the role's own. */
export function UnknownScreen(properties: { readonly home?: Screen | undefined }) {
  return (
    <>
      <h1>{UNKNOWN_SCREEN.heading}</h1>
      <GoHome home={properties.home} className="mt-6" />
    </>
  );
}
