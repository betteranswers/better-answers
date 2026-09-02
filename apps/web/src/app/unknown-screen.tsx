import { Link } from "@tanstack/react-router";

/**
 * The address is on `app.` but is not one of Control Centre's screens. The api serves the
 * shell for any address it does not answer itself, so this is where such an address lands,
 * and saying so is better than a blank frame.
 *
 * WCAG 2.2 AA, tested with a keyboard and a screen reader (`[A11Y1]`).
 */
export function UnknownScreen() {
  return (
    <>
      <h1>No such screen</h1>
      <p className="mt-2 text-muted-foreground">
        This address is not one of Control Centre's six screens.
      </p>
      <p className="mt-6">
        <Link to="/system" className="text-brand underline">
          Go to System
        </Link>
      </p>
    </>
  );
}
