---
title: "A closed Better Auth endpoint still runs as a server function, without the router's guards"
date: 2026-10-02
category: best-practices
module: apps/api
problem_type: best_practice
component: identity
severity: high
applies_when:
  - "Writing an api route in apps/api/src/auth/ that calls a Better Auth endpoint closed by disabledPaths as an auth.api server function (enableTwoFactor, verifyTOTP, passkey registration)"
  - "Relying on Better Auth's rate limiter, plugin onRequest hooks or origin check to guard a route that calls auth.api directly"
  - "Adding a field to a Better Auth plugin's table through the plugin's schema option"
  - "Changing session.freshAge, or calling an endpoint guarded by freshSessionMiddleware as a server function"
  - "Assuming the twoFactor plugin turns every sign-in method (email code, passkey, social) into a second-factor challenge"
related_components:
  - transports
tags:
  - better-auth
  - disabled-paths
  - server-functions
  - rate-limit
  - origin-check
  - second-factor
  - passkey
  - plugin-schema
retire_when: "better-auth past 1.7.5 changes any of: disabledPaths, the rate limiter, plugin onRequest hooks and the origin check applying only in the HTTP router (dist/api/index.mjs); mergeSchema only renaming a plugin's model and fields (dist/db/schema.mjs); or the twoFactor sign-in hook matching only /sign-in/email, /sign-in/username and /sign-in/phone-number (dist/plugins/two-factor/index.mjs). Check the better-auth release notes and those dist files in the installed version"
---

# A closed Better Auth endpoint still runs as a server function, without the router's guards

## Context

The api's Better Auth 1.7.5 instance (`createAuth` in `apps/api/src/auth/auth.ts`) registers the authenticator plugin (`twoFactor` in `auth.ts`) and the passkey plugin (`passkeyPlugin` in `auth.ts`). Every path the two plugins mount is closed through `disabledPaths` (`auth.ts`), from the lists `CLOSED_FACTOR_PATHS` (`closed-paths.ts`) and `CLOSED_SESSION_PATHS` (`closed-paths.ts`). The comment above the factor list, as `9e6f06db5` holds it, gives the reason. Each path adds, removes, reveals or spends a factor past our gate, and our routes call the few they need as server functions (`CLOSED_FACTOR_PATHS` in `closed-paths.ts`).

U6 (passkeys) and U7 (authenticator, recovery codes) of the plan wrote those routes in `apps/api/src/auth/second-factor/` (`passkeys.ts`, `authenticator.ts`, and `confirm.ts` for re-confirming). They call `auth.api.enableTwoFactor`, `auth.api.verifyTOTP` and the passkey endpoints directly, each behind `fenced.asThePerson` (`person-routes.ts`), which carries a per-person rate rule, `sameOriginOnly` and the second-factor gate. This doc records what such a call carries and what it loses, read from the installed library. It also records two schema facts that the U5 change for BA-28 settled on the way.

A `dist/...` citation below is a path inside the installed package (`node_modules/.pnpm/better-auth@1.7.5_*/node_modules/better-auth/`, or the named package), not in the repository.

The plan carried two open assumptions for U5. Both were checked against the library source:

1. `disabledPaths` closes the HTTP route but leaves the server function callable. True.
2. The passkey plugin's `schema` option accepts an extra field of ours. False.

The plan's own research had already found that the library's sign-in challenge covers password sign-in only, which is why the plan builds its own gate (session history).

## Guidance

### `disabledPaths` lives in the router, and so do the other request guards

Better Auth checks `disabledPaths` in one place: the router's `onRequest`, which answers `404 Not Found` for a listed path (`better-auth 1.7.5 dist/api/index.mjs`). An `auth.api.<endpoint>()` call never enters the router. It goes through `toAuthEndpoints` straight to `dispatchAuthEndpoint` (`dist/api/to-auth-endpoints.mjs`). So a closed endpoint still runs when the api calls it. The test harness's `authOver` exists for exactly this (`apps/api/tests/support/auth-instance.ts`).

The 404 is not the only thing that lives in the router. A server-function call also skips:

- The rate limiter, `onRequestRateLimit` (`dist/api/index.mjs`). That covers the library's default rules and every plugin's own rule (`resolveRateLimitConfig` in `dist/api/rate-limiter/index.mjs`). The authenticator plugin ships a rule of 3 requests per 10 seconds for `/two-factor/*` (the `rateLimit` of `twoFactor` in `dist/plugins/two-factor/index.mjs`). It never applies to `auth.api.verifyTOTP`. Since 10/10/2026 the api switches that limiter off altogether (`rateLimit: { enabled: false }` in `auth.ts`) and counts each mounted endpoint itself, in Hono middleware in `apps/api/src/auth/routes.ts`. A server-function call skips that middleware just the same.
- Every plugin's `onRequest` hook (`plugin.onRequest` in `dist/api/index.mjs`).
- `originCheckMiddleware` and every plugin's router `middlewares` (`routerMiddleware` in `dist/api/index.mjs`, built in `getEndpoints`). Our `disableOriginCheck: false` (`auth.ts`) does nothing for a server call.

