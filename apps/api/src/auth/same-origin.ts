import type { MiddlewareHandler } from "hono";

import { refusedPage, REFUSAL_PAGES } from "./pages.ts";

/** Refuses a post from another site; a library check never reaches a route of our own. */
export const sameOriginOnly = (publicUrl: string): MiddlewareHandler => {
  return async (context, next) => {
    if (context.req.method !== "POST") {
      await next();
      return;
    }
    const origin = context.req.header("origin");
    const site = context.req.header("sec-fetch-site");
    const sameOrigin =
      origin === publicUrl ||
      (origin === undefined && (site === undefined || site === "same-origin" || site === "none"));
    if (!sameOrigin) {
      return context.html(refusedPage(REFUSAL_PAGES.crossSite), 403);
    }
    await next();
  };
};
