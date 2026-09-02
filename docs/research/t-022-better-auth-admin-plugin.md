# T-022 — Better Auth's `admin()` plugin: what adopting it here would require

Research only. Nothing in this document has been applied to the tree. Written
02/09/2026 against `better-auth@1.7.2` (the installed version, `apps/api/package.json`
[S1]; the docs' v1.7 line is the 1.7.x line [S2]) and the `v1.7.2` tag of the Better
Auth source. Every section cites its source; local file facts cite the file.

The question: adopt `admin()` on the server, `adminClient()` on the web client and
better-auth-ui's `adminPlugin()` "out of the box", and is there a concrete reason beyond
glossary wording not to.

---

## 1. Schema additions and how they would land

The plugin's schema adds four fields to `user` and one to `session` (`schema.ts` at
v1.7.2 [S3]):

| Model | Field | Type | Required | `input` | Default |
| --- | --- | --- | --- | --- | --- |
| user | `role` | string | no | false | none in schema; written by a hook (§2) |
| user | `banned` | boolean | no | false | `false` |
| user | `banReason` | string | no | false | none |
| user | `banExpires` | date | no | false | none |
| session | `impersonatedBy` | string | no | false | none |

`input: false` means the person cannot set them through sign-up; only the platform's
endpoints write them [S3].

**In this repo** the identity set is hand-carried drizzle, not CLI-generated: the shapes
were produced by `auth@1.7.2 generate` once and copied into
`packages/schema/src/identity-tables.ts` with three deliberate changes (timestamptz,
`organizationId → workspaceId`, no `member.role` default) [S4]. Adding `admin()` means:

- Five columns added by hand to `user` and `session` in `identity-tables.ts`
  (`role text`, `banned boolean default false`, `ban_reason text`,
  `ban_expires timestamptz`, `impersonated_by text`) [S3, S4].
- One new migration, `0007_*.sql`, with the `ALTER TABLE ... ADD COLUMN` lines; the
  identity set already has migrations `0004`–`0006` for exactly this class of change
  (`0006` is two `CHECK` constraints on `member.role` and `invitation.role`) [S5].
- No new tables, so `IDENTITY_SET` and the RLS coverage test's exemption list are
  untouched [S4, S6].
- **The columns are not optional once the plugin is on.** The plugin registers a
  `databaseHooks.user.create.before` that writes `role` on every user create, so the
  first email-OTP sign-in of a new person would insert a `role` column that does not
  exist and fail [S7]. The migration ships with the plugin or the sign-in breaks.
- `[SEC3]`: "A PR that touches `packages/schema/migrations` or any RLS policy gets an
  adversarial security pass before merge" [S8]. A `0007` migration draws that pass.

---

## 2. `user.role` beside `member.role`

**Two different things.** `member.role` is per workspace, one of `Admin`, `Editor`,
`Viewer`, held by a `CHECK` and narrowed by the boundary [S4, S5, S9]. `admin()`'s
`user.role` is one string on the `user` row, platform-wide, comma-separated for
multiple roles [S10].

**Default role.** The plugin's `user.create.before` hook returns
`{ role: options?.defaultRole ?? "user", ...user }` [S7], so every person created after
adoption carries `role = "user"` unless `defaultRole` is renamed. `defaultRole` is a
plain option [S11]; renaming it is supported.

**Which role is "admin".** `adminRoles` defaults to `["admin"]`; the plugin validates
each entry against the keys of `options.roles ?? defaultRoles`, case-insensitively, and
throws `BetterAuthError` on an unknown name [S7, S11]. So `adminRoles: ["Admin"]` is
allowed only if a role literally named `Admin` is in the `roles` map passed to `admin()`.

**Can `ac`/`roles` be shared with the organization plugin?** Permission checks call
`role.authorize(permissions)` on each role in `options.roles ?? defaultRoles` [S12].
`authorize` fails with "You are not allowed to access resource" when the role has no
statement for a requested resource (the default `AND` connector) [S13]. The admin
plugin asks for `user: ["list"]`, `user: ["create"]`, `user: ["delete"]`,
`user: ["impersonate"]` and so on [S14]. This repo's access controller has statements
only for `organization`, `member` and `invitation` [S9], so passing `accessControl` and
`roles` from `roles.ts` to `admin()` would make every admin call fail authorization,
including for `Admin`. Two ways out:

