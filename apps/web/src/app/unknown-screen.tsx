import { CONTROL_CENTRE, type Surface } from "@/shared/screens.ts";

import { GoHome } from "./go-home.tsx";
import { UNKNOWN_SCREEN } from "./words.ts";

export function UnknownScreen(properties: { readonly surface?: Surface }) {
  return (
    <>
      <h1>{UNKNOWN_SCREEN.heading}</h1>
      <GoHome surface={properties.surface ?? CONTROL_CENTRE} className="mt-6" />
    </>
  );
}
