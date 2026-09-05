import { RoutesCard } from "@/features/routes/routes-card.tsx";
import { screenById } from "@/shared/screens.ts";

const system = screenById("system");

/**
 * System — signals, health, routes and spend, and backups. The screen the frame was built
 * around, and the one place a card of the product's own is built.
 *
 * ADR 0025 gives this screen eight cards, Boxes first; routes is the only one built, and the
 * line below says so rather than letting one card read as the whole screen.
 *
 * The card itself is `features/routes/`: the app layer composes features and holds none of
 * their requests (T-036's rule), so this screen names the card and knows nothing about how it
 * is filled.
 *
 * WCAG 2.2 AA, tested with a keyboard and a screen reader.
 */
export function SystemScreen() {
  return (
    <>
      <h1>{system.name}</h1>
      <p className="mt-2 text-muted-foreground">{system.summary}</p>

      <RoutesCard />

      <p className="mt-6 text-muted-foreground">
        The rest of System — boxes, backups, sources and worker, the map, knowledge, questions,
        connected clients and personal data — is not built yet.
      </p>
    </>
  );
}
