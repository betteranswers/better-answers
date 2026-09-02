import { screenById } from "../shared/screens.ts";

const system = screenById("system");

/**
 * System — signals, health, routes and spend, and backups. The screen the frame was built
 * around; its first card is the workspace's routes, which arrives with the tRPC client.
 *
 * The card says the routes are not listed rather than rendering an empty table: a reader
 * must never mistake "the platform is not showing this yet" for "this workspace has none".
 *
 * WCAG 2.2 AA, tested with a keyboard and a screen reader (`[A11Y1]`).
 */
export function SystemScreen() {
  return (
    <>
      <h1>{system.name}</h1>
      <p className="mt-2 text-muted-foreground">{system.summary}</p>

      <section aria-labelledby="routes" className="mt-6 border border-border bg-card p-4">
        <h2 id="routes">Routes</h2>
        <p className="mt-2">A workspace's routes are not listed here yet.</p>
      </section>
    </>
  );
}