Some things still run, because they belong to the endpoint or to the dispatch rather than to the router:

- The endpoint's own `use` middlewares, such as `sessionMiddleware`, `sensitiveSessionMiddleware` and `freshSessionMiddleware`. better-call runs them inside every call of the endpoint (`createInternalContext` in `better-call 1.4.0 dist/context.mjs`, reached from `internalHandler` in `dist/endpoint.mjs`).
- `hooks.before` and `hooks.after`, ours and every plugin's (the comment on `toAuthEndpoints` in `dist/api/to-auth-endpoints.mjs`; the comment on `dispatchAuthEndpoint` in `dist/api/dispatch.mjs`, and its `runBeforeHooks` and `runAfterHooks` calls). Our audit hook in `createAuth` (`hooks` in `auth.ts`) therefore fires on a server call too. It records only the paths in `AUDITED_PATHS` (`audit-line.ts`, looked up by `auditedEvent`).

The comment on `dispatchAuthEndpoint` in `dist/api/dispatch.mjs` says that calling an endpoint as a plain function skips hooks. That means calling the raw endpoint object. `auth.api.*` is not that: it is the wrapped endpoint, and hooks run.

### What a route that calls a closed endpoint must carry

The route is the only guard the call has. It must bring:

1. The person's session cookie, forwarded as `headers`. `sessionMiddleware` throws `UNAUTHORIZED` with no session (`dist/api/routes/session.mjs`), and so does `freshSessionMiddleware`.
2. Its own rate rule. Nothing in Better Auth limits the call.
3. Its own same-origin fence. `sameOriginOnly` (`apps/api/src/auth/same-origin.ts`) is the shape the api already uses. It fences POST only.
4. The second-factor gate, and the platform's own freshness rule (next section).

The call shape, as the test helper makes it (`setUpAnAuthenticator` in `apps/api/tests/support/provoke.ts`):

```ts
const enabled = await auth.api.enableTwoFactor({
  headers: new Headers({ cookie: client.cookies() }),
  body: { method: "totp" },
});
await auth.api.verifyTOTP({
  headers: new Headers({ cookie: client.cookies() }),
  body: { code },
});
```

In a route, the headers come from the incoming request, after the route's own checks have passed.

### `freshAge: 0` turns the library's freshness check off everywhere

`createAuth` sets `session.freshAge: 0` (`apps/api/src/auth/auth.ts`), because the platform's confirmation stamp is the one freshness rule. Better Auth holds one global `freshAge`, with a default of one day (`sessionConfig` in `createAuthContext` in `dist/context/create-context.mjs`). `freshSessionMiddleware` skips its age check when the value is 0 (`dist/api/routes/session.mjs`). It still demands a session.

The checks that go quiet:

- `/list-sessions` (`listSessions` in `dist/api/routes/session.mjs`).
- `/unlink-account` (`unlinkAccount` in `dist/api/routes/account.mjs`).
- `/delete-user` without a password (`dist/api/routes/update-user.mjs`, inside the endpoint `deleteUser`). The file is named `update-user.mjs`, but `/update-user` itself has no freshness check.
- Passkey registration, under the default `registration.requireSession`: `/passkey/generate-register-options` and `/passkey/verify-registration` (`generatePasskeyRegistrationOptions` and `verifyPasskeyRegistration` in `@better-auth/passkey 1.7.5 dist/index.mjs`).

Nothing reachable changed here. The first two are in `CLOSED_SESSION_PATHS` and passkey registration is in `CLOSED_FACTOR_PATHS`. `/delete-user` refuses outright, because `createAuth` sets no `user.deleteUser` (the `deleteUser?.enabled` check in the `deleteUser` endpoint in `dist/api/routes/update-user.mjs`). So a route that calls passkey registration as a server function gets no freshness check from the library. The api's add routes apply the platform's own rule instead: a person who already holds a factor must re-confirm before adding another, and is refused 412 `confirmationTooOld` while `factorChangeStale` holds (`heldForAnAdd` in `apps/api/src/auth/second-factor/passkeys.ts`, `refusedAFirstSetup` in `authenticator.ts`). A first factor has nothing to re-confirm against.

### A plugin's `schema` option renames; it cannot add a field

Both plugins pass their `schema` option through `mergeSchema` (the `mergeSchema` call in `twoFactor` in `dist/plugins/two-factor/index.mjs`; `passkey` in `@better-auth/passkey 1.7.5 dist/index.mjs`). `mergeSchema` sets `modelName`, and sets `fieldName` only on fields the plugin already declares (`dist/db/schema.mjs`). It walks the plugin's own fields, so a key it does not know is never read and raises no error. A last-used time cannot ride on the passkey row. It lives in its own table, `passkey_last_use`, keyed by passkey id (`passkeyLastUse` in `packages/schema/src/people/identity-tables.ts`). That was the plan's fallback.

