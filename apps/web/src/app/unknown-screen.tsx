import { Link } from "@tanstack/react-router";

export function UnknownScreen() {
  return (
    <>
      <h1>No such screen</h1>
      <p className="mt-2 text-muted-foreground">
        This address is not one of Control Centre's six screens, nor a view of one.
      </p>
      <p className="mt-6">
        <Link to="/system" className="text-brand underline">
          Go to System
        </Link>
      </p>
    </>
  );
}
