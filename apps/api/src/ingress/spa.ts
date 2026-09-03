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
 * What every document this build serves carries, set on the response rather than on the
 * context so it reaches the shell however the shell was found.
 *
 * **Revalidation**: the shell is one file behind hashed asset names, so a browser holding
 * yesterday's copy would load yesterday's build until it happened to revalidate.
 *
 * **No frame, ever**: the shell answers every screen's address, and two of those addresses
 * are sign-in and the workspace picker (T-037). Those two were server-rendered pages until
 * this ticket and carried these headers there (T-004); the protection moves with them
 * rather than being dropped, because a framed sign-in is a person typing a code into
 * someone else's page, and a framed picker is a pick made for them. It is set on the whole
 * shell rather than on those two routes because the api cannot tell which screen a shell
 * request will render — the address is the router's to read — and no screen of this product
 * is ever framed by another site. `frame-ancestors 'none'` and the legacy header together,
 * as `auth/routes.ts` still does for consent.
 */
const documentHeaders = (response: Response): Response => {
  if (response.headers.get("content-type")?.includes("text/html") === true) {
    response.headers.set("cache-control", "no-cache");
    response.headers.set("content-security-policy", "frame-ancestors 'none'");
    response.headers.set("x-frame-options", "DENY");
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
    return served === undefined ? next() : documentHeaders(served);
  };

  const shell: SpaServing["shell"] = async (context) => {
    if (!isReadOnly(context.req.method) || !isTheProduct(context)) return undefined;
    if (asksForAFile(context.req.path)) return undefined;
    if (!asksForADocument(context.req.header("accept"))) return undefined;
    const served = await index(context, passed);
    return served === undefined ? undefined : documentHeaders(served);
  };

  return { assets, shell };
};