Renames do work, and our config uses them. The authenticator plugin's `twoFactor` model becomes the `authenticator` table, and `twoFactorEnabled` becomes `authenticatorEnabled` (the `twoFactor` plugin's `schema` in `apps/api/src/auth/auth.ts`). With the drizzle adapter, the renamed `fieldName` must be a key on the drizzle table object. The adapter looks the column up by that key and throws "The field ... does not exist in the schema" when it is missing (`resolveFieldName` in `@better-auth/drizzle-adapter 1.7.5 dist/index.mjs`). Our table carries `authenticatorEnabled` as its key (`user` in `identity-tables.ts`). The older renames, `organization: { modelName: "workspace" }` and `session: { fields: { activeOrganizationId: "activeWorkspaceId" } }`, follow the same rule.

The rename is a storage name only. The library's code keeps the logical name: the authenticator plugin's after-hook tests `data?.user.twoFactorEnabled` (the `hooks` of `twoFactor` in `dist/plugins/two-factor/index.mjs`).

### The library's sign-in challenge covers three paths

The authenticator plugin's after-hook turns a sign-in into a challenge only for `/sign-in/email`, `/sign-in/username` and `/sign-in/phone-number` (its `matcher` in `dist/plugins/two-factor/index.mjs`). Email-code, passkey and social sign-in are not on that list. They mint a whole session even for a person with an authenticator. That is why the plan builds its own gate (KTD1).

## Why This Matters

A 404 over HTTP makes a closed endpoint look guarded. It is guarded only from the router. Called from our route, the same endpoint runs with no rate limit, no origin check, no library freshness check and no sign-in challenge. If the route does not carry these itself, an authenticator code can be guessed at whatever rate the route allows, a cross-site request meets no origin check, and a passkey can be registered on a session that is no longer fresh. The call succeeds either way, so nothing signals the gap.

The schema fact saves a dead end. A field added through a plugin's `schema` option is dropped without an error, so the column would exist in the table and the library would never write it.

## When to Apply

- Writing any route in `apps/api/src/auth/` that calls `auth.api.<endpoint>()` for a path in `disabledPaths`.
- Adding a field to a plugin's model, or renaming one through a plugin's `schema` option.
- Relying on `session.freshAge`, or changing it.
- Adding a sign-in method, or assuming the library challenges a sign-in for the second factor.
- Upgrading `better-auth` or `@better-auth/passkey`. Each citation here is a 1.7.5 fact; re-read the cited code before trusting it. Read against 1.7.7 on 11/10/2026 (BA-147): the three files the retire condition names (`dist/api/index.mjs`, `dist/db/schema.mjs`, `dist/plugins/two-factor/index.mjs`) are byte for byte 1.7.5's, so this doc stands. Both files differ from 1.7.5's elsewhere, but the code cited from them (`resolveRateLimitConfig`, and the `enabled` and `freshAge` checks in `deleteUser`) is unchanged.

## Examples

`apps/api/tests/auth/second-factor/second-factor-foundation.test.ts` pins the shape:

- `setUpAnAuthenticator` (`apps/api/tests/support/provoke.ts`) enrols an authenticator through `auth.api.enableTwoFactor` and `auth.api.verifyTOTP`, over `authOver`. The rows land: `authenticator_enabled` and `verified` both read true (`authenticatorHeldBy` in `second-factor-foundation.test.ts`).
- The same suite asks every factor path and every closed session path over HTTP, as a signed-in person, and gets 404 for both GET and POST ("answers %s as absent, to a signed-in person"). The factor paths are read off the built instance (`FACTOR_PATHS`), so a path a plugin adds on an upgrade is held closed too.
- "gets a pending session, refused until it confirms" pins the gap's close for email-code sign-in. An Admin with an authenticator signs in again by email code. `/get-session` answers, but `/me` answers 403 `second-factor-pending`, so our gate holds it, not the library's challenge. Passkey and social sign-in follow from the same matcher, but no test here pins them.

## Related

- ADR 0009, `docs/solutions/architecture-patterns/adr-0009.md`: why Better Auth runs in-process behind a seam, and the `disabledPaths` precedent for the organisation plugin.
- ADR 0034, `docs/solutions/architecture-patterns/adr-0034.md`: the one origin, the same-origin fence on the api's own auth routes, and the endpoint snapshot.
- The plan, `docs/plans/2026-10-01-2241-feat-people-sign-in-and-security-plan.md`: KTD1 (our gate), KTD2 (closed endpoints, library-owned writes), and U6 and U7, which write the routes this doc is for.
