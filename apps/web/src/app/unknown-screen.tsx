import { Link } from "@tanstack/react-router";

import { CONTROL_CENTRE, type Surface } from "@/shared/screens.ts";

export function UnknownScreen(properties: { readonly surface?: Surface }) {
  const surface = properties.surface ?? CONTROL_CENTRE;

  return (
    <>
      <h1>No such screen</h1>
      <p className="mt-2 text-muted-foreground">
        This address is not one of {surface.nameInProse}'s screens, nor a view of one.
      </p>
      <p className="mt-6">
        <Link to={surface.home.path} className="text-brand underline">
          Go to {surface.home.name}
        </Link>
      </p>
    </>
  );
}
