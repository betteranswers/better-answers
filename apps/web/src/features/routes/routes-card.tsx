import { Badge } from "@/shared/ui/badge.tsx";

import { useWorkspaceRoutes, type WorkspaceRoute } from "./list-routes.ts";

const PURPOSE_NAMES = {
  extraction: "Extraction",
  enrichment: "Enrichment",
  answering: "Answering",
  judging: "Judging",
  embedding: "Embedding",
} as const satisfies Record<WorkspaceRoute["purpose"], string>;

const FIXED_PURPOSE: WorkspaceRoute["purpose"] = "embedding";

const FIXED_REASON =
  "An embedding route never changes once vectors exist: every vector already written was made by the route's model, and a different one would leave them unreadable.";

function RouteFields(properties: { readonly route: WorkspaceRoute }) {
  const { provider, model } = properties.route;
  if (provider === null || model === null) {
    return <p className="mt-1 text-muted-foreground">No route is set.</p>;
  }
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

function RouteRow(properties: { readonly route: WorkspaceRoute }) {
  const { route } = properties;
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <h3 className="font-medium text-foreground">{PURPOSE_NAMES[route.purpose]}</h3>
      <RouteFields route={route} />
      {route.purpose === FIXED_PURPOSE ? (
        <>
          <p className="mt-2">
            {/* The outline is decoration: a reader who cannot see it loses nothing. */}
            <Badge variant="outline">Fixed</Badge>{" "}
            {route.dimensions === null ? null : (
              <span className="text-muted-foreground">{route.dimensions} dimensions</span>
            )}
          </p>
          <p className="mt-1 text-muted-foreground">{FIXED_REASON}</p>
        </>
      ) : null}
    </li>
  );
}

export function RoutesCard() {
  const routes = useWorkspaceRoutes();

  return (
    <section aria-labelledby="routes" className="mt-6 border border-border bg-card p-4">
      <h2 id="routes">Routes</h2>
      <p className="mt-2 text-muted-foreground">
        Which model does which job in this workspace. Listed only: choosing a route is not part of
        this screen.
      </p>

      <div aria-live="polite" className="mt-4">
        {routes.isPending ? <p>The routes are still loading.</p> : null}
        {routes.isError ? (
          <p>
            This workspace's routes did not load, so none are listed below. An Admin can take it up
            with the platform.
          </p>
        ) : null}
        {routes.data === undefined ? null : (
          <ul>
            {routes.data.map((route) => (
              <RouteRow key={route.purpose} route={route} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
