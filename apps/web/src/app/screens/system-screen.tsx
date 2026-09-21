import { RoutesCard } from "@/features/routes/routes-card.tsx";
import { screenById } from "@/shared/screens.ts";

const system = screenById("system");

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
