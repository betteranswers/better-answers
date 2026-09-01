---
date: 2026-09-01
task: T-004
status: research
---

# Better Auth's tables under workspace isolation, and whether agent-auth belongs in T-004

Read on 1 September 2026. Every in-repo claim cites a file and line. Every Better Auth claim
cites either the documentation page (better-auth.com, the `v1.7 (Latest)` line per
https://better-auth.com/llms.txt) or the source at the `v1.7.2` tag
(https://github.com/better-auth/better-auth/blob/v1.7.2/ — paths below are relative to it), both
fetched today. Nothing here is recalled (`[DEPS1]`).

## The version read (`[DEPS1]`)

| Package | Current stable | Published | Source |
| --- | --- | --- | --- |
| `better-auth` | **1.7.2** | 2026-08-26T19:03:29Z (GitHub), 19:06:23Z (npm) | https://github.com/better-auth/better-auth/releases/tag/v1.7.2, https://registry.npmjs.org/better-auth |
| `@better-auth/oauth-provider` | 1.7.2 | 2026-08-26T19:03:23Z | https://registry.npmjs.org/@better-auth%2Foauth-provider |
| `@better-auth/cimd` | 1.7.2 | 2026-08-26T19:03:15Z | https://registry.npmjs.org/@better-auth%2Fcimd |
| `@better-auth/mcp` | 1.7.2 | 2026-08-26T19:03:22Z | https://registry.npmjs.org/@better-auth%2Fmcp |

Prototype 61 pinned exactly these four at 1.7.2
(`.scratch/v01-spec/prototypes/61-claude-connector/package.json:10-19`), so **there is no
version delta between what the prototype proved and what T-004 would install**. A `v1.7.3`
release PR (#11032, opened 2026-08-27 by the release bot) is open and still draft as of today
(https://github.com/better-auth/better-auth/pulls/11032); the tag list ends at `v1.7.2`. The
documentation MCP server's version index lists two lines only, `v1.7 (Latest)` and `v1.6`, so
"latest" and "1.7.x" are the same documentation (https://better-auth.com/llms.txt).

## The question

ADR 0009 says "Auth tables are ordinary tables in the app's schema; workspace isolation applies
to them like every other table" (`docs/adr/0009-better-auth-in-process-identity-provider.md:23`
— the ticket cites line 15; with the frontmatter counted it is line 23). `CONTEXT.md` says
"**Every row, every object-store prefix, every graph node and edge carries its workspace id**"
(`CONTEXT.md:425-426`). ADR 0032 makes that concrete: one runtime role, every tenant-table
policy calling `current_workspace_id()`, "A missing scope is an empty GUC is zero rows"
(`docs/adr/0032-…:27`; `packages/schema/src/with-rls.ts:20-21`). And T-003 built the
tenancy root itself that way — `workspace` is created through `withRLS("workspace", …, "id")`,
its tenant column being its own id (`packages/schema/src/schema.ts:13-22`).

But ADR 0009's own amendment fixes the login shape: "a multi-organisation user picks before
consent (`postLogin.page` + `shouldRedirect`)" (`docs/adr/0009-…:30`; ADR 0018:24). The picker
must list a person's organisations **before any workspace is chosen**, so under a
`current_workspace_id()` policy it lists nothing. Prototype 61 saw the same shape: its
`shouldRedirect` ran `select organizationId from member where userId = ?` with no scope
(`.scratch/v01-spec/prototypes/61-claude-connector/src/auth.ts:73-81`). Of the fifteen tables
the prototype's Better Auth created, only `organization`, `member` and `invitation` carry an
organisation id at all (`prototype.sqlite` schema, read today); the rest reach a workspace
only through `userId`/`sessionId`, or not at all (`jwks`, `oauthResource`,
`oauthClientAssertion`).

Two things were asked: what Better Auth actually permits and does here, and whether the
`agent-auth-mcp` skill installed in this repo has any bearing on T-004.

---

## Findings — Better Auth

### a. Does Better Auth document any multi-tenant isolation of its own tables?

**ABSENT.** Nothing in the 1.7 documentation describes RLS, a restricted Postgres role, or
schema-per-tenant for Better Auth's tables.

- A documentation search for *row level security multi-tenant tenant isolation postgres*
  returned one page, the Supabase migration guide, and only to say the guide "doesn't currently
  cover migrating two-factor (2FA) or Row Level Security (RLS) configurations"
  (https://better-auth.com/docs/guides/supabase-migration-guide, via the docs MCP server).
- The Security reference (https://better-auth.com/docs/reference/security) has sections on
  password hashing, secret rotation, sessions, CSRF, OAuth state, cookies, rate limiting, IP
  headers, trusted proxy headers, trusted origins, outbound OAuth requests and email
  enumeration. No section on tenant isolation of stored rows.
- The PostgreSQL adapter's "Use a non-default schema" puts **all** Better Auth tables in one
  named schema via `search_path` (e.g. `auth`), and the CLI "inspects only the tables in your
  configured schema" (https://better-auth.com/docs/adapters/postgresql#use-a-non-default-schema).
  The Drizzle adapter's `schemaName: "auth"` generates the same, as `pgSchema("auth")`
  (https://better-auth.com/docs/adapters/drizzle#custom-schema-namespace). Both are *one
  namespace for the identity set*, not one per tenant.
- The organization plugin's own framing is application-level: "Active organization is the
  workspace the user is currently working on. By default when the user is signed in the active
  organization is set to `null`" (https://better-auth.com/docs/plugins/organization#active-organization).
  Isolation is whatever the application does with `activeOrganizationId`.

So the isolation of the identity set is ours to define, and the library gives no hook that
would set a Postgres GUC before its own queries.

### b. Can `organization` be mapped onto `workspace`, and `member` onto our table?

**Yes, both, through the plugin's `schema` option**, with a fixed column contract.

**The mechanism.** `organization({ schema: { organization: { modelName, fields,
additionalFields }, member: { … }, invitation: { … }, session: { fields: { activeOrganizationId }
} } })` — documented under "Customizing the Schema"
(https://better-auth.com/docs/plugins/organization#customizing-the-schema; the same snippet
is what Context7 returns for `/better-auth/better-auth`), and implemented at
`packages/better-auth/src/plugins/organization/organization.ts:1086-1120` (organization) and
`:1126-1163` (member), where every field carries `fieldName: opts.schema?.<table>?.fields?.<f>`
and the table carries `modelName: opts.schema?.<table>?.modelName`.

**The organization contract, as the runtime schema declares it** (`organization.ts:1088-1120`):

| Field | Type | Constraint |
| --- | --- | --- |
| `id` | string | primary key; minted by `generateId` unless overridden (`schema.ts:309`) |
| `name` | string | required, sortable |
| `slug` | string | **required, `unique: true`, `index: true`**, sortable |
| `logo` | string | optional |
| `createdAt` | date | required |
| `metadata` | **string** | optional — JSON text; the zod side parses `z.record(...)` **or** a JSON string (`schema.ts:313-316`) |

Note `updatedAt` appears in the TypeScript default-fields type (`schema.ts:134-137`) but **not**
in the runtime schema, which is why prototype 61's generated `organization` table has none.
`slug` is not decorative: `createOrganization` and `updateOrganization` both check
`findOrganizationBySlug` and there is a `checkSlug` endpoint
(`routes/crud-org.ts:149`, `:469`; https://better-auth.com/docs/plugins/organization#check-if-organization-slug-is-taken).
A mapped `workspace` table must therefore carry a unique slug even if no screen shows it.

**The member contract** (`organization.ts:1126-1163`): `organizationId` (string, required,
`references: { model: "organization", field: "id" }`, indexed), `userId` (string, required,
references `user.id`, indexed), `role` (string, required, default `"member"`, sortable),
`createdAt` (date, required); default roles are `admin | member | owner` (`schema.ts:376`).
Our Admin/Editor/Viewer names would go through the plugin's `roles`/access-control option
(https://better-auth.com/docs/plugins/organization#access-control) — out of this note's scope.

**Id type.** Better Auth's default id is a random base62 string; `advanced.database.generateId`
accepts a function receiving `{ model }` and may return a different id per model, or `false`
to let the database default fill it
(https://better-auth.com/docs/concepts/database#id-generation;
https://better-auth.com/docs/reference/options#advanced-database). A ULID for `organization`
(our `workspace.id`, `boundary-schemas.ts:29`) and for `member` (the glossary's *member id*
ULID, `CONTEXT.md:339`) is therefore configurable, not fought.

**Foreign keys survive renaming.** `references.model` is a *schema key*, not a physical name:
the core comment explains that resolvers "treat `references.model` as a schema key and look it
up via `tables[references.model]` / `getDefaultModelName`"
(`packages/core/src/db/get-tables.ts:172-182`, written about `user`; the plugin schema goes
through the same resolvers — **verify in the implementing PR** that `member.organizationId`
resolves to the renamed table under the Drizzle adapter).

**The Drizzle adapter's side.** "The Drizzle adapter expects the schema you define to match the
table names" — either pass `schema: { ...schema, organization: schema.workspace }` to
`drizzleAdapter`, or set `modelName` in the auth config
(https://better-auth.com/docs/adapters/drizzle#modifying-table-names). Field renames follow the
Drizzle property-to-column mapping automatically
(https://better-auth.com/docs/adapters/drizzle#modifying-field-names).

**What T-003's `workspace` has today:** `id text PK`, `name text NOT NULL`,
`created_at timestamptz NOT NULL DEFAULT now()` (`packages/schema/src/schema.ts:13-22`;
`packages/schema/migrations/0001_first-tables.sql:12`). Mapping adds `slug`, `logo` and
`metadata`; and — the load-bearing part — the table is currently **RLS'd on its own id**, which
is incompatible with Better Auth reading it before a scope exists (finding d).

### c. Which tables accept `additionalFields`, and do `databaseHooks` reach the OAuth tables?

Read from the types and the table builder, not only the prose, because the prose is narrower
than the types.

| Table | `modelName` / `fields` rename | `additionalFields` | Source |
| --- | --- | --- | --- |
| `user`, `session` | yes | **yes** | https://better-auth.com/docs/concepts/database#extending-core-schema; `get-tables.ts:243`, `:191` |
| `account`, `verification` | yes | **yes at the type and builder level** (`BetterAuthDBOptions` carries `additionalFields` for every core model, `core/src/types/init-options.ts:230-247`; spread at `get-tables.ts:351`, `:124`) — the Options reference documents only `modelName`/`fields` for these two, so treat as *present but undocumented* | https://better-auth.com/docs/reference/options#account |
| `rateLimit` | `modelName` + renames of `key`/`count`/`lastRequest` | **no** — `Omit<…, "additionalFields">` (`init-options.ts:249-253`; `get-tables.ts:59-85`) | https://better-auth.com/docs/concepts/rate-limit#storage |
| `organization`, `member`, `invitation`, `team`, `teamMember`, `organizationRole` | yes | **yes** (`organization.ts:1120`, `:1162`, `:1228`, `:998`, `:1079`; docs: "custom fields to the `organization`, `invitation`, `member`, and `team` tables") | https://better-auth.com/docs/plugins/organization#additional-fields-1 |
| `session.activeOrganizationId` | rename only (`organization.ts:1254-1262`, `input: false`) | — | — |
| `jwks` (jwt plugin) | yes | **no** — `mergeSchema(schema, options?.schema)` (`plugins/jwt/index.ts:385`) | `plugins/jwt/schema.ts:3-40` |
| `oauthClient`, `oauthResource`, `oauthClientResource`, `oauthRefreshToken`, `oauthAccessToken`, `oauthConsent`, `oauthClientAssertion` | yes — `schema?: InferOptionSchema<typeof schema>` (`packages/oauth-provider/src/types/index.ts:503`) | **no** — `InferOptionSchema` admits only `modelName` and `fields` renames (`packages/better-auth/src/types/plugins.ts:14-26`), and `mergeSchema` copies only `modelName` and `fieldName` (`packages/better-auth/src/db/schema.ts:280-314`) | `packages/oauth-provider/src/oauth.ts:1715` |

So **the seven OAuth tables and `jwks` and `rateLimit` cannot carry a `workspace_id` column
through Better Auth's configuration at all.** What the OAuth tables *do* carry is Better Auth's
own nullable `referenceId` on `oauthClient` (`schema.ts:154`), `oauthRefreshToken` (`:343`),
`oauthAccessToken` (`:449`) and `oauthConsent` (`:519`), filled from `postLogin.consentReferenceId`
(tokens, consent) and `clientReference` (clients) — plus a `metadata` json column on
`oauthClient`, `oauthResource` and `oauthClientResource`. `oauthResource`, `oauthClientResource`
and `oauthClientAssertion` have no user, session or reference link of any kind.

**`databaseHooks` cover exactly four models — `user`, `session`, `account`, `verification`**
(`init-options.ts:1394-1620`; the concepts page says "user, session, and account", the Options
reference adds `verification`: https://better-auth.com/docs/concepts/database#database-hooks,
https://better-auth.com/docs/reference/options#databasehooks). **They do not reach any plugin
table** — not `organization`/`member` and not the OAuth set. The plugin-level equivalents are:
`organizationHooks` (before/after create for organization, member, invitation, team —
https://better-auth.com/docs/plugins/organization#organization-hooks); for the OAuth provider
there is no per-row hook, only `clientReference` (`types/index.ts:847-850`),
`postLogin.consentReferenceId` (`:989-993`), `customAccessTokenClaims` (`:1147-1158`), CIMD's
`onClientCreated`/`onClientRefreshed` (https://better-auth.com/docs/plugins/cimd#configuration),
and the generic endpoint `hooks.before/after` (https://better-auth.com/docs/concepts/hooks).
The one documented use of `databaseHooks` for tenancy is setting `activeOrganizationId` at
session creation (https://better-auth.com/docs/plugins/organization#set-active-organization) —
and the plugin itself never sets it (no `databaseHooks` anywhere in `organization.ts`).

### d. The organisation picker before consent, and every table read with no tenant scope

The flow, from `packages/oauth-provider/src/authorize.ts` at v1.7.2, with the query each step
issues. Everything before step 6 runs with **no workspace known**.

1. **Client lookup.** `getClient(ctx, opts, query.client_id)` (`authorize.ts:484`) →
   `adapter.findOne({ model: oauthClient, where: clientId })`; if the row has
   `clientDiscoveryId` the CIMD discovery re-resolves (and may refresh) it; if no row, the
   discovery fetches the metadata document and **creates** the client
   (`utils/index.ts:248-290`; https://better-auth.com/docs/plugins/cimd#persistence-and-refresh).
   Resource policy reads `oauthResource`/`oauthClientResource` (`authorize.ts:676-678`).
   *Tables: `oauthClient`, `oauthClientResource`, `oauthResource`. Key: `clientId`.*
2. **Session.** `getSessionFromCtx(ctx)` (`authorize.ts:682`) → `session` by cookie token
   **joined to `user`** (`packages/better-auth/src/db/internal-adapter.ts:603-670`). No
   session → redirect to `loginPage`; login itself reads `account` (password) or `verification`
   (email OTP) and writes `session`. *Tables: `session`, `user`, `account`, `verification`.
   Key: token / email.*
3. **`selectAccount` / `signup` gates** if configured (`authorize.ts:725-777`) — not ours.
4. **The post-login gate.** `if (!settings?.postLogin && opts.postLogin)` →
   `opts.postLogin.shouldRedirect({ headers, user, session, scopes })` (`authorize.ts:778-798`;
   type at `types/index.ts:1006-1012`: "`true`: account is not selected and needs selection").
   The documented body calls `auth.api.listOrganizations({ headers })`
   (https://better-auth.com/docs/plugins/oauth-provider#post-login-screen), which is
   `adapter.findMany({ model: "member", where: userId, join: { organization: true } })`
   (`plugins/organization/adapter.ts:743-776`; endpoint `routes/crud-org.ts:964-999`). With
   joins off (the default) the adapter issues the `member` read and then the `organization`
   read as separate queries (https://better-auth.com/docs/concepts/database#joins).
   *Tables: `member` by `userId`, then `organization` by ids.* **This is the read that returns
   zero rows under a `current_workspace_id()` policy**, and it is also the read that decides
   whether a picker is needed at all.
5. **The picker.** `redirectWithPromptCode(ctx, opts, "post_login")` sends the browser to
   `postLogin.page?<signed query>` (`authorize.ts:961-991`; the query is signed with `exp`,
   `iat`, the covered-parameter list and `sig`, `:993-1024`). Our page lists the same
   memberships (same reads as step 4). The person picks →
   `authClient.organization.setActive({ organizationId })` → `checkMembership` (`member` by
   `userId`+`organizationId`, `adapter.ts:629-651`), `findOrganizationById` (`organization`),
   then `internalAdapter.updateSession(token, { activeOrganizationId })` (`adapter.ts:598-610`)
   and a refreshed session cookie (`crud-org.ts:840-960`). Then
   `oauth2Continue({ postLogin: true })` re-enters authorize; the client's `postLogin: true`
   only *selects* the continuation — authorize re-runs `shouldRedirect` against the live
   session unless the signed query carries the `postLoginClearedForSession` marker, which is
   minted only at the consent redirect (`continue.ts:72-100`; `authorize.ts:971-978`). *Tables:
   `member`, `organization`, `session` (UPDATE). Key: `userId`, `organizationId`, session token.*
6. **The reference id.** `opts.postLogin.consentReferenceId({ user, session, scopes })`
   (`authorize.ts:806-810`) — ours returns `session.activeOrganizationId`
   (prototype `src/auth.ts:67-71`). The type's note: "YOU must fail in this function if the
   requested scope doesn't have a reference id and it should" (`types/index.ts:985-993`). **From
   here the workspace is known.**
7. **Consent lookup.** Unless `client.skipConsent`, `findOne({ model: "oauthConsent", where:
   clientId, userId, [referenceId] })` (`authorize.ts:824-843`) — consent is stored **per
   (client, user, workspace)**; missing or narrower than the request → redirect to
   `consentPage` with the session-bound marker. The consent POST re-reads the session, re-runs
   `consentReferenceId`, and creates or updates the `oauthConsent` row with `referenceId`
   (`consent.ts:92-164`). *Tables: `oauthConsent`, `session`, `user`.*
8. **The code.** `redirectWithAuthorizationCode` writes the authorization code into the
   **`verification` table**: `identifier` = the (hashed) code, `value` = JSON
   `{ type, query, userId, sessionId, referenceId, authTime, resource }`
   (`authorize.ts:915-957`). *The workspace id lives inside `verification.value` as JSON, with
   no column.*
9. **Token exchange** (`token.ts`): the code is read from `verification`; `getClient` again;
   the session is re-checked by id — "session no longer exists" if gone (`token.ts:1649-1661`);
   `oauthRefreshToken` and `oauthAccessToken` rows are created **with `referenceId`**
   (`:497-503`, `:1678`); `customAccessTokenClaims({ user, referenceId, scopes, resources,
   metadata })` mints our `{ workspace, user }` (prototype `src/auth.ts:85-90`; the callback's
   contract at `types/index.ts:1147-1158`). Refresh reads `oauthRefreshToken` **by token**
   (`token.ts:1828`) and carries `referenceId` forward (`:1951`). *Tables: `verification`,
   `oauthClient`, `session`, `user`, `oauthRefreshToken`, `oauthAccessToken`, `jwks` (signing).
   Key: code, token, session id.*
10. **Every request**, before any of the above: the rate limiter reads/writes `rateLimit` by
    `ip|path` (finding e).

**What this establishes.** Every read Better Auth makes on its own tables is an exact-match
lookup on a **secret** (session token, code, refresh token, client assertion id) or a
**principal id** (`userId`, `clientId`, `organizationId`), and the workspace id is the
*output* of steps 4–6, not an input to any of them. A policy that demands the workspace id
before the read is circular for this set. The one table in the set that carries a workspace
id as a real column and is read only after step 6 is `oauthConsent` — and even that is keyed
on `clientId` + `userId` first. The single-organisation shortcut ADR 0009:30 names
("`activeOrganizationId` at session creation") is the documented `databaseHooks.session.create.before`
pattern, which reads `member` for the new session's user — again before any scope.

### e. Database-backed rate limiting, IP headers, proxies, IPv6, Cloudflare

Documentation: https://better-auth.com/docs/concepts/rate-limit;
https://better-auth.com/docs/reference/options#advanced;
https://better-auth.com/docs/reference/security#ip-address-headers. Source:
`packages/better-auth/src/api/rate-limiter/index.ts`, `packages/core/src/utils/ip.ts`.

- **Scope of the limiter.** It runs on Better Auth's own handler only: "Server-side requests
  made using `auth.api` aren't affected by rate limiting. Rate limits only apply to
  client-initiated requests." Defaults in production: 60 s window, 100 requests; disabled in
  development unless `rateLimit.enabled: true`. The MCP endpoint itself is outside this
  handler, so ADR 0018's "Postgres counter per (token, window)" (`docs/adr/0018-…:25`) is a
  platform table, not this one.
- **Database storage.** `rateLimit: { storage: "database", modelName: "rateLimit" }`; "Make
  sure to run `migrate` to create the rate limit table". Columns: `key`, `count`,
  `lastRequest` (`core/src/db/schema/rate-limit.ts:8-21`; renames via `rateLimit.fields`,
  `get-tables.ts:59-85`). The database wrapper reads the row by key, **creates on miss** (a
  lost create race re-reads rather than resetting a concurrent opener's count), increments
  through `adapter.incrementOne` guarded on both window and max so "a burst of concurrent
  requests can never exceed the limit", and sweeps expired rows best-effort with
  `deleteMany` after a window reset (`rate-limiter/index.ts:115-245`). Adapters must
  implement `incrementOne`/`consumeOne` since 1.7
  (https://better-auth.com/docs/guides/1-7-upgrade-guide#database-adapters-must-implement-incrementone-and-consumeone).
- **`customStorage.consume(key, rule)`** "must check and increment in one operation. Better
  Auth no longer accepts separate `get` and `set` methods" — the 1.7 breaking change
  (https://better-auth.com/docs/guides/1-7-upgrade-guide#rate-limit-storage-uses-consume).
- **The key** is `${ip}|${path}` — "Use | as separator to prevent collision attacks"
  (`ip.ts:391-395`); the OAuth provider's per-endpoint rules are therefore *per-IP
  per-endpoint*: token 20/60 s, authorize 30/60 s, introspect 100/60 s, revoke 30/60 s,
  register 5/60 s, userinfo 60/60 s, overridable via `oauthProvider({ rateLimit: … })`
  (https://better-auth.com/docs/plugins/oauth-provider#rate-limiting).
- **IP resolution** (`ip.ts:350-381`): `advanced.ipAddress.ipAddressHeaders` walked in order,
  default `["x-forwarded-for"]` (`:342`). "By default Better Auth does not trust comma-separated
  forwarded IP chains, since the leftmost `X-Forwarded-For` token is client-controlled behind
  an appending proxy" — a multi-hop chain without `trustedProxies` resolves to **null**
  (`ip.ts:329-332`). With `trustedProxies` (IPs or CIDRs), the chain is walked right to left,
  trusted hops skipped, the first untrusted address taken; malformed entries are dropped and a
  malformed hop fails closed (`ip.ts:289-327`). When no IP resolves, the limiter **warns once
  and falls back to a single shared per-path bucket** keyed `no-trusted-ip` — "Fail closed …
  instead of skipping rate limiting entirely" (`rate-limiter/index.ts:330-359`);
  `disableIpTracking` switches per-IP limiting off. In dev/test an unresolved IP becomes
  `127.0.0.1` (`ip.ts:376-378`).
- **IPv6.** Addresses are normalised (canonical lowercase; IPv4-mapped `::ffff:…` → IPv4) and
  keyed **per `/64` by default** (`ipv6Subnet ?? 64`, `ip.ts:196`), any prefix 0–128 accepted,
  because "any per-address counter would let one client rotate through 2^64 source addresses";
  "IPv4 addresses are always rate limited individually" (rate-limit doc, IPv6 sections).
- **Cloudflare.** The docs' own example is `ipAddressHeaders: ["cf-connecting-ip"], //
  Cloudflare specific header example`, with the rule "Point `ipAddressHeaders` at a single
  trusted header your proxy sets", and the warning that `trustedProxies` "cannot verify the
  direct sender. Keep your origin reachable only through these proxies, and make each proxy
  overwrite or sanitize the forwarded IP headers. Otherwise a client can set `X-Forwarded-For`
  directly and spoof its address" (rate-limit doc); the Security page repeats "ensure … that
  it cannot be set by end users directly". Separately, for *host* resolution the 1.7 guide says
  "Setups where the proxy rewrites the host for you, such as nginx, Vercel, Cloudflare, and
  Netlify, need no change" and `advanced.trustedProxyHeaders` is only for `x-forwarded-host`
  (https://better-auth.com/docs/guides/1-7-upgrade-guide#behind-a-proxy). For us the header
  is trustworthy only if the origin accepts traffic from Cloudflare alone — the deploy-facts
  question, not this one.

### f. Release notes since 1.7.2, and the CIMD breakage ADR 0009 records

**No release exists after 1.7.2**, so nothing has changed the table set, the OAuth provider's
schema or the CIMD package since prototype 61. What is in flight or newly on record:

- **The `@better-auth/cimd/node` bug is filed upstream, and was before ADR 0009's amendment
  said otherwise.** ADR 0009 (amendment of 2026-08-30) says the transport "throws before a
  packet leaves the machine, with **no upstream issue filed by anyone**" (`docs/adr/0009-…:38`).
  In fact: fix PR **#10730** "fix(cimd): answer the socket's all-addresses lookup in the Node
  transport" was opened 2026-08-10 by erikpr1994 against `next`, is still open and
  `mergeable_state: blocked` (last activity 2026-08-28, an independent confirmation on Node
  26.8.1) (https://github.com/better-auth/better-auth/pull/10730); issue **#10810** was opened
  2026-08-14 by fionnmcconville and is open, with confirmations on 1.7.1 and a comment of
  2026-08-30 that it is "Still present in `@better-auth/cimd@1.7.2`"
  (https://github.com/better-auth/better-auth/issues/10810); duplicate **#10899** (2026-08-20)
  was closed the same day. The v1.7.2 source confirms the shape: `lookup(url.hostname, { all:
  true })` then a pinned `callback(null, pinnedAddress.address, pinnedAddress.family)`
  (`packages/cimd/src/node.ts:46-47`, `:80-81`); the `next` branch is unchanged today. So the
  ADR's factual line needs correcting, its `lifts/` snapshot plan (`docs/adr/0009-…:52`) stands,
  and the removal condition can be written as *the release that merges #10730*. Ticket 83's
  "first live test of trigger 3" (`:46`) already has a datum: a known small fix has been open
  three weeks with no maintainer review.
- **1.7.2 itself** carried one CIMD-adjacent fix: "@better-auth/oauth-provider: Fixed Client
  ID Metadata Document registration when clients share grants (#11010)"
  (https://github.com/better-auth/better-auth/releases/tag/v1.7.2). **1.7.1**: "@better-auth/cimd:
  Fixed Client ID Metadata Document caching to follow shared-cache freshness rules" and
  "@better-auth/oauth-provider: Fixed scope error responses so MCP clients now receive a `403`
  with an RFC 6750 `insufficient_scope`" (https://github.com/better-auth/better-auth/releases/tag/v1.7.1).
- **A new Claude-specific report, 2026-08-31:** issue #11081 "oauth-provider: DCR rejects
  Claude when an unsupported grant accompanies supported grants" — Claude's registration body
  includes `urn:ietf:params:oauth:grant-type:jwt-bearer` beside `authorization_code` and
  `refresh_token`, and stock 1.7.2 refuses it
  (https://github.com/better-auth/better-auth/issues/11081). We are CIMD-only (research 80,
  fork F2; ADR 0009:48), so it does not bite, but it is the second piece of evidence that
  Claude's client-side body drifts faster than the provider.
- **For the record, what 1.7.0 changed versus 1.6** (all already in the prototype's 1.7.2
  table set): `oauthApplication` → `oauthClient`; new `oauthRefreshToken`,
  `oauthClientAssertion`, `oauthResource`, `oauthClientResource`; `validAudiences` → resources
  with per-client links; `account` requires `issuer` + a unique `(issuer, accountId)`; SCIM
  decoupled from the organization plugin with "the Group model … replaced"; `team.memberCount`
  and `teamMember.membershipKey`; MCP moved to `@better-auth/mcp`, which "no longer enables
  unauthenticated Dynamic Client Registration"
  (https://better-auth.com/docs/guides/1-7-upgrade-guide#resolve-additional-migration-work,
  https://github.com/better-auth/better-auth/releases/tag/v1.7.0). Two of these matter to
  T-004's migration: `account.identityStrategy` should be set explicitly to `"provider-id"` on
  a new database or 1.7 warns once per instance
  (https://better-auth.com/docs/reference/options#identitystrategy) — consistent with ADR
  0009:38's note that the CLI's generated migration missed `account.issuer`; and the SCIM
  Group replacement is the layer the audience research expects to stand behind platform
  groups later (`docs/research/audience-representation-2026-09-01.md`, finding 3).

---

## Findings — agent-auth

**What is installed.** `/Users/liamj/Documents/development/better-answers/.agents/skills/agent-auth-mcp/SKILL.md`
(file date 29 Aug 21:09), byte-identical to upstream
`skills/agent-auth-mcp/SKILL.md` in https://github.com/better-auth/agent-auth (diffed today),
recorded in `skills-lock.json` as `source: better-auth/agent-auth`. It has no sibling files.

**Who makes it.** The Better Auth team. The repo is `better-auth/agent-auth` (MIT; created
2026-02-20; last push 2026-07-09; latest release **v0.6.2, 2026-06-12**; 61 stars). It
implements the **Agent Auth Protocol** (https://agentauthprotocol.com; spec repo
https://github.com/better-auth/agent-auth-protocol, created 2026-03-07, last push 2026-08-11),
whose README says the spec and implementations "are created and maintained by the Better Auth
team, but they are not tied to Better Auth"; authors Paola Estefanía de Campos and Bereket
Engida; "v1.0 — published", "v2.0 — in active design". The specification page labels itself
`v1.0-draft`. (The implementation README points the "canonical specification" at
`nicepkg/agent-auth-protocol`, a different org from the site's link — **which is canonical is
uncertain**.) Better Auth's own docs page carries the warning: "This plugin is an
implementation of a standard on heavy development. It's not yet stable and may change in the
future" (https://better-auth.com/docs/plugins/agent-auth).

**The three packages** (repo README): `@better-auth/agent-auth` — server plugin (npm 0.6.2,
2026-06-12; peer `better-auth >=1.4.0`); `@auth/agent` — client SDK for agent runtimes;
`@auth/agent-cli` — "CLI and MCP server" with bin `auth-agent` (npm **0.5.1, 2026-05-15**,
while the repo's `packages/cli/package.json` says 0.6.2 — the published CLI lags the tag).

**Which direction it authenticates.** *Agent → provider, outward.* The protocol's roles: an
**Agent** is "A runtime AI actor scoped to a specific conversation, task, or session that
calls external services"; a **Host** is "the persistent identity of the client environment
where agents run"; the **Server** is "The service's authorization server. It manages discovery,
host and agent registrations, approvals, capability grants, and JWT verification"; discovery is
`GET /.well-known/agent-configuration`; each agent holds an Ed25519 keypair and presents
short-lived `agent+jwt` tokens whose `aud` is the service URL; approval is device
authorization (RFC 8628) or CIBA; modes are *delegated* (acts for a user) and *autonomous*
(https://agentauthprotocol.com/specification). The spec "does not reference OAuth 2.0, OAuth
2.1" — it is a standalone protocol; MCP appears only as one client implementation.

The skill is the **client half**: it drives the `auth-agent mcp` server's 17 tools —
`list_providers`, `search_providers`, `discover_provider`, `list_capabilities`,
`describe_capability`, `connect_agent`, `execute_capability`, `agent_status`, `sign_jwt`,
`request_capability`, `disconnect_agent`, `reactivate_agent`, `enroll_host`,
`rotate_agent_key`, `rotate_host_key` — so that an agent in Claude Code or Cursor can find an
*Agent Auth provider*, get a user's approval, and call that provider's "capabilities", with
keys and state in `~/.agent-auth/` (`SKILL.md:37-90`, `:152-156`). The server half,
`@better-auth/agent-auth`, is what a service adds to *become* such a provider, exposing
"capabilities" (its own concept, with an "MCP adapter — expose agent auth as MCP tools").

**Does it have a role in our OAuth 2.1-protected MCP server for Claude, Claude Code and
Cowork?** No. Those clients authenticate to us with the MCP authorization spec — OAuth 2.1,
protected-resource metadata, CIMD (`MCP 2026-07-28`, proved by prototype 61,
`PROTOTYPE.md:112-116`) — which is exactly what `@better-auth/oauth-provider` + `@better-auth/cimd`
implement. Agent Auth Protocol is a different, pre-1.0 protocol with its own discovery
document and its own identity model; I found no evidence that any Anthropic client speaks it
(**uncertain only in the sense that absence was searched, not proved**). Adding
`@better-auth/agent-auth` would be a second authorization surface with a second registration
and a second audit trail — the thing ADR 0018 rules out: the surface "grows by token scope …
never by a second server, a second registration or a second audit stream"
(`docs/adr/0018-…:8`).

**Could it matter later for the worker's outbound connectors (Google Drive, Microsoft 365)?**
Not for those two. Google and Microsoft are OAuth 2.0 identity platforms, not Agent Auth
providers; the protocol only helps where the *other* side implements it. The repo's
`gmail-proxy` and `vercel-proxy` examples are providers *you run yourself* in front of Gmail
(README: "Next.js reference apps … integrate `@better-auth/agent-auth`"), i.e. a proxy, not
Google adopting the protocol. Outbound connector credentials remain the connector's own OAuth
flow, binding-scoped (`CONTEXT.md:155-158`). The one place this protocol's ideas touch our
roadmap is ADR 0009's "later acting-credential class" and ADR 0018's headless agents reading
through the same entries: per-agent identity, per-agent revocation, delegated vs autonomous
modes are that concept. Even then ADR 0018's rule says the answer is an `act:*` scope on the
same server, not this second protocol. Treat it as a watch item on the same stewardship line as
ADR 0009's trigger 2, noting the low activity (no push since 2026-07-09; CLI unpublished since
May).

---

## Open questions

1. **Roles.** Better Auth's `member.role` defaults to `admin | member | owner`; our
   Admin/Editor/Viewer (`CONTEXT.md:451-458`) need the plugin's `roles`/`ac` option, and the
   principal's role is "read per call, in the same transaction as the read it authorises"
   (ADR 0018:44). Whether that read is `member.role` directly or a platform column beside it is
   T-004's design call; nothing here constrains it.
2. **`slug` policy.** A required unique slug on `workspace` needs a minting rule (from `name`?
   from the ULID?) even if no screen shows it; `checkSlug` and the update path will enforce it.
3. **Where the picker's second read lives.** Step 5 lists memberships from our own page; it
   can go through `auth.api.listOrganizations` (Better Auth's reads) or our own store-door
   query. Either way it is a by-`userId` read on `member` with no scope — the recommendation
   below assumes that is accepted as the identity set's nature, not routed around.
4. **Whether the owner wants the tenancy root RLS'd for symmetry** (recommendation 3). If yes,
   the alternative is two rows per tenant — Better Auth's `organization` (global) and our
   `workspace` (RLS'd) — with `workspace.id` a FK to `organization.id` and creation in one
   transaction with `allowUserToCreateOrganization: false`. It works; it costs a duplicated
   `name` and an invariant no constraint enforces.

---

## Recommendation

**1. Global versus tenant-scoped.** Every Better Auth table is global — the *identity set*:
`user`, `session`, `account`, `verification`, `jwks`, `rateLimit`, `organization`, `member`,
`invitation` and the seven `oauth*` tables. None gets `withRLS()`; each is a named exemption
in the coverage test. Everything reached afterwards is tenant-scoped. The argument: *the
identity set is isolated by key, not by scope: every Better Auth read is an exact-match lookup
on a secret or a principal id that never lists across principals and whose result is the
workspace id, so the tenant guarantee begins at the first tenant row and
`SET LOCAL app.workspace_id` is set from that result, never before it.*

**2. Wording.** ADR 0009:23 → "Auth tables are the identity set, not tenant tables: Better
Auth reads them by secret or principal id before any workspace exists and returns the
workspace id, so they carry no `workspace_id` and no RLS policy, are declared by name as the
RLS coverage test's exemption, and the tenant guarantee (ADR 0032) begins at the first tenant
row a resolved principal reaches." `CONTEXT.md:425` → "Every **tenant** row …", adding:
"Better Auth's identity set is not tenant data: read by key before a workspace is known, it is
what a workspace id is resolved from (ADR 0009)."

**3. Mapping.** Map `organization` onto `workspace` (finding b's five columns) and remove
`withRLS` from `workspace`. Deciding fact: the picker must read the workspace's
*name* before any scope exists, so the table holding that name cannot be RLS'd; a second table
duplicates id and name under an invariant no FK enforces.

**4. agent-auth.** Not in T-004: the outbound client of a separate pre-1.0 protocol; Claude's
clients speak OAuth 2.1 + CIMD, and its server plugin would be the second server ADR 0018
forbids. Watch item for the later `act:*` credential.
