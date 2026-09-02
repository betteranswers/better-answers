/**
 * The tRPC module's interface: the mount the server factory takes, the router type the
 * SPA is typed by, and the path both agree on. Everything else — the context shape,
 * the workspace procedure, the refusal mapping — is the module's own.
 */
export {
  appRouter,
  createTrpcRoutes,
  TRPC_ENDPOINT,
  type AppRouter,
  type TrpcRoutesDependencies,
} from "./router.ts";
