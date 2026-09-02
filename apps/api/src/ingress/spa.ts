import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, MiddlewareHandler } from "hono";

import { hostnameOfUrl } from "./hostnames.ts";

/**
 * The single-page app's static build, served on the `app.` hostname (ADR 0006, amended
 * 2026-09-02: the api serves the SPA, so the product and the api are one origin and the
 * session cookie needs no cross-origin arrangement between them).
 *
 * It is two pieces, mounted at two points in `server.ts`, because a build has two kinds of
 * address and they want opposite answers:
 *
 * - **`assets`** answers a path the build actually holds — the hashed bundles, the shell at
 *   `/`. It is a file lookup, so it can run early without claiming anything it does not
 *   have.
 * - **`shell`** answers a *screen's* address — `/system`, `/people` — which is a path
 *   nothing on disk holds. It runs **after** Better Auth's wildcard has declined, and only
 *   then, so no endpoint of the authorization server can be shadowed by it: Better Auth is
 *   mounted at `/*` with `basePath: "/"` and its own set grows with the library, which is
 *   exactly why the shell must not be the one guessing which paths are its own.
 *
 * The remaining condition on `shell` is that the caller is asking for a document and not
 * for a file: a missing bundle has to stay a 404, because a script tag that is answered
 * with HTML fails with a syntax error a long way from its cause.
 */

export type SpaBuild = {
  /** The directory `vite build` wrote, or `undefined` when this process has no build to serve. */
  readonly root: string | undefined;
  /** The `app.` hostname; the SPA is served there and nowhere else (ADR 0022). */
  readonly hostname: string;
};

export type SpaServing = {
  /** The files the build holds, ahead of the authorization server. */
  readonly assets: MiddlewareHandler;
  /** A screen's address, behind it; `undefined` when this request is not one. */
  readonly shell: (context: Context) => Promise<Response | undefined>;
};

/** A path with a file extension is asking for a file, not for a screen. */
const asksForAFile = (path: string): boolean => /\.[^./]+$/.test(path);

const asksForADocument = (accept: string | undefined): boolean =>
  accept !== undefined && accept.includes("text/html");

const isReadOnly = (method: string): boolean => method === "GET" || method === "HEAD";

/**
 * The shell is one file behind hashed asset names, so a browser holding yesterday's copy
 * would load yesterday's build until it happened to revalidate. Set on the response rather
 * than on the context, so it reaches the shell however the shell was found.
 */
const revalidateHtml = (response: Response): Response => {
  if (response.headers.get("content-type")?.includes("text/html") === true) {
    response.headers.set("cache-control", "no-cache");
  }
  return response;
};

const passed = async (): Promise<void> => {};

export const serveSpa = (build: SpaBuild): SpaServing => {
  const root = build.root;
  // A process with no build — every test that is not about the SPA, and a `migrate` run —
  // passes the request straight on rather than logging a missing directory per request.
  if (root === undefined) {
    return { assets: async (_context, next) => next(), shell: async () => undefined };
  }

  const file = serveStatic({ root });
  const index = serveStatic({ root, path: "index.html" });

  // The hostname the fence itself compares on, so a form it admits — a trailing DNS dot,
  // an upper-case `Host` — cannot mean one thing there and another here.
  const isTheProduct = (context: Context): boolean =>
    hostnameOfUrl(context.req.url) === build.hostname;

  const assets: MiddlewareHandler = async (context, next) => {
    if (!isReadOnly(context.req.method) || !isTheProduct(context)) return next();
    const served = await file(context, passed);
    return served === undefined ? next() : revalidateHtml(served);
  };

  const shell: SpaServing["shell"] = async (context) => {
    if (!isReadOnly(context.req.method) || !isTheProduct(context)) return undefined;
    if (asksForAFile(context.req.path)) return undefined;
    if (!asksForADocument(context.req.header("accept"))) return undefined;
    const served = await index(context, passed);
    return served === undefined ? undefined : revalidateHtml(served);
  };

  return { assets, shell };
};
