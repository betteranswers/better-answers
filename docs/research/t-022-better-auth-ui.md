# T-022 — better-auth-ui against the workspace model, and one session across `app.` and `mcp.`

Research only. Nothing here has been applied to the tree. Written 02/09/2026 against
`better-auth@1.7.2` and `@better-auth/oauth-provider@1.7.2` (the installed versions,
`apps/api/package.json` [S1]) read from `node_modules`, and against
`@better-auth-ui/core@1.7.19` and `@better-auth-ui/react@1.7.19` — the pin read from the
npm registry today (§5) — unpacked outside the repo and never added to the lockfile.
Every finding cites its source; anything the source does not settle is marked
*unverified* and says why.

The two questions the spec left open (`apps/docs-site/specs/T-022.md` § Sign-in, picker
and the refused screen; § Hostnames and origin [S2]): whether the picker is the library's
organisation switcher or a screen on its headless hooks, and how Better Auth behaves when
its base URL is the `mcp.` origin and requests arrive on `app.`

---

## Summary — the two decisions

**The picker is a screen the platform writes, on better-auth-ui's headless hooks.** Not
because the switcher is wrong — it is honest, and it does honour the `workspace` model
name and the field mapping (§1) — but because it cannot be had on its own. It is a
copy-in shadcn component that arrives inside a 53-file registry item implementing create,
delete, leave, invite, teams and roles: acts this platform refuses today [S3, S14]. It is
also a dropdown for a shell, not a post-login page, and it does not resume the OAuth flow.
The hooks are exactly what a picker needs, and the library's own `oauthContinueOptions`
calls the post-login screen "application-owned" and hands over the resume [S6].

**A session made on `app.` does not reach `mcp.` on the defaults, and both redirects go to
the wrong host.** Two configuration lines are load-bearing and neither has a safe default.
The cross-subdomain cookie domain is derived as `new URL(baseURL).hostname` **verbatim** —
`mcp.betteranswers.com`, not the apex — so it must be set explicitly [S7]. And `loginPage`
/ `postLogin.page` are emitted as the relative `Location` they are configured as, which
the browser resolves against `mcp.`, so they must be absolute `app.` URLs [S8, S9]. The
table and the five-line checklist are in §3.

---

## 1. The picker: library switcher, or a screen on the headless hooks

### The package the spec means is not the package the name suggests

`@daveyplate/better-auth-ui` — the npm name in circulation — is at **3.4.0**, last
published **2026-03-23**, five months stale as of today [S10]. It is not what
<https://better-auth-ui.com> documents. The documented Better Auth UI is a **shadcn
registry** (`npx shadcn@latest add @better-auth-ui/auth`) whose items depend on the npm
packages `@better-auth-ui/core` and `@better-auth-ui/react` [S11, S12]. Those are the
1.7.x line the spec's "1.7.18" refers to (§5). Everything below reads 1.7.19; 3.4.0 is set
aside, and its differences are noted only where they would mislead a builder.

The shape is two-part, and the distinction decides this ticket:

- **npm** (`@better-auth-ui/core`, `@better-auth-ui/react`) — headless. TanStack Query
  option factories, the React hooks over them, and `AuthProvider`. No rendered
  organisation UI at all: `@better-auth-ui/react@1.7.19/src/components/` holds `auth`,
  `icons`, `settings` and `mutation-invalidator.tsx`, and there is no switcher or picker
  file in the package [S13].
- **shadcn registry** — the rendered components, *copied into the repo* as source. There
  is no `organization-switcher` item; the switcher ships inside the `organization` item
  [S3].

### The switcher honours the model name and the field mapping

The question is whether anything in the library reads a model or column name rather than
an endpoint. Nothing does — neither the switcher nor the hooks under it.

| Hook / factory | What it calls | Reads a model or field name? |
| --- | --- | --- |
| `listOrganizationsOptions` → `useListOrganizations` | `authClient.organization.list({ … })` | No — an HTTP route [S4] |
| `activeOrganizationQuery` → `useActiveOrganization` | `authClient.organization.getFullOrganization({ … })` | No [S17] |
| `setActiveOrganizationOptions` → `useSetActiveOrganization` | `authClient.organization.setActive({ …, fetchOptions: { throw: true } })` | No — an HTTP route [S5] |
| `oauthContinueOptions` → `useOAuthContinue` | `authClient.oauth2.continue({ postLogin, oauth_query })` | No [S6] |
| `<OrganizationSwitcher />` | the three hooks above; `setActiveOrganization({ organizationId: organization?.id ?? null })` | No — `organizationId` is the API parameter, not a column [S18] |

