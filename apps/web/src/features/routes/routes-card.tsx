import { useWorkspaceRoutes, type WorkspaceRoute } from "./list-routes.ts";

/**
 * The System screen's first card: the workspace's routes, one row per purpose, read-only.
 *
 * `[UX1]`, the disclosure rule: a row leads with what a reader needs to judge it — the purpose,
 * the provider and the model — and the embedding row's dimension count and fixed-route line
 * come after them, on the one row they are about. Nothing here is a second pane, a modal or a
 * tooltip. Trust and state are words: *Fixed* is a text tag, and the border it sits in is
 * decoration a reader can lose without losing the meaning.
 *
 * The list is five rows whatever the workspace has chosen, because a purpose with no route is
 * a thing a reader must be able to see. Omitting it would say "there are three purposes".
 *
 * No control edits, adds or deletes a route: editing is a later ticket with its own gating, and
 * a disabled control here would be an action the platform cannot yet honour (`[UX1]`).
 *
 * WCAG 2.2 AA, tested with a keyboard and a screen reader (`[A11Y1]`): a labelled region, a
 * heading per row and a list a screen reader can count, and no focusable element at all — the
 * card adds nothing to the tab order because it holds nothing to operate.
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
 * Why the embedding route is fixed, in one sentence, on the row it is about (ADR 0020's hosted-
 * embedding amendment). It says the consequence rather than the rule, because the rule — that
 * the database refuses it (T-029) — is not what a reader needs to know to stop looking for a
 * control.
 */
const FIXED_REASON =
  "This route is fixed once the workspace holds vectors: the vectors already written were made by this model, and a different one would leave them unreadable.";

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
      {route.fixed && route.dimensions !== null ? (
        <>
          <p className="mt-2">
            <span className="border border-border px-1.5 py-0.5">Fixed</span>{" "}
            <span className="text-muted-foreground">{route.dimensions} dimensions</span>
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
        must never mistake "the platform has not answered" for "this workspace has none"
        (`[UX1]`). `aria-live` because the list replaces this line without moving focus.
      */}
      <div aria-live="polite" className="mt-4">
        {routes.isPending ? <p>The routes are still loading.</p> : null}
        {routes.isError ? (
          <p>The routes could not be read: {routes.error.message}. Nothing is listed below.</p>
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
