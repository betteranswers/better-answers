import { Link } from "@tanstack/react-router";

/**
 * The address is on `app.` but is not one of Control Centre's screens. The api answers any
 * such address with this page rather than with a 404, so that a screen's own address
 * survives a refresh; saying so is better than showing a page with nothing on it.
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