`schema.organization.modelName: "workspace"` and the `organizationId → workspaceId` field
maps are **adapter-side**: they rename the table and the columns the drizzle adapter reads
and writes [S14, S19]. They do not rename the routes (`/organization/list`,
`/organization/set-active`), the client methods, or the JSON on the wire — the request
body field stays `organizationId` and the session field stays `activeOrganizationId`,
which is exactly why `auth.ts` calls `setActiveOrganization({ body: { organizationId } })`
and reads `activeOrganizationId` off the session object today [S14]. Any library speaking
the client's named methods is mapping-agnostic by construction, and every row above does.

The switcher's shape assumptions are met too: it renders `organization.name`,
`organization.slug` and `organization.logo`, and all three columns exist on
`packages/schema/src/workspace-table.ts` [S20]. Its list query is keyed by
`session.user.id` and skipped until the session loads [S18], which suits a page that runs
straight after sign-in.

### What adopting it would cost

The registry describes the `organization` item as "multi-tenant organization management
with members, invitations, and roles … an organizations settings tab, a full
`<Organization />` shell, and an `<OrganizationSwitcher />` dropdown" [S3]. `shadcn add`
copies **53 files**, among them `create-organization-dialog.tsx`,
`delete-organization-dialog.tsx`, `delete-organization.tsx`,
`leave-organization-dialog.tsx`, `leave-organization.tsx`, `invite-member-dialog.tsx`,
`remove-member-dialog.tsx`, `organization-danger-zone.tsx`, `organization-roles.tsx`,
`organization-teams.tsx`, `team-switcher.tsx` and an `organization-settings.tsx` shell —
plus `@tanstack/react-form`, `@tanstack/react-table`, `@tanstack/react-store`,
`@tanstack/react-pacer`, `date-fns` and about 28 further shadcn items [S3, S18].

Every one of those files is an act this platform refuses today:
`allowUserToCreateOrganization: false`, `beforeCreateInvitation` and
`beforeAcceptInvitation` both throw `NOT_IMPLEMENTED` until T-027, and there is no leave
or delete act at all [S14]. The switcher's own props suppress the *rendering* —
`hideCreate`, `hidePersonal`, `hideSettings`, `hideSlug`, and a `setActive` override
[S18] — but the files are still in the tree, still linted, still reviewed, still implying
a product that does not exist. T-004's judgement call 1, no create-workspace control
anywhere, is a rule about the tree, not only about a rendered screen [S2].

Two smaller traps worth recording, because a builder would otherwise hit them:
`organizationPlugin`'s `allowOrganizationCreation` option gates the **settings tab's**
list, not the switcher — the switcher's `hideCreate` is the one that matters [S18]; and
`<CreateOrganizationDialog>` stays mounted (closed) even with `hideCreate` set [S18].

### What the switcher does not do

It is a **dropdown for a shell**, not a post-login page, and it does not resume an OAuth
flow. Its `setActive` path calls the mutation and stops; its other path navigates to
`${basePaths.organization}/…` [S18]. The resume T-004's page performs — POST
`/oauth2/continue` with `{ postLogin: true, oauth_query }` — has no place in it. The
library agrees: `oauthContinueOptions`' docstring reads "Call this after a redirect screen
finishes its own job: signup (`{ created: true }`), account selection
(`{ selected: true }`), or **an application-owned post-login screen**
(`{ postLogin: true }`)" [S6], and the OAuth-provider docs say "Keep the query string on
every one of those pages. Do not strip it" [S21].

### The decision

**A picker screen the platform writes**, on `useListOrganizations`,
`useSetActiveOrganization` and `useOAuthContinue` from
`@better-auth-ui/react/plugins/organization` and `…/plugins/oauth-provider` [S13]. Do not
install the registry's `organization` item. The `auth-provider`, `auth` and `email-otp`
items give the sign-in screen; nothing else is needed for this ticket.

A shell switcher later is a separate, small decision, and a cheap one — by then the copied
component can be taken as *one file* rather than as the item, which is what a copy-in
registry is for.

---

## 2. The `localization` keys that must say *workspace*

The 1.7.x localization is **per plugin**. The organisation strings are not in the root
`Localization` object at all; they live in
`@better-auth-ui/core@1.7.19/src/plugins/organization/organization-localization.ts` and are
overridden by passing `organizationPlugin({ localization: { … } })`, a shallow spread over
the defaults — so a partial override keeps every key it does not name [S15, S22]. (The
root `localization` prop on `AuthProvider` is deep-merged with the locale bundle; the
per-plugin one is the shallow spread [S15, S23].)

Every key whose English value contains *organization*, plus the two the picker will render
that do not, with what each must become. Keys the platform will not render in v0.1 are
marked — they are listed for completeness, not for overriding now. Line numbers are in
`organization-localization.ts` [S22].

