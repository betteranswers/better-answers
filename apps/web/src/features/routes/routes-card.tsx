import { Badge } from "@/shared/ui/badge.tsx";

import { useWorkspaceRoutes, type WorkspaceRoute } from "./list-routes.ts";

/**
 * The System screen's first card: the workspace's routes, one row per purpose, read-only.
 *
 * The disclosure rule: a row leads with what a reader needs to judge it — the purpose,
 * the provider and the model — and the embedding row's fixed tag, its why-line and its dimension
 * count come after them, on the one row they are about. Nothing here is a second pane, a modal
 * or a tooltip. Trust and state are words: *Fixed* is a text tag on the registry's `Badge`, and
 * the outline it sits in is decoration a reader can lose without losing the meaning.
 *
 * The list is five rows whatever the workspace has chosen, because a purpose with no route is
 * a thing a reader must be able to see. Omitting it would say "there are three purposes".
 *
 * No control edits, adds or deletes a route: editing is a later ticket with its own gating, and
 * a disabled control here would be an action the platform cannot yet honour.
 *
 * WCAG 2.2 AA: a labelled region, a heading per row and a list a screen reader can
 * count, and no focusable element at all — the card adds nothing to the tab order because it
 * holds nothing to operate. The evidence is in `apps/web/e2e/routes.spec.ts`: an `axe` pass, a
 * keyboard traversal, and an aria snapshot of the announced structure.
 */

/** The purpose as a reader reads it. Sentence case, British spelling, and the glossary's words. */
const PURPOSE_NAMES = {
  extraction: "Extraction",
  enrichment: "Enrichment",
  answering: "Answering",
  judging: "Judging",
  embedding: "Embedding",
} as const satisfies Record<WorkspaceRoute["purpose"], string>;

/**
 * The one purpose whose route is *fixed* (`CONTEXT.md`, *route*; ADR 0020's amendment).
 *
 * The row keys on the purpose rather than on the wire's `fixed`, which is true only of a route
 * that has been chosen — there is nothing for a vector to depend on until then. What a reader
 * needs is the opposite reading: the embedding purpose will never have a control, chosen or not.
 */
const FIXED_PURPOSE: WorkspaceRoute["purpose"] = "embedding";

/**
 * Why the embedding route is fixed, in one sentence, on the row it is about. It says the
 * consequence rather than the rule, because the rule — that the database refuses the change
 * (T-029) — is not what a reader needs to know in order to stop looking for a control.
 *
 * It is worded to be true of the row whether or not a route has been chosen, because the row
 * carries it either way: *fixed* is what the platform has decided about the embedding purpose,
 * not something a particular choice acquires.
 */
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
            <Badge variant="outline">Fixed</Badge>{" "}
            {/*
              The count is the chosen model's vector width, so it is shown only once a route has
              been chosen. The tag and the line above it stand either way: a reader looking at an
              unconfigured embedding purpose must learn there will never be a control here.
            */}
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

      {/*
        A pending or failed read says so in words rather than showing an empty list: a reader
        must never mistake "the platform has not answered" for "this workspace has none".
        `aria-live` because the list replaces this line without moving focus.

        The failure says what happened and who can act, in the platform's own voice — the
        design system's voice card: precise, and never a hedge asking the reader to try
        something. The refusal's own name is the api's word for the api's readers, and it is
        already in the browser's network log; putting it on the screen would be the platform
        handing a reader a string it cannot act on.
      */}
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
