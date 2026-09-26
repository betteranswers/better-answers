import { Badge } from "@/shared/ui/badge.tsx";

import { useWorkspaceRoutes, type WorkspaceRoute } from "./list-routes.ts";
import { ROUTES_WORDS } from "./words.ts";

const PURPOSE_NAMES = {
  extraction: "Extraction",
  enrichment: "Enrichment",
  answering: "Answering",
  judging: "Judging",
  embedding: "Embedding",
} as const satisfies Record<WorkspaceRoute["purpose"], string>;

const FIXED_PURPOSE: WorkspaceRoute["purpose"] = "embedding";

type SetRoute = WorkspaceRoute & { readonly provider: string; readonly model: string };

const isSet = (route: WorkspaceRoute): route is SetRoute =>
  route.provider !== null && route.model !== null;

function RouteFields(properties: { readonly route: WorkspaceRoute }) {
  const { route } = properties;
  if (!isSet(route)) return <p className="mt-1 text-muted-foreground">{ROUTES_WORDS.unset}</p>;
  const { provider, model } = route;
  return (
    <dl className="mt-1 flex flex-col gap-1 sm:flex-row sm:gap-8">
      <div className="flex gap-2">
        <dt className="text-muted-foreground">Provider</dt>
        <dd>{provider}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="text-muted-foreground">Model</dt>
        <dd>{model}</dd>
      </div>
    </dl>
  );
}

/** Only an embedding route that exists is fixed, so a purpose with none carries no note. */
function FixedNote(properties: { readonly route: WorkspaceRoute }) {
  const { route } = properties;
  if (route.purpose !== FIXED_PURPOSE || !isSet(route)) return null;
  return (
    <>
      <p className="mt-2">
        {/* The outline is decoration: a reader who cannot see it loses nothing. */}
        <Badge variant="outline">{ROUTES_WORDS.fixed}</Badge>{" "}
        {route.dimensions === null ? null : (
          <span className="text-muted-foreground">{route.dimensions} dimensions</span>
        )}
      </p>
      <p className="mt-1 text-muted-foreground">{ROUTES_WORDS.fixedReason}</p>
    </>
  );
}

function RouteRow(properties: { readonly route: WorkspaceRoute }) {
  const { route } = properties;
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <h3 className="font-medium text-foreground">{PURPOSE_NAMES[route.purpose]}</h3>
      <RouteFields route={route} />
      <FixedNote route={route} />
    </li>
  );
}

/** With no route set, one line says so rather than five rows each saying it. */
function RouteList(properties: { readonly routes: readonly WorkspaceRoute[] }) {
  if (!properties.routes.some(isSet)) return <p>{ROUTES_WORDS.noneSet}</p>;
  return (
    <ul>
      {properties.routes.map((route) => (
        <RouteRow key={route.purpose} route={route} />
      ))}
    </ul>
  );
}

export function RoutesCard() {
  const routes = useWorkspaceRoutes();

  return (
    <section aria-labelledby="routes" className="mt-6 border border-border bg-card p-4">
      <h2 id="routes">Routes</h2>
      <p className="mt-2 text-muted-foreground">{ROUTES_WORDS.lead}</p>

      <div aria-live="polite" className="mt-4">
        {routes.isPending ? <p>{ROUTES_WORDS.loading}</p> : null}
        {routes.isError ? <p>{ROUTES_WORDS.failed}</p> : null}
        {routes.data === undefined ? null : <RouteList routes={routes.data} />}
      </div>
    </section>
  );
}