1. **One merged controller**: `createAccessControl({ ...orgStatement, ...defaultStatements })`
   with `Admin = ac.newRole({ ...orgGrants, ...adminAc.statements })` — the docs' own
   pattern for custom roles [S10]. This makes *every workspace Admin a platform admin*,
   because `admin()` reads the string on `user.role`, not the member row; the roles map
   is shared but the row it is read from is not.
2. **Two controllers**: keep `roles.ts` for `organization()`, add a second
   `createAccessControl(defaultStatements)` with its own role names for `admin()`. The
   docs show each plugin taking its own `ac` and `roles` [S10, S15]; nothing requires
   them to be one object. This is the only shape that keeps "Admin of a workspace" and
   "operator of the platform" apart.

**What the UI and client read.** `adminClient({ ac, roles })` mirrors the server's map
and exposes `checkRolePermission` over it [S16]. better-auth-ui's admin page does *not*
gate on the role string: it calls `authClient.admin.hasPermission({ user: ["list"] })`
and shows "Access Denied" unless the server answers `success: true` [S17, S18]; its
docs say "Do not authorize this page from a role string alone" and "Each server endpoint
remains the final security boundary" [S19]. Its `adminPlugin()` defaults are
`adminRoles: ["admin"]`, `roles: ["user", "admin"]`, `defaultRole: "user"`,
`allowMultipleRoles: true`, `pageSize: 20` — all options, all renameable, and its docs
require the same roles configured on `admin()` and `adminClient()` [S19, S20].

**`banned` and the session hook.** The ban check is a `databaseHooks.session.create.before`
that throws `FORBIDDEN` / `BANNED_USER` when `user.banned` is set and unexpired, and
auto-lifts an expired ban [S7]. Plugin hooks are pushed into the hooks array first and
the root `options.databaseHooks` last [S21]; `before` hooks run in sequence, each
receiving the accumulated data, and a throw propagates [S22]. So for a banned person the
plugin throws before this repo's own `session.create.before` (the sole-workspace
`activeOrganizationId` write, `auth.ts`) runs; for everyone else the two compose and the
repo's hook still sees the session it expects [S23].

`withPrincipal` never reads `banned`: the resolver's refusals are `not-a-member`,
`credentials-revoked`, `role-disagrees`, `role-unknown`, `malformed-claims` [S24]. A
ban stops *new sessions* only.

---

## 3. Overlap with `revokeCredentials` and ADR 0020's erasure routine

**`banUser` versus `revokeCredentials`.** `banUser` writes `banned`, `banReason`,
`banExpires`, `updatedAt` and calls `deleteUserSessions` [S14]. It does not touch
`oauth_refresh_token` or `oauth_access_token`, and the ban check fires on session
creation only [S7]. A refresh grant creates no session, so a banned person's connector
keeps minting access tokens until the refresh token expires, and an unexpired access
token keeps resolving because the resolver does not read `banned` [S24].
`revokeCredentials` writes `credentials_revoked_at`, deletes sessions created before it,
and revokes refresh *and* access tokens minted before it, in one transaction; the
resolver refuses any credential whose `iat` predates the instant [S25, S26]. On this
platform the ban is the strictly weaker mechanism and a second one beside the existing
act. Adopting it without wiring `banUser → revokeCredentials` (or teaching the resolver
`banned`) leaves a gap; wiring it makes the admin endpoint a thin alias.

**`removeUser` versus erasure.** `removeUser` calls `deleteUserSessions` then
`internalAdapter.deleteUser`, which deletes `session`, `account` and the `user` row
[S14, S27]. In this schema `member.user_id`, `invitation.inviter_id`,
`oauth_client.user_id`, `oauth_refresh_token.user_id` and `oauth_access_token.user_id`
are all `ON DELETE CASCADE` to `user.id` [S4], so the hard delete also deletes every
member row. ADR 0020 amends ADR 0014 so that "the member row [is] pseudonymised on a
valid erasure request (was 'retired, never deleted')", and the routine rewrites
`human:<email>` to `human:<member-id>` — the per-member ULID on that row [S28, S29].
Deleting the member row destroys the anchor the pseudonym points at, so
`/admin/remove-user` contradicts ADR 0020 as written.