| Key | Line | Default English | Rendered by v0.1? |
| --- | --- | --- | --- |
| `organization` | 91 | "Organization" | **Yes** — the picker's own noun |
| `organizations` | 98 | "Organizations" | **Yes** |
| `noOrganizations` | 89 | "No organizations" | **Yes** — the refused screen's neighbour |
| `organizationsDescription` | 100 | "Create an organization to collaborate with others and manage shared access." | **Yes**, and it must lose the create verb entirely |
| `personalAccount` | 150 | "Personal account" | No word to change, but there is no personal workspace here — suppress with `hidePersonal`, do not translate |
| `manage` | 71 | "Manage" | No word to change; suppress with `hideSettings` |
| `organizationProfile` | 103 | "Organization profile" | Later |
| `organizationUpdatedSuccess` | 105 | "Organization updated successfully" | Later |
| `organizationDeleted` | 93 | "Organization deleted" | No |
| `createOrganization` | 31 | "Create organization" | No |
| `deleteOrganization` | 35 | "Delete organization" | No |
| `deleteOrganizationDescription` | 37 | "Permanently delete this organization and all of its data. …" | No |
| `leaveOrganization` | 60 | "Leave organization" | No |
| `leaveOrganizationDescription` | 62 | "Leave this organization and lose access to its data …" | No |
| `leftOrganization` | 58 | "You left the organization" | No |
| `namePlaceholder` | 85 | "Enter the organization name" | No |
| `slugPlaceholder` | 179 | "organization-slug" | No (`hideSlug`) |
| `acceptInvitationTitle` | 5 | "Organization invitation" | T-027 |
| `acceptInvitationDescription` | 7 | "You've been invited to join {{organization}} as {{role}}." | T-027 |
| `changeMemberRoleDescription` | 26 | "Choose the roles this member should have in the organization." | T-027 |
| `inviteMemberDescription` | 55 | "We'll email them a link to join this organization. …" | T-027 |
| `organizationInvitationsEmptyDescription` | 95 | "Invite a teammate to collaborate in this organization." | T-027 |
| `removeSelectedMembersDescription` | 138 | "Remove the selected members from this organization? …" | T-027 |
| `removeMemberWarning` | 164 | "… remove this member from the organization? …" | T-027 |
| `userInvitationsEmptyDescription` | 186 | "Invitations to join an organization will show up here." | T-027 |
| `membershipLimitReached` | 220 | "This organization has reached its member limit." | T-027 |
| `invitationLimitReached` | 221 | "This organization has reached its invitation limit." | T-027 |
| `noTeamsDescription` | 205 | "Create a team to organize access within this organization." | No (no teams) |
| `teamLimitReached` | 212 | "This organization has reached its team limit." | No |
| `lastTeamRemovalDisabled` | 214 | "This organization must keep at least one team." | No |
| `organizationLimitReached` | 219 | "You have reached the organization limit." | No |
| `noRolesDescription` | 234 | "Create a role to define custom organization access." | No |

`{{organization}}` in `acceptInvitationDescription` is an **interpolation token, not a
word**: renaming it breaks the substitution. Only the surrounding prose changes.

### The strings a `localization` override cannot reach

**One user-visible string bypasses localization entirely.** In the copied
`components/auth/organization/organization-logo.tsx:64` the image alt text is
`alt={organization?.name ?? "Organization"}` — a hard-coded fallback, reached whenever a
workspace has no name [S24]. It is copied source, so it is edited in the tree; but a
builder who overrides only `localization` will ship it to a screen reader. (The other
match, `autoComplete="organization"` in `organization-profile.tsx:144`, is an HTML
attribute value and correct as it stands [S24].) Nothing else in the 53 organisation files
renders the word outside `organizationLocalization.*` [S24].

**Two more are configuration, not prose:**

1. `basePaths.organization` defaults to `/organization` and is a config prop on
   `AuthProvider`, not a localization key [S25]. A builder who overrides only
   `localization` still ships the word in the address bar. (The 3.x line called this
   `organization.basePath` with a `pathMode: "slug"`; in 1.7.19 slug routing is
   `organizationPlugin({ slug })` instead, and the docs are explicit that `slug` must be
   set to `null` rather than left `undefined` on non-slug pages [S18, S21].)
2. The error strings Better Auth's *server* returns — `ORGANIZATION_NOT_FOUND`,
   `NO_ACTIVE_ORGANIZATION`, `USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION` — are the
   server's, not the UI's. The platform's refusals already have their own words
   (`not-a-member`, `credentials-revoked`, `role-disagrees`, `role-unknown`,
   `malformed-claims`) and the picker should render those.

