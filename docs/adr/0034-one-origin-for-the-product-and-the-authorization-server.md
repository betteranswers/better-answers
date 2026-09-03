---
status: accepted
date: 2026-09-03
---

# One origin carries the product, the authorization server and the MCP surface; the session cookie is host-only and consent is safe there because the client list is closed

The product answered on two hostnames that had to share one session: the single-page app,
sign-in and the workspace picker on `app.`, the OAuth 2.1 authorization server and the MCP
surface on `mcp.`. The only way a session made on the first answered a flow on the second was
a session cookie scoped to the apex — so the browser sent the product's own bearer to every
subdomain of the apex, present and future, **including any served one day by a third party.**
The reason the two hosts were split, Cloudflare Access in front of `app.`, was removed on
2 September 2026 (ADR 0022 amended, ADR 0009 amended). With the reason gone, the split was
pure cost: two trusted origins, a dual-host fence entry for `/oauth2/continue`, a cross-origin
consent hop, a fourth hostname for T-005's tunnel and rate-limit rules, and a consent flow
that could not be proved in the browser suite, because the loopback estate had two hosts and a
host-only cookie.

**So there is one origin.** The SPA, sign-in, the picker, consent, `/oauth2/*`,
`/.well-known/*`, `/jwks` and `/mcp` all answer on `app.<apex>`. The *MCP surface*'s address is
`app.<domain>/mcp` — the protected-resource document's `resource`, every access token's
audience, the client-registration default and its allowed resources, and the glossary entry all
say so. `agent.` stays the machine route for the share agent and the apex goes on answering
nothing, so the collapse touches one boundary and not three. `PUBLIC_URL` is the app origin and
`APP_HOSTNAME` is derived from its host, exactly as `mcp.` was derived by T-039; `AGENT_HOSTNAME`
and `APEX_HOSTNAME` remain bootstrap env. **Three hostnames, all of which must differ, the
derived one included; the app refuses to start otherwise.** The `mcp` hostname role and the
`mcp` field of the public-hostnames shape are deleted.

**This lands now because the issuer cannot move quietly later.** The issuer URL a Claude
connector registers against is the authorization server's origin, and it changes from `mcp.` to
`app.`. No client credential exists yet, so the change costs nothing today and would cost a
client's connection on any later day. The prototype path is therefore re-proved against the real
claude.ai client over a Cloudflare quick tunnel on the new issuer before T-005's first deploy,
as prototype 61 was run; the issuer used, the date and the outcome are recorded in the PR body.

**There is no public documentation site at this stage.** ADR 0022's line placing `docs.` on
Cloudflare Pages is struck. The ops documents' public halves live in the docs-site source,
unrendered (T-044, ADR 0027), and `.cubic/wiki` is orientation and never authority. That
removes the one hostname the two-host shape was still being kept open for.

## The fence

The app's own hostname list (ADR 0022's second fence, `apps/api/src/ingress/hostnames.ts`)
becomes a **path fence on the app host**: one ordered list of surface → hostnames → reason with
a catch-all last, tested both ways, one hostname role fewer and three entries fewer (nine became six). `/mcp`,
`/.well-known/*`, `/jwks` and `/oauth2/*` are paths on `app`; the share agent's surface stays on
`agent`; `/health` answers on `app` and the loopback; the apex carries an empty path set; the
catch-all is `app`. The `/sign-in` and `/choose-workspace` entry and the `/oauth2/continue`
entry **fold into the catch-all**, because the reason each existed — separating the product's
screens from the issuer's host — no longer names two hosts. Each surviving entry's reason is
rewritten to say why it is a path on `app.` rather than why it was a host.

`/consent` keeps an entry of its own. Not because the catch-all would refuse it, but because it
carries the navigation-only fence below, and a builder reading the list must see that consent is
not simply the wildcard. At the edge, Cloudflare's rate-limit rules match **paths on `app.`**
rather than hostnames; the Pro trigger is unchanged, since the plan is the same either way.

## Consent on the same origin as the product

Consent stays **server-rendered by the api on the app origin, outside the SPA's shell** — a
decision to grant a client access is never dressed as an ordinary screen. What changes is the
reason it is safe there. ADR 0009 said consent sat outside the shell *because it was on the
other host*, and that reason has been spent.