**Switching endpoints off.** `disabledPaths` is checked in the router's `onRequest`
after base and plugin endpoints are merged, and returns `404` for a matching normalised
path [S30]. It applies to plugin endpoints — this repo already uses it to close the JWT
plugin's `/token` [S23]. So `disabledPaths: ["/token", "/admin/remove-user",
"/admin/impersonate-user", "/admin/set-user-password", "/admin/create-user"]` is
supported and keeps the rest. (`basePath` is `/` here, so the paths are as listed
[S23].) The endpoints still exist on `auth.api.*` server-side; `disabledPaths` closes the
HTTP face only [S30].

---

## 4. `/admin/list-users` across workspaces

`listUsers` checks `user: ["list"]` and calls `internalAdapter.listUsers(limit, offset,
sort, filter)` with no tenant or organization predicate; it returns whole `user` rows
(`email`, `name`, `banned`, `credentialsRevokedAt` included) and a `total` [S14, S11].
`limit` defaults to 100 [S11].

ADR 0009's 2026-09-01 amendment justifies the identity set's RLS exemption precisely:
"the exemption is for *unscoped, key-based reads before authentication* — a session by
its token, a user by id or email … — **none of which lists across principals**" [S31].
A platform-wide user list is the one read that argument excludes. Adopting
`/admin/list-users` is therefore a new exposure and an ADR 0009 amendment, not a
consequence of the existing decision. It is defensible only for a platform operator;
a workspace Admin holding it would see every other company's people.

Who may call it: any session whose `user.role` (comma-split) authorizes `user: ["list"]`
under the configured roles, or any `user.id` in `adminUserIds`, which short-circuits to
`true` before any role is read [S12].

---

## 5. `adminUserIds` and the platform principal

`adminUserIds` is `string[]` of user ids; `hasPermission` compares it with
`session.user.id`, and every admin endpoint requires a session [S11, S12, S14]. The
platform principal is `{ kind: "platform", actorId: "process:better-answers-…" }` — no
user row, no session [S32]. It cannot appear in `adminUserIds`. The operator would need
a real `user` row (an email-OTP sign-in) and would act as a *person*, audited under a
person's id, which is the opposite of `[SEC2]`'s rule that platform acts are "audited
under that identity, never a person's" [S8, S32]. The repo's audit hook also only knows
five paths; `/admin/*` would need adding [S23].

---

## 6. What the organization plugin already gives, versus what only `admin()` adds

| Act | organization plugin today | only with `admin()` |
| --- | --- | --- |
| Add / update role / remove a member, within one workspace | Admin, through `ac` (`member: create/update/delete`) [S9] | — |
| Invite / cancel invitation | granted to Admin, but fenced off until T-022's accept page [S23] | — |
| Pick active workspace | `/organization/set-active` [S23] | — |
| List every user on the platform | — | `/admin/list-users` [S11] |
| Ban / unban | — | `/admin/ban-user`, `/admin/unban-user` [S11] |
| Impersonate | — | `/admin/impersonate-user`; mints a session with `impersonatedBy`, one hour by default [S11, S14] |
| List / revoke another user's sessions | — (`revokeCredentials` ends them all) [S25] | `/admin/list-user-sessions`, `/admin/revoke-user-session(s)` [S11] |
| Hard-delete a user | — | `/admin/remove-user` [S11, S27] |
| Create a user, optionally with a password | — (email OTP creates on first sign-in) | `/admin/create-user` [S11] |
| Set a platform role | — | `/admin/set-role` [S11] |

Impersonation deserves one more line. The impersonation session is an ordinary session
row for the *target* user [S14]; `verify.ts` reads `user.id` and `activeOrganizationId`
and never `impersonatedBy` [S33], and this repo's session hook would set the target's
sole workspace on it [S23]. The operator would resolve to a `UserPrincipal` in the
person's workspace under the person's id, and every audit line would name the person.

---

## 7. The password dependency

`createUser`'s body has `password: z.string().optional()`; when present the plugin
hashes it and links an `account` with `providerId: "credential"`; when absent no
credential account is created. Neither `createUser` nor `setUserPassword` checks
`emailAndPassword.enabled` [S14]. (The docs mark `password` as required [S11]; the
v1.7.2 source is optional.) So the plugin loads and runs with email-OTP-only sign-in.
What it produces is inert: with no `emailAndPassword` configured there is no endpoint
that consumes a credential account [S23], so `/admin/set-user-password` and a
password-bearing `createUser` write a hashed secret nothing reads. A user created
without a password can sign in by email OTP as anyone else does.

---

## 8. Recommendation

**Do not adopt in T-022. Do not adopt "out of the box" at all.** If a platform-operator
console is wanted later, it is a separate task with an ADR, and only a subset survives.

The facts that decide it, none of them glossary wording:

1. `/admin/list-users` is the cross-principal list ADR 0009's isolation-by-key argument
   explicitly excludes; adopting it is an ADR amendment, not a plugin flag (§4).
2. `/admin/remove-user` hard-deletes and cascades through `member`, destroying the
   member id ADR 0020's erasure routine pseudonymises to (§3).
3. `banUser` is weaker than `revokeCredentials` — it leaves OAuth refresh and access
   tokens live and is invisible to `withPrincipal` — so it is a second, leakier
   revocation beside the existing one (§3).
4. Impersonation mints a session the resolver and the audit log read as the person's
   (§6).
5. It costs a `0007` migration and its `[SEC3]` adversarial pass for five columns no
   screen in T-022 reads (§1), and T-022's acceptance criteria name sign-in, the shell
   and the routes screen, nothing operator-facing [S34].

What T-022 needs from identity it already has: the organization plugin's membership
and role model, `revokeCredentials`, and `provisionWorkspace` [S9, S25, S35].

**If adopted later as a separate task**, the minimum honest shape is:

- Files: `packages/schema/src/identity-tables.ts` (five columns);
  `packages/schema/migrations/0007_admin-plugin-fields.sql`; `apps/api/src/auth/roles.ts`
  (a second `createAccessControl(defaultStatements)` with operator role names, kept apart
  from the three workspace roles); `apps/api/src/auth/auth.ts` (`admin({ ac, roles,
  adminRoles, defaultRole })`, `disabledPaths` extended with `/admin/remove-user`,
  `/admin/impersonate-user`, `/admin/set-user-password`, `/admin/create-user`,
  `AUDITED_PATHS` extended with the kept `/admin/*` paths);
  `packages/core/src/store/postgres` resolver reading `banned`, or a hook that routes
  `banUser` through `revokeCredentials`; `apps/web` gains `better-auth` and
  `@better-auth-ui/*` (today it has neither [S36]).
- ADR lines: an ADR 0009 amendment naming the platform-wide user list as an operator-only
  read and its access rule; a `CONTEXT.md` entry for *operator* (a person acting for the
  platform through a real user row) before the word enters code (`[GLOSSARY1]` [S8]).
- Tests: the `[SEC3]` refusal tests for `0007`; a test that a workspace Admin's session
  gets `403` from `/admin/list-users`; a test that each disabled path answers `404`; a
  test that a banned person's live connector is refused (which is the test that will
  show the ban needs `revokeCredentials` behind it).

---

## Sources

- [S1] `apps/api/package.json` — `"better-auth": "1.7.2"` and the four `@better-auth/*` packages at 1.7.2.
- [S2] better-auth.com `/llms.txt` — "v1.7 (Latest): Documentation for the 1.7.x release line" (read 02/09/2026).
- [S3] github.com/better-auth/better-auth, tag `v1.7.2`, `packages/better-auth/src/plugins/admin/schema.ts`.
- [S4] `packages/schema/src/identity-tables.ts` — header comment (hand-carried from `auth@1.7.2 generate`), `user`, `session`, `member`, `invitation`, `oauth_*` definitions and cascades.
- [S5] `packages/schema/migrations/0004_identity-set.sql`, `0005_identity-set-substrate.sql`, `0006_identity-role-checks.sql`.
- [S6] `packages/schema/test/rls.test.ts` — "the identity set" describe block over `IDENTITY_SET`.
- [S7] tag `v1.7.2`, `packages/better-auth/src/plugins/admin/admin.ts` — `databaseHooks.user.create.before`, `databaseHooks.session.create.before` (ban check), `adminRoles` validation, `mergeSchema(schema, opts.schema)`.
- [S8] `CODING_RULES.md` — `[SEC2]`, `[SEC3]` (adversarial pass sentence), `[GLOSSARY1]`.
- [S9] `apps/api/src/auth/roles.ts`; `packages/schema/src/roles.ts` (`ROLES`, `CREATOR_ROLE`).
- [S10] better-auth.com `/docs/plugins/admin` — Access Control: Roles (comma-separated), Permissions, Custom Permissions (`defaultStatements`, `adminAc`), "Pass Roles to the Plugin".
- [S11] better-auth.com `/docs/plugins/admin` — Usage, endpoint list and type definitions, Options (`defaultRole`, `adminRoles`, `adminUserIds`, `impersonationSessionDuration`).
- [S12] tag `v1.7.2`, `packages/better-auth/src/plugins/admin/has-permission.ts`.
- [S13] tag `v1.7.2`, `packages/better-auth/src/plugins/access/access.ts` — `authorize`, `unknownResourceResponse`, `connector`.
- [S14] tag `v1.7.2`, `packages/better-auth/src/plugins/admin/routes.ts` — `createUser`, `setUserPassword`, `removeUser`, `listUsers`, `impersonateUser`, `banUser`.
- [S15] `apps/api/src/auth/auth.ts` — `organization({ ac: accessControl, roles, creatorRole, ... })`: the organization plugin takes its own `ac` and `roles`, separate options from `admin()`'s [S11].
- [S16] tag `v1.7.2`, `packages/better-auth/src/plugins/admin/client.ts`.
- [S17] github.com/daveyplate/better-auth-ui, `packages/core/src/plugins/admin/admin-queries.ts` — `adminPermissionOptions` calling `authClient.admin.hasPermission`.
- [S18] daveyplate/better-auth-ui, `apps/docs/src/components/auth/admin/admin-users.tsx` — `useAdminPermission(..., { user: ["list"] })`, "Access Denied", create form `type="password" required`.
- [S19] better-auth-ui.com `/docs/shadcn/plugins/admin`.
- [S20] daveyplate/better-auth-ui, `packages/core/src/plugins/admin/admin-plugin.ts` — `AdminPluginOptions` defaults.
- [S21] tag `v1.7.2`, `packages/better-auth/src/context/helpers.ts` — `runPluginInit`: `dbHooks.push({ source: "plugin:<id>" ... })` in the plugin loop, `{ source: "user", hooks: options.databaseHooks }` pushed after it; `defu(options, restOpts)`.
- [S22] tag `v1.7.2`, `packages/better-auth/src/db/with-hooks.ts` — `createWithHooks` sequential `before` hooks, accumulated `actualData`, `false` short-circuit.
- [S23] `apps/api/src/auth/auth.ts` — `basePath: "/"`, `disabledPaths: ["/token"]`, `user.additionalFields.credentialsRevokedAt`, `databaseHooks.session.create.before`, `AUDITED_PATHS`, organization hooks, `emailOTP` only, no `emailAndPassword`.
- [S24] `packages/core/src/kernel/principal.ts` — `PrincipalRefusal`, `Claims`.
- [S25] `packages/core/src/workspaces/index.ts` — `revokeCredentials`.
- [S26] `docs/adr/0009-*.md`, 2026-09-01 amendment, second paragraph — resolver's `iat` before `credentials_revoked_at` refusal; `revokeCredentials` as the one act.
- [S27] tag `v1.7.2`, `packages/better-auth/src/db/internal-adapter.ts` — `deleteUser`: session, account, user.
- [S28] `docs/adr/0020-*.md` — Consequences: "**Amends ADR 0014**: … the member row pseudonymised on a valid erasure request (was 'retired, never deleted')"; the routine's `human:<email>` → `human:<member-id>` rewrite.
- [S29] `CONTEXT.md` — *member id*, *erasure request*.
- [S30] tag `v1.7.2`, `packages/better-auth/src/api/index.ts` — router `onRequest`: `disabledPaths.includes(normalizedPath)` → `404`, after `getEndpoints()` merges base and plugin endpoints.
- [S31] `docs/adr/0009-*.md`, 2026-09-01 amendment, first paragraph — "none of which lists across principals".
- [S32] `packages/core/src/kernel/principal.ts` — `PlatformPrincipal`; `apps/api/src/auth/auth.ts` — `PLATFORM_PRINCIPAL`.
- [S33] `apps/api/src/auth/verify.ts` — `sessionShape`, `sessionClaims`.
- [S34] ordna task `T-022` — Goal and Acceptance Criteria.
- [S35] `apps/api/tests/harness.ts` — `provision`, `person`, `addMember`, `revokeCredentials`, `removeMember` ("as the People screen will one day").
- [S36] `apps/web/package.json` — dependencies: react, react-dom only.