---

## 3. `app.` and `mcp.`: cookie domain, redirects, and the origin check

Today `baseURL` is `PUBLIC_URL`, the `mcp.` origin; `basePath` is `/`; `trustedOrigins` is
`[deps.publicUrl]`, which is already implied, since `getTrustedOrigins` pushes
`new URL(baseURL).origin` before it reads the option [S26, S14]. The SPA is served from
`app.`, one origin with the api (ADR 0006, amended [S27]).

| Thing | What 1.7.2 does by default | What must be configured |
| --- | --- | --- |
| **Session cookie domain** | With `advanced.crossSubDomainCookies.enabled` off, no `Domain` attribute at all — the cookie is host-only. Turned **on** with no `domain`, the domain is `crossSubDomainCookies.domain \|\| new URL(baseURL).hostname` — the **full hostname**, `mcp.betteranswers.com`, no leading dot, and there is no eTLD+1 or public-suffix logic anywhere in the package [S7, S28] | `advanced.crossSubDomainCookies: { enabled: true, domain: "betteranswers.com" }`. Without the explicit `domain`, a `Set-Cookie` issued by a response on `app.` for `Domain=mcp.…` is rejected by the browser outright and sign-in fails silently |
| **Other cookie attributes** | `secure` follows the `https://` base URL, `sameSite: "lax"`, `path: "/"`, `httpOnly: true`; `partitioned` is never set by the library; the prefix is `__Secure-`, never `__Host-` [S7, S28] | Nothing. `Lax` is correct: `app.` → `mcp.` is same-site (one registrable domain), so the cookie rides the top-level navigation into the OAuth flow |
| **`loginPage`** | `handleRedirect(ctx, \`${path}?${queryParams}\`)` — the configured string, verbatim, with the signed query appended. `ctx.redirect` sets `Location` unchanged and does not absolutise it, so `"/sign-in"` is resolved by the browser against **`mcp.`** [S8, S9] | The absolute SPA URL: `loginPage: "https://app.…/sign-in"`. It must carry no query of its own — the `?` is appended unconditionally |
| **`postLogin.page`** | Same construction, same relative-`Location` behaviour [S8] | `postLogin: { page: "https://app.…/choose-workspace", … }` |
| **`consentPage`** | Same construction | Stays `"/consent"` — consent is server-rendered on `mcp.` and the relative resolution is correct there (ADR 0009, amended [S29]) |
| **Origin / CSRF check** | Skipped on `GET`, `HEAD`, `OPTIONS`. On any other method it reads `Origin`, falling back to `Referer`, and **only runs when the request carries a `cookie` header** unless forced. `Origin: null` with `Sec-Fetch-Site: same-origin` is recovered from the request URL. A cookie-bearing POST with neither header is refused `MISSING_OR_NULL_ORIGIN`. A cookie-less POST with `Sec-Fetch-Site: cross-site` and `Sec-Fetch-Mode: navigate` is refused outright [S30] | `trustedOrigins: [publicUrl, appUrl]`. Every SPA POST that carries the session cookie — `/oauth2/continue`, `/organization/set-active`, `/sign-out` — sends `Origin: https://app.…`, which is neither `baseURL`'s origin nor currently listed |
| **Trusted-origin matching** | `new URL(baseURL).origin` is pushed first, then `options.trustedOrigins` (an array, or a function of the `Request` whose result is *unioned* with the static list and re-evaluated per request), then `BETTER_AUTH_TRUSTED_ORIGINS` comma-split from the environment. A pattern containing `*` or `?` is matched against the full origin if it contains `://`, otherwise against `host` **including the port**; a pattern without a wildcard must equal the origin exactly [S26, S31] | Two exact origins, no wildcard. `*.betteranswers.com` would match `app.betteranswers.com` but not the apex and not a port, and `[SEC1]` reads both origins from bootstrap anyway |
| **`callbackURL` / `redirectTo` / `errorCallbackURL` / `newUserCallbackURL`** | Validated against the same list, but a **relative** path is allowed if it passes `isSafeRelativeURL` — starts `/`, not `//`, no backslash, no control characters, no `%2F`/`%5C` in the path [S30, S32] | Nothing. The SPA's own redirects stay relative and never reach the list |
| **The resume state** | Not a cookie. The signed query is HMAC-verified against `options.secret` from the **posted `oauth_query` body field** and held in a per-request store; `verifyOAuthQueryParams` requires exactly one `sig` and an unexpired `exp` [S33, S34]. `/oauth2/continue` carries `sessionMiddleware`, so it is a cookie-bearing POST and takes the origin check above [S35] | Nothing beyond the two lines already named. The SPA echoes the received `location.search` back as `oauth_query`, which is what T-004's page does today [S14] |

