/**
 * The tRPC module's interface: the mount the server factory takes, the router type the
 * SPA is typed by, and the path both agree on. Everything else — the context shape,
 * the workspace procedure, the refusal mapping — is the module's own.
 */
export { appRouter, type AppRouter } from "./router.ts";
export { createTrpcRoutes, TRPC_ENDPOINT, type TrpcRoutesDependencies } from "./mount.ts";
