import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, MiddlewareHandler } from "hono";

import { hostnameOfUrl } from "./hostnames.ts";

export type SpaBuild = {
  readonly root: string | undefined;

  readonly hostname: string;
};

export type SpaServing = {
  readonly assets: MiddlewareHandler;

  /** `undefined` without a build, or for anything but a read of a screen on the product's hostname. */
  readonly shell: (context: Context) => Promise<Response | undefined>;
};

const asksForAFile = (path: string): boolean => /\.[^./]+$/.test(path);

const asksForADocument = (accept: string | undefined): boolean =>
  accept !== undefined && accept.includes("text/html");

const isReadOnly = (method: string): boolean => method === "GET" || method === "HEAD";

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

  if (root === undefined) {
    return { assets: async (_context, next) => next(), shell: async () => undefined };
  }

  const file = serveStatic({ root });
  const index = serveStatic({ root, path: "index.html" });

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