### What must be configured for one session, in five lines

1. `advanced.crossSubDomainCookies: { enabled: true, domain: "<apex>" }` — the explicit
   `domain` is the whole point; the derived default is the wrong host [S7].
2. `trustedOrigins: [publicUrl, appUrl]` — exact origins, no wildcard [S26, S30].
3. `loginPage` and `postLogin.page` become absolute `https://app.…` URLs; `consentPage`
   stays relative on `mcp.` [S8].
4. `appUrl` joins `PUBLIC_URL` in `readIdentityBootstrap` as a second https origin —
   `apps/api/src/config.ts` already has the `httpsOrigin` schema to validate it [S36],
   `[SEC1]`.
5. `baseURL` does **not** move. The issuer, the protected-resource metadata's `resource`
   and the token audience are all derived from it and are spec-exact on `mcp.` [S36, S14].

### One surprise worth naming

There is an **auto-resume path that never calls `/oauth2/continue`**. A plugin-wide
`after` hook fires whenever a response sets the session-token cookie *and* `oauth_query`
was in the request body: it looks the new session up and runs the authorization directly
[S37]. So a sign-in POST that carries `oauth_query` resumes by itself. better-auth-ui's
sign-in form will not add that field, so this is not the path T-037 gets for free — but it
means a hand-written sign-in POST and the picker's explicit `/oauth2/continue` are two
routes to the same place, and a test that asserts a `/oauth2/continue` call is asserting
the shape of the wiring, not the shape of the protocol.

---

## 4. The provider's requirements, with TanStack as the model

`AuthProvider` from `@better-auth-ui/react` is the npm primitive; the registry's
`auth-provider` item copies a thin wrapper over it that adds `Link` and an `ErrorToaster`
[S25, S38].

| Requirement | What 1.7.19 actually needs |
| --- | --- |
| `authClient` | Required [S25, S39] |
| `navigate` | **Required**, typed `(options: { to: string; replace?: boolean }) => void`. TanStack Router's `useNavigate()` result matches it exactly and is passed straight through — the docs say so and their example does it [S25, S40] |
| `replace` | Not a separate prop. It is the `replace` field inside `navigate`'s argument [S25] |
| `Link` | **Not an npm prop.** It is added to `AuthConfig` by module augmentation in the *copied* `auth-provider.tsx`, typed as a component taking `{ className?, href, to? }` plus `aria-disabled`, `tabIndex` and `onClick`. `DeepPartial` makes it optional at the type level and there is no default, so a component that renders a `<Link>` throws if it is omitted. TanStack Router's `Link` cannot be passed directly; the docs are explicit — "Do not pass TanStack Router's `Link` directly as `Link={Link}`" — and show `Link={({ href, ...props }) => <Link to={href} {...props} />}` [S38, S40] |
| `QueryClientProvider` | **Not required above it — but pass the app's client.** `AuthProvider` renders its own `QueryClientProvider`, resolving the client as the `queryClient` prop → the one already in `QueryClientContext` → a module-level fallback, and sets retry defaults on `authQueryKeys.all` [S25]. The spec's wording ("needs a `QueryClientProvider` above it") over-states it; the substance is that auth queries and the tRPC queries must share **one** cache, so the SPA passes its own client as `queryClient`, or mounts its provider higher and lets the context branch win. Every hook in the package is TanStack Query [S25, S39] |
| `localization` | Root `localization` is deep-merged over the locale bundle; per-plugin `localization` is a shallow spread inside `organizationPlugin({ … })`. There is also a `locale` prop and a `@better-auth-ui/locales` package for whole-language bundles, with `localization` taking priority over the locale [S15, S23, S40]. We want per-plugin `localization` only |
| `redirectTo` | Defined as a **getter**: every read returns `?redirectTo=` from `window.location.search` if present, else the configured value [S25]. `useSignInContinuation` navigates to it after a successful sign-in [S41] |
| `basePaths` | `{ admin: "/admin", auth: "/auth", settings: "/settings", organization: "/organization" }` by default, overridable as one config prop [S25] |
| `sonner` | The copied `auth-provider` mounts an `ErrorToaster` over it; `sonner` is a registry dependency [S11, S38] |
| Peers | `better-auth >= 1.7.0` (1.7.2 ✓), `react`/`react-dom >= 19.2.6` (19.2.8 ✓), `@tanstack/react-query` and `@tanstack/query-core >= 5.101.2`, `tailwindcss >= 4.3.2` (Tailwind v4, as the spec chose ✓), `zod >= 4.4.3` (4.5.4 ✓), `clsx >= 2.0.0`, `tailwind-merge >= 3.5.0`, `react-email >= 6.0.0` for the email templates only. ESM only [S12] |

