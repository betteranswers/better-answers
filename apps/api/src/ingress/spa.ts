import { serveStatic } from "@hono/node-server/serve-static";
import type { MiddlewareHandler } from "hono";

/**
 * The single-page app's static build, served on the `app.` hostname (ADR 0006, amended
 * 2026-09-02: the api serves the SPA, so the product and the api are one origin and the
 * session cookie needs no cross-origin arrangement between them).
 *
 * Why this is a middleware ahead of Better Auth's wildcard rather than a route: the
 * authorization server is mounted at `/*` with `basePath: "/"`, so it answers every path
 * this process has not already claimed, and `/system` would be its 404 rather than the
 * shell. What keeps it from shadowing an endpoint is the two conditions below — the file
 * has to exist, or the caller has to be asking for a document. Better Auth's endpoints are
 * reached by `fetch`, whose default `Accept` is the bare wildcard; a browser following a
 * link or typing an address sends `text/html`. That is the whole distinction, and it is
 * the one history-fallback servers have used for a decade.
 */

export type SpaBuild = {
  /** The directory `vite build` wrote, or `undefined` when this process has no build to serve. */
  readonly root: string | undefined;
  /** The `app.` hostname; the SPA is served there and nowhere else (ADR 0022). */
  readonly hostname: string;
};

/** A path with a file extension is asking for a file, not for a screen. */
const asksForAFile = (path: string): boolean => /\.[^./]+$/.test(path);

const asksForADocument = (accept: string | undefined): boolean =>
  accept !== undefined && accept.includes("text/html");

export const serveSpa = (build: SpaBuild): MiddlewareHandler => {
  const root = build.root;
  // A process with no build — every test that is not about the SPA, and a `migrate` run —
  // passes the request straight on rather than logging a missing directory per request.
  if (root === undefined) return async (_context, next) => next();

  const file = serveStatic({ root });
  const shell = serveStatic({ root, path: "index.html" });
  const missed = async (): Promise<void> => {};

  return async (context, next) => {
    const method = context.req.method;
    if (method !== "GET" && method !== "HEAD") return next();
    if (new URL(context.req.url).hostname !== build.hostname) return next();

    const served = await file(context, missed);
    if (served !== undefined) return served;

    if (asksForAFile(context.req.path) || !asksForADocument(context.req.header("accept"))) {
      return next();
    }

    // The shell is one file behind hashed asset names, so a browser holding yesterday's
    // copy would load yesterday's build until it happened to revalidate.
    context.header("cache-control", "no-cache");
    return shell(context, missed);
  };
};
