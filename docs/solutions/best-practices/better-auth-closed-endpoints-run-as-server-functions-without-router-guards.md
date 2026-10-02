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

The api's Better Auth 1.7.5 instance (`createAuth`, `apps/api/src/auth/auth.ts:318`) registers the authenticator plugin (`twoFactor`, `auth.ts:602-611`) and the passkey plugin (`auth.ts:612-617`). Every path the two plugins mount is closed through `disabledPaths` (`auth.ts:399-405`), from the lists `CLOSED_FACTOR_PATHS` (`auth.ts:151-167`) and `CLOSED_SESSION_PATHS` (`auth.ts:173-180`). The comment above the factor list gives the reason. Each path adds, removes, reveals or spends a factor past our gate, and our routes call the few they need as server functions (`auth.ts:147-150`).

U6 (passkeys) and U7 (authenticator, recovery codes) of the plan will write those routes in `apps/api/src/auth/`. They will call `auth.api.enableTwoFactor`, `auth.api.verifyTOTP` and the passkey registration endpoints directly. This doc records what such a call carries and what it loses, read from the installed library. It also records two schema facts that the U5 change for BA-28 settled on the way.

A `dist/...` citation below is a path inside the installed package (`node_modules/.pnpm/better-auth@1.7.5_*/node_modules/better-auth/`, or the named package), not in the repository.

The plan carried two open assumptions for U5. Both were checked against the library source:

1. `disabledPaths` closes the HTTP route but leaves the server function callable. True.
2. The passkey plugin's `schema` option accepts an extra field of ours. False.

The plan's own research had already found that the library's sign-in challenge covers password sign-in only, which is why the plan builds its own gate (session history).

## Guidance

### `disabledPaths` lives in the router, and so do the other request guards

Better Auth checks `disabledPaths` in one place: the router's `onRequest`, which answers `404 Not Found` for a listed path (`better-auth 1.7.5 dist/api/index.mjs:165-168`). An `auth.api.<endpoint>()` call never enters the router. It goes through `toAuthEndpoints` straight to `dispatchAuthEndpoint` (`dist/api/to-auth-endpoints.mjs:34-53`). So a closed endpoint still runs when the api calls it. The test harness's `authOver` exists for exactly this (`apps/api/tests/auth-instance.ts:23-24`).

The 404 is not the only thing that lives in the router. A server-function call also skips:

- The rate limiter, `onRequestRateLimit` (`dist/api/index.mjs:172-173`). That covers the library's default rules, every plugin's own rule and our `customRules` from `BETTER_AUTH_RATE_LIMIT` (`dist/api/rate-limiter/index.mjs:246-276`; `apps/api/src/auth/constants.ts:62-75`). The authenticator plugin ships a rule of 3 requests per 10 seconds for `/two-factor/*` (`dist/plugins/two-factor/index.mjs:338-344`). It never applies to `auth.api.verifyTOTP`.
- Every plugin's `onRequest` hook (`dist/api/index.mjs:174-181`).
- `originCheckMiddleware` and every plugin's router `middlewares` (`dist/api/index.mjs:159-162`, built at `:92-112`). Our `disableOriginCheck: false` (`auth.ts:444`) does nothing for a server call.

Some things still run, because they belong to the endpoint or to the dispatch rather than to the router:

- The endpoint's own `use` middlewares, such as `sessionMiddleware`, `sensitiveSessionMiddleware` and `freshSessionMiddleware`. better-call runs them inside every call of the endpoint (`better-call 1.4.0 dist/context.mjs:83-96`, reached from `dist/endpoint.mjs:14`).
- `hooks.before` and `hooks.after`, ours and every plugin's (`dist/api/to-auth-endpoints.mjs:28-33`; `dist/api/dispatch.mjs:177-178`, `:209-210`, `:245`). Our audit hook in `createAuth` (`auth.ts:464`) therefore fires on a server call too. It records only the paths in `AUDITED_PATHS` (`auth.ts:119-125`, `:466`).

`dist/api/dispatch.mjs:180-181` says that calling an endpoint as a plain function skips hooks. That means calling the raw endpoint object. `auth.api.*` is not that: it is the wrapped endpoint, and hooks run.

### What a route that calls a closed endpoint must carry

The route is the only guard the call has. It must bring:

1. The person's session cookie, forwarded as `headers`. `sessionMiddleware` throws `UNAUTHORIZED` with no session (`dist/api/routes/session.mjs:292-299`), and so does `freshSessionMiddleware` (`:331-336`).
2. Its own rate rule. Nothing in Better Auth limits the call.
3. Its own same-origin fence. `sameOriginOnly` (`apps/api/src/auth/routes.ts:99-116`) is the shape the api already uses. It is local to that file and fences POST only.
4. The second-factor gate, and the platform's own freshness rule (next section).

The call shape, as the U5 test makes it (`apps/api/tests/second-factor-foundation.test.ts:71-83`):

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

`createAuth` sets `session.freshAge: 0` (`auth.ts:422`), because the platform's confirmation stamp is the one freshness rule. Better Auth holds one global `freshAge`, with a default of one day (`dist/context/create-context.mjs:149`). `freshSessionMiddleware` skips its age check when the value is 0 (`dist/api/routes/session.mjs:337-341`). It still demands a session.

The checks that go quiet:

- `/list-sessions` (`dist/api/routes/session.mjs:350`).
- `/unlink-account` (`dist/api/routes/account.mjs:263`).
- `/delete-user` without a password (`dist/api/routes/update-user.mjs:333-336`, inside the endpoint that opens at `:233`). The file is named `update-user.mjs`, but `/update-user` itself has no freshness check.
- Passkey registration, under the default `registration.requireSession`: `/passkey/generate-register-options` and `/passkey/verify-registration` (`@better-auth/passkey 1.7.5 dist/index.mjs:88`, `:324`).

Nothing reachable changed here. The first two are in `CLOSED_SESSION_PATHS` and passkey registration is in `CLOSED_FACTOR_PATHS`. `/delete-user` refuses outright, because `createAuth` sets no `user.deleteUser` (`dist/api/routes/update-user.mjs:292`). But a U6 route that calls passkey registration as a server function gets no freshness check from the library. It must apply the platform's own.

### A plugin's `schema` option renames; it cannot add a field

Both plugins pass their `schema` option through `mergeSchema` (`dist/plugins/two-factor/index.mjs:331`; `@better-auth/passkey 1.7.5 dist/index.mjs:798`). `mergeSchema` sets `modelName`, and sets `fieldName` only on fields the plugin already declares (`dist/db/schema.mjs:147-159`). It walks the plugin's own fields, so a key it does not know is never read and raises no error. A last-used time cannot ride on the passkey row. It lives in its own table, `passkey_last_use`, keyed by passkey id (`packages/schema/src/identity-tables.ts:413-414`). That was the plan's fallback.

Renames do work, and our config uses them. The authenticator plugin's `twoFactor` model becomes the `authenticator` table, and `twoFactorEnabled` becomes `authenticatorEnabled` (`auth.ts:608-609`). With the drizzle adapter, the renamed `fieldName` must be a key on the drizzle table object. The adapter looks the column up by that key and throws "The field ... does not exist in the schema" when it is missing (`@better-auth/drizzle-adapter 1.7.5 dist/index.mjs:122-126`). Our table carries `authenticatorEnabled` as its key (`identity-tables.ts:38`). The older renames, `organization: { modelName: "workspace" }` and `session: { fields: { activeOrganizationId: "activeWorkspaceId" } }`, follow the same rule.

The rename is a storage name only. The library's code keeps the logical name: the authenticator plugin's after-hook tests `data?.user.twoFactorEnabled` (`dist/plugins/two-factor/index.mjs:251`).

### The library's sign-in challenge covers three paths

The authenticator plugin's after-hook turns a sign-in into a challenge only for `/sign-in/email`, `/sign-in/username` and `/sign-in/phone-number` (`dist/plugins/two-factor/index.mjs:244-246`). Email-code, passkey and social sign-in are not on that list. They mint a whole session even for a person with an authenticator. That is why the plan builds its own gate (KTD1).

## Why This Matters

A 404 over HTTP makes a closed endpoint look guarded. It is guarded only from the router. Called from our route, the same endpoint runs with no rate limit, no origin check, no library freshness check and no sign-in challenge. If the route does not carry these itself, an authenticator code can be guessed at whatever rate the route allows, a cross-site request meets no origin check, and a passkey can be registered on a session that is no longer fresh. The call succeeds either way, so nothing signals the gap.

The schema fact saves a dead end. A field added through a plugin's `schema` option is dropped without an error, so the column would exist in the table and the library would never write it.

## When to Apply

- Writing any route in `apps/api/src/auth/` that calls `auth.api.<endpoint>()` for a path in `disabledPaths`.
- Adding a field to a plugin's model, or renaming one through a plugin's `schema` option.
- Relying on `session.freshAge`, or changing it.
- Adding a sign-in method, or assuming the library challenges a sign-in for the second factor.
- Upgrading `better-auth` or `@better-auth/passkey`. Each line cited here is a 1.7.5 fact; re-read the ranges before trusting them.

## Examples

`apps/api/tests/second-factor-foundation.test.ts` pins the shape:

- `setUpAnAuthenticator` (`:71-83`) enrols an authenticator through `auth.api.enableTwoFactor` and `auth.api.verifyTOTP`, over `authOver`. The rows land: `authenticator_enabled` and `verified` both read true (`:103-105`).
- The same suite asks every factor path and every closed session path over HTTP, as a signed-in person, and gets 404 for both GET and POST (`:115-126`). The factor paths are read off the built instance (`:21-23`), so a path a plugin adds on an upgrade is held closed too.
- "gets a whole session while no gate stands" (`:98-113`) pins the sign-in gap for email-code sign-in. An Admin with an authenticator signs in again by email code and reads a whole session. Its comment says the session is pending once our gate stands, so the unit that lands the gate flips this expectation. Passkey and social sign-in follow from the same matcher but no test pins them.

## Related

- ADR 0009, `docs/solutions/architecture-patterns/adr-0009-better-auth-in-process-identity-provider.md`: why Better Auth runs in-process behind a seam, and the `disabledPaths` precedent for the organisation plugin.
- ADR 0034, `docs/solutions/architecture-patterns/adr-0034-one-origin-product-and-authorization-server.md`: the one origin, the same-origin fence on the api's own auth routes, and the endpoint snapshot.
- The plan, `docs/plans/2026-10-01-2241-feat-people-sign-in-and-security-plan.md`: KTD1 (our gate), KTD2 (closed endpoints, library-owned writes), and U6 and U7, which write the routes this doc is for.
