import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";

import type { AppRouter } from "@better-answers/api/trpc";

/**
 * The SPA's one pre-configured tRPC client, and the only file in `apps/web` that names
 * `apps/api` at all.
 *
 * ADR 0006 said the two never import each other; its 2026-09-02 amendment admits one
 * exception, and this is it: `AppRouter` arrives as an `import type`, so `verbatimModuleSyntax`
 * erases the import and the built bundle holds no reference to the api. The `.oxlintrc.json`
 * override for this path allows exactly that import and nothing else — a value import here, or
 * an `import type` in any second file, is a lint error.
 *
 * Request declarations do not live here. A feature owns the queries it issues (`features/`);
 * shared owns the client they are issued through.
 */

/**
 * The path the api's router answers on. It is stated rather than imported because importing
 * `TRPC_ENDPOINT` from `@better-answers/api/trpc` would be a runtime edge to the api, which is
 * the thing the amendment refuses. The browser suite is what holds the two strings together:
 * a client pointed at the wrong path reaches no procedure.
 */
export const TRPC_ENDPOINT = "/trpc";

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

/**
 * A relative URL, because the api serves this build on the same origin (ADR 0006, amended
 * 2026-09-02) and the session cookie therefore needs no cross-origin arrangement.
 */
export const createApiClient = () =>
  createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: TRPC_ENDPOINT })] });