**The carried signed query is the SPA's job.** `loginPage` sends the person to
`https://app.…/sign-in?ba_param=…&sig=…` and adds no `redirectTo`;
`useSignInContinuation` navigates to whatever `redirectTo` reads at that moment, and it
handles only the two-factor branch — it knows nothing about OAuth [S8, S41]. So the
sign-in route must preserve `location.search` and point the continuation at
`/choose-workspace` + that same search. Which mechanism is cleanest — a route-scoped
`redirectTo`, or an edit to the copied `sign-in.tsx` — is a T-037 wiring choice; both are
open. It cannot be done by putting a query on `loginPage`, because the redirect appends
`?` unconditionally and a second `?` would corrupt the signature [S8].

---

## 5. The pin, read on the day (`[DEPS1]`)

Read from the npm registry on **2 September 2026**:

| Package | Version | Published |
| --- | --- | --- |
| `@better-auth-ui/core` | **1.7.19** | 2026-09-02 [S12] |
| `@better-auth-ui/react` | **1.7.19** | 2026-09-02 [S12] |
| `@better-auth-ui/locales` | **1.7.19** | 2026-09-02 [S12] |
| `@daveyplate/better-auth-ui` | 3.4.0 — **not adopted**, see §1 | 2026-03-23 [S10] |

The spec records "the pin read at 2 September 2026 was 1.7.18" [S2]. That was the same
line, read earlier the same day: 1.7.18 was published at 14:04 UTC and 1.7.19 at 17:47 UTC
[S12]. The spec's "releases daily" is accurate for `@better-auth-ui/*` — 1.7.15 on 31
August, 1.7.16 and 1.7.17 on 1 September, two more today — and inaccurate for
`@daveyplate/better-auth-ui`, which has not moved since March. The builder re-reads on the
day, as the spec already says.

The registry components are **copied source, not a dependency** — there is nothing to pin
for them beyond the npm packages they import, and `[DEPS2]` applies only if a version has
to be named somewhere no manifest holds it.

---

## What is unverified

- Whether `@better-auth-ui/core@1.7.19` still ships a client-side map of Better Auth's
  organisation error codes (the 3.4.0 line did [S42]). Not read; the platform's own
  refusal words are what the picker should render either way (§2).
- Whether `partitioned` cookies are needed. The library never sets the attribute [S28],
  and `app.` → `mcp.` is same-site, so it should not arise; no browser test was run.
- The `Sec-Fetch-Site` value a browser sends on the `app.` → `mcp.` top-level navigation
  the OAuth flow performs. Read from the check's code, not observed [S30].
- Whether the registry's `sign-in` component can be driven to email-code only without
  editing it. The `email-otp` item and the `emailOtpPlugin` exist [S11], but the
  interaction with `emailAndPassword` defaulting to `enabled: true` [S39] was not read.
- Whether any registry component supplies a fallback `Link`, so that omitting the prop is
  survivable for the components this ticket uses. Only the switcher's use was traced
  [S18].
- Protocol-relative `trustedOrigins` patterns (`//host`). No branch in
  `matchesOriginPattern` handles them, so they would never match; not tested [S31].

---

## Sources

Repository files are at the tree as of `7ea5587`. Package files were read from
`node_modules/.pnpm/…` (installed) or unpacked with `npm pack` into a directory outside
the repo (registry line); neither was added to the lockfile. All URLs were read on
2 September 2026.