**The reason now is the closed client list plus PKCE.** The CIMD allow-list
(`isMetadataDocumentUrlAllowed`, `CIMD_ALLOWED_CLIENT_HOSTS` in `apps/api/src/auth/constants.ts`)
admits only `claude.ai`. ADR 0009 took that decision on 2 September 2026 and left it to land
with T-005; consent's move onto the product's origin rests on it, so it lands here, before
the move and not after (Cubic's branch review of T-045). The list admits only `claude.ai`, so a code obtained by any script running in the product's shell lands only at
Claude's own redirect URI, and PKCE binds that code to the verifier the host holds and no script
has. A same-origin script therefore gains nothing by reading the consent page.

**A navigation-only fence on the consent POST.** The consent form answers with a redirect, so it
can only be reached by a document navigation: a POST whose `Sec-Fetch-Dest` is not `document` is
refused. The existing same-origin fence on the POST stays. Together the two say: a browser
navigated a form here, from this origin; no fetch did.

**Whether consent is shown again.** Read from `@better-auth/oauth-provider` 1.7.2's own
`authorize` source and held by the browser suite (`apps/web/e2e/consent.spec.ts`): when the
authorization request carries `prompt=consent` — which claude.ai always sends — **consent is
shown on every authorization**. Without `prompt`, an existing `oauth_consent` row for the same
user and client, whose scopes and resources cover the request, skips the screen. Both facts are
assertions in the suite rather than a note here, so neither can drift unseen. This is the answer
to the one behaviour the spec left open.

## The session cookie

The session cookie is **Better Auth's own `__Secure-`-prefixed, host-only cookie, now**.
`apexCookieDomain` and the `crossSubDomainCookies` branch are deleted from the fence module, the
auth dependencies and the server factory. Trusted origins become **one entry, the app origin**,
and Better Auth's origin check stays explicitly on under every test runner, as it is today.

**`__Host-` is a written trigger, not a change.** The day a subdomain of the apex is served by
anything but this process, the cookie moves to `__Host-`. The attack the prefix defends against
is cookie-tossing login fixation, which needs such a subdomain, and none exists. Better Auth
documents the `__Secure-` prefix and a custom cookie name; `__Host-` is undocumented, so taking
it today would be an undocumented configuration bought against an attack that has no path — which
is why it is written as the condition rather than taken as the default.

## Sign-in, decided in the same grilling

Recorded here because the decisions were taken beside the origin and one of them is why the
origin lands first. **Sign-in is an email code or Microsoft, never a password.** Password and
sign-up endpoints on Better Auth's wildcard are refused by configuration — no password or
sign-up plugin is enabled and the product never posts to them — and that refusal is reviewed
in the endpoint snapshot (`apps/api/tests/better-auth-endpoints.txt`).

Claude and Notion were rejected as sign-in methods: neither is where a company's IT creates and
removes people. **Microsoft is a sign-in method through Better Auth's `microsoft` social
provider on one multi-tenant Entra app registration the platform owns.** A person is invited by
email first; an account links only on an exact verified-email match with the invitation; a
mismatch is refused on the refused screen and the Admin re-invites the right address. The Entra
redirect URI is `https://app.<apex>/callback/microsoft`, **which is why this origin lands
first**. Microsoft sign-in is its own task after T-045 and before the first client is onboarded;
it does not block T-005, and the Entra app registration is the owner's act outside this
repository.

**The per-client `sso` shape is a written trigger.** Better Auth's `sso` plugin against a
client's own tenant is what answers the day a client's IT asks for it; until one does, the
platform runs one registration it owns.

## Considered options

- **`mcp.` kept as a bearer-only resource host** — the SPA, sign-in, consent and `/oauth2/*` on
  `app.`, `/mcp` alone left behind. Rejected: it keeps a second document-serving host and a
  four-hostname fence for the sake of one bearer path, and the cookie question it was meant to
  settle is settled by the collapse anyway.
- **Two hosts, with `docs.` moved off the apex** — leave the split and shrink the blast radius of
  the apex-scoped cookie by owning every subdomain. Rejected: it leaves the future-subdomain
  exposure exactly where it was, since the guarantee is a promise rather than a mechanism, and it
  leaves the consent flow unprovable in the browser suite.

## Consequences

- **Files.** `apps/api/src/config.ts` (`PUBLIC_URL` derives the app hostname; three hostnames,
  all differing), `apps/api/src/ingress/hostnames.ts` (the path fence, one role fewer, no
  `apexCookieDomain`), `apps/api/src/auth/auth.ts` and `apps/api/src/auth/routes.ts` (one trusted
  origin, the host-only cookie, the consent page's navigation-only fence, the three page URLs on
  one origin), the api test harness and every suite that named `mcp.` for a path, and
  `apps/web/e2e/consent.spec.ts` as a new spec on a one-host loopback estate.
  `deploy/platform.compose.yaml` loses `APP_HOSTNAME`.
- **T-005** re-cuts four lines to the estate that exists: three hostnames, three tunnel ingress
  rules, rate-limit rules by path on `app.` (`/oauth2/*`, `/.well-known/*`, `/mcp` without a
  bearer, the sign-in endpoints), and two uptime checks on two paths of one host.
- **`CONTEXT.md`**'s entries *MCP surface* and *sign-in* already carry these words and are
  checked against the code in this task's PR.
- **ADRs 0008, 0009 and 0022 are amended** to point here, and the index's rows for all four are
  written in the same commit, which the ADR index test gates.
- **A Microsoft sign-in task is created beside T-045**, depending on it.
- **The re-prove is an acceptance artefact, not a test**: the claude.ai path over a quick tunnel
  on the new issuer, with the issuer, the date and the outcome in the PR body beside the `[SEC3]`
  adversarial pass.