- **[S1]** `apps/api/package.json` — `better-auth@1.7.2`, `@better-auth/oauth-provider@1.7.2`, `@better-auth/core@1.7.2`, `@better-auth/drizzle-adapter@1.7.2`, `@better-auth/cimd@1.7.2`.
- **[S2]** `apps/docs-site/specs/T-022.md` §§ "Hostnames and origin", "Sign-in, picker and the refused screen move into the SPA", "UI kit".
- **[S3]** `https://better-auth-ui.com/r/organization.json` — the item description and its 53 `files[].target` entries and dependency list; `https://better-auth-ui.com/r/organization-switcher.json` returns 404, so there is no separate switcher item.
- **[S4]** `@better-auth-ui/core@1.7.19` `src/plugins/organization/list-organizations-query.ts:49` — `listOrganizationsOptions`, `queryFn` calls `authClient.organization.list`.
- **[S5]** `@better-auth-ui/core@1.7.19` `src/plugins/organization/set-active-organization-mutation.ts:31–34` — `mutationFn` calls `authClient.organization.setActive`.
- **[S6]** `@better-auth-ui/core@1.7.19` `src/plugins/oauth-provider/oauth-continue-mutation.ts:20–34` — `oauthContinueOptions`, its docstring, and `authClient.oauth2.continue`.
- **[S7]** `better-auth@1.7.2` `dist/cookies/index.mjs:20–46` — `createCookieGetter`; line 25 is the domain derivation, lines 33–43 the attribute defaults.
- **[S8]** `@better-auth/oauth-provider@1.7.2` `dist/authorize-BmTe2VYG.mjs:5690–5700` — `redirectWithPromptCode`, `handleRedirect(ctx, \`${options?.page ?? path}?${queryParams}\`)`.
- **[S9]** `@better-auth/oauth-provider@1.7.2` `dist/authorize-BmTe2VYG.mjs:5330–5338` — `handleRedirect`; and `better-call@1.4.0` `dist/context.mjs:60–62` — `redirect` sets `location` unchanged and returns a `FOUND` `APIError`.
- **[S10]** npm registry, `@daveyplate/better-auth-ui`: `version` 3.4.0, `time['3.4.0']` = 2026-03-23, 208 versions, no 1.7.18.
- **[S11]** `https://better-auth-ui.com/r/registry.json` — 54 items; `auth-provider`'s `dependencies` are `@better-auth-ui/core@latest`, `@better-auth-ui/react@latest`, `@tanstack/react-query`, `better-auth`, with `registryDependencies: ["sonner"]`. And `https://better-auth-ui.com/docs/shadcn.md`.
- **[S12]** npm registry, `@better-auth-ui/core`, `@better-auth-ui/react`, `@better-auth-ui/locales`: `version` 1.7.19; `time` for 1.7.18 = 2026-09-02T14:04:49Z, 1.7.19 = 2026-09-02T17:47:58Z, 1.7.15 = 2026-08-31, 1.7.16 and 1.7.17 = 2026-09-01. `@better-auth-ui/react@1.7.19` `package.json` — `peerDependencies`, `exports`, `"type": "module"`.
- **[S13]** `@better-auth-ui/react@1.7.19` `src/` — `components/{auth,icons,settings,mutation-invalidator.tsx}`, `plugins/organization/hooks/{queries,mutations}`, `plugins/oauth-provider/hooks/{queries,mutations}`; no switcher or picker file in the package.
- **[S14]** `apps/api/src/auth/auth.ts` — `baseURL`, `basePath: "/"`, `trustedOrigins`, the `schema` maps, `allowUserToCreateOrganization`, `beforeCreateInvitation`, `beforeAcceptInvitation`, `loginPage`, `consentPage`, `postLogin`; and `apps/api/src/auth/routes.ts:255–290` — the `/choose-workspace` POST, `setActiveOrganization({ body: { organizationId } })`, `callFlow(… "/oauth2/continue" …, { postLogin: true, oauth_query })`.
- **[S15]** `@better-auth-ui/core@1.7.19` `src/plugins/organization/organization-plugin.ts:35–133` — `OrganizationPluginOptions`; `:179–182` — the `{ ...organizationLocalization, ...options.localization }` spread.
- **[S17]** `@better-auth-ui/core@1.7.19` `src/plugins/organization/active-organization-query.ts:62–79, :113` — `resolveActiveOrganizationQuery` and `authClient.organization.getFullOrganization`.
- **[S18]** The registry's `components/auth/organization/organization-switcher.tsx` (from `https://better-auth-ui.com/r/organization.json`) — props at 33–44, the three hooks at 74–80, `setActiveOrganization({ organizationId: … })` at 109, the `hideCreate` gate at 214–229, the always-mounted `<CreateOrganizationDialog>` at 233–237, and the `<Link>` uses at 158 and 179; `@better-auth-ui/react@1.7.19` `src/plugins/organization/hooks/queries/use-list-organizations.ts:36–42`.
- **[S19]** `docs/research/better-auth-tenancy-and-agent-auth-2026-09-01.md` — "Can `organization` be mapped onto `workspace`".
- **[S20]** `packages/schema/src/workspace-table.ts` — `id`, `name`, `slug`, `logo`, `createdAt`, `metadata`.
- **[S21]** `https://better-auth-ui.com/docs/shadcn/plugins/oauth-provider.md` — "Keep the query string on every one of those pages. Do not strip it"; `https://better-auth-ui.com/docs/shadcn/plugins/organization.md` — the `slug` / `null` guidance.
- **[S22]** `@better-auth-ui/core@1.7.19` `src/plugins/organization/organization-localization.ts` (242 lines) — every key and line number in §2's table.
- **[S23]** `@better-auth-ui/core@1.7.19` `src/config/auth-config.ts` — `resolveAuthConfig`'s deep merge of `localization` with the locale bundle; `src/lib/auth-locale.ts:17` — `AuthLocale.plugins`.
- **[S24]** The registry's `organization` item files — `components/auth/organization/organization-logo.tsx:64` (`alt={organization?.name ?? "Organization"}`) and `organization-profile.tsx:144` (`autoComplete="organization"`); no other user-visible occurrence outside `organizationLocalization.*`.
- **[S25]** `@better-auth-ui/react@1.7.19` `src/components/auth/auth-provider.tsx` — `AuthProviderProps` (67–74), the `navigate` type, `fallbackQueryClient` (32–38), the `queryClient ?? contextQueryClient ?? fallbackQueryClient` chain (116–118), the `QueryClientProvider` wrap (131–140), the `redirectTo` getter (100–111), and `useAuth`'s throw (154–162); `@better-auth-ui/core@1.7.19` `src/lib/base-paths.ts:27–32` — the `basePaths` defaults.
- **[S26]** `better-auth@1.7.2` `dist/context/helpers.mjs:60–85` — `getTrustedOrigins`; `dist/context/create-context.mjs:127–144` — `trustedOrigins`, `isTrustedOrigin`.
- **[S27]** `docs/adr/0006-hono-server-and-vite-spa-not-nextjs.md` § Amendment — 2026-09-02.
- **[S28]** `better-auth@1.7.2` `dist/cookies/cookie-utils.mjs:10, 82, 103` — the `__Secure-` prefix and `partitioned` handling; no eTLD+1 or public-suffix logic anywhere in `better-auth` or `@better-auth/core`.
- **[S29]** `docs/adr/0009-better-auth-in-process-identity-provider.md` § Amendment — 2026-09-02.
- **[S30]** `better-auth@1.7.2` `dist/api/middlewares/origin-check.mjs` — `originCheckMiddleware`, `validateOrigin` (notably `if (!(forceValidate || useCookies)) return`), `validateFormCsrf`, `shouldSkipOriginCheck`.
- **[S31]** `better-auth@1.7.2` `dist/auth/trusted-origins.mjs:79–111` — `matchesOriginPattern`; `dist/utils/wildcard.mjs`.
- **[S32]** `better-auth@1.7.2` `dist/auth/trusted-origins.mjs:58–77` — `isSafeRelativeURL`.
- **[S33]** `@better-auth/oauth-provider@1.7.2` `dist/authorize-BmTe2VYG.mjs:4446–4470` — the `before` hook that verifies `ctx.body.oauth_query` and writes `oAuthState`; `:4160` — `oAuthState` as a per-request store.
- **[S34]** `@better-auth/oauth-provider@1.7.2` `dist/utils-C2yu_zRr.mjs:359–367` — `verifyOAuthQueryParams`; `dist/signed-query-Df1MNiSH.mjs` — the signed parameter names.
- **[S35]** `@better-auth/oauth-provider@1.7.2` `dist/authorize-BmTe2VYG.mjs:4555–4585` — the `/oauth2/continue` endpoint, its body schema and `use: [sessionMiddleware]`; `:136–180` — `continueEndpoint` and `postLogin`.
- **[S36]** `apps/api/src/config.ts` — `httpsOrigin`, `identityBootstrapSchema`, `PUBLIC_URL`.
- **[S37]** `@better-auth/oauth-provider@1.7.2` `dist/authorize-BmTe2VYG.mjs:4472–4497` — the `after` hook that resumes authorization when a response sets the session cookie.
- **[S38]** `https://better-auth-ui.com/r/auth-provider.json` — the copied `@components/auth/auth-provider.tsx`, its `declare module "@better-auth-ui/core"` widening of `AuthConfig` with `Link`, and `ErrorToaster`.
- **[S39]** `@better-auth-ui/core@1.7.19` `src/config/auth-config.ts:33–125` — `AuthConfig` and `AuthConfigOptions`; `:129–153` — `defaultAuthConfig`.
- **[S40]** `https://better-auth-ui.com/docs/shadcn/integrations/tanstack-start.md` and `https://better-auth-ui.com/docs/shadcn/components/auth-provider.md` — the provider example, the `navigate` and `Link` guidance, the `locale` / `localization` precedence.
- **[S41]** `https://better-auth-ui.com/r/auth.json` — `@components/auth/use-sign-in-continuation.ts` and `sign-in.tsx`'s `onSuccess` call.
- **[S42]** `@daveyplate/better-auth-ui@3.4.0` `src/localization/organization-error-codes.ts`.
- **[S43]** `CODING_RULES.md` `[DEPS1]`, `[DEPS2]`, `[SEC1]`.
