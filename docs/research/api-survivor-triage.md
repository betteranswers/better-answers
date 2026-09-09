# apps/api survivor triage, 2026-09-09

The baseline the nightly mutation report is read against for the api tier, the twin of
`docs/research/t-009-survivor-triage.md`. Source: [run
34323778136](https://github.com/betteranswers/better-answers/actions/runs/34323778136) —
score **67.05%**, 1,381 Killed + 7 Timeout of 2,070 mutants, **682 live rows** (528
Survived, 154 NoCoverage). Every live row was read against the source at HEAD and the
tests in `apps/api/tests/` that reach it. `[TEST6]` holds: this is a report, never a gate
— its verdicts feed hardening tickets, not CI.

| verdict | rows |
| --- | --- |
| **must-kill** | **360** |
| **worth-killing** | **220** |
| **noise** | **7** |
| **equivalent** | **95** |
| total | 682 |

**Runner faults: none.** Every `Survived` row carries `testsCompleted ≥ 1` (minimum 1,
maximum 164); no row has `testsCompleted: 0`, so the vitest-runner patch under `patches/`
is holding and there is nothing to report under `[TEST6]`'s zero-test heading. The 154
`NoCoverage` rows carry no `testsCompleted` field at all, which is that status's shape and
not a fault.

Verdicts: **must-kill** — the mutation changes observable behaviour at a seam that
matters; a missing test is a real gap. **worth-killing** — real behaviour, lower stakes;
kill when touching the area. **noise** — cosmetic. **equivalent** — cannot change
observable behaviour *here*, in one of two classes below.

**The two classes of equivalence, and only one is a proof.** Every `equivalent` row in
this document is labelled inline as one of:

- **(argued from the code)** — the mutant cannot produce a different value, statement or
  response, and the argument is in the source alone. `auth.ts:180`'s
  `clientIdOfQuery` is the shape: `new URLSearchParams(undefined)` is an empty search, so
  both arms of the ternary answer `undefined`.
- **(nothing observable at this seam)** — the two functions differ, and no caller, driver
  or fixture in this tree can reach the difference. `auth.ts:231`'s `trustedOrigins` is
  the shape: the library's own default already trusts `baseURL`, so an emptied list is
  indistinguishable from the stated one, and a test written to tell them apart would be a
  bespoke fixture moving the number rather than a property anyone holds.

A verdict here is a hypothesis (`docs/agents/mutation-triage.md`). Two rows were probed
against a positive and a negative control — both confirmed, and one of the probe runs
produced a false `killed` that is itself recorded; the whole of it is in **Probes** at the
foot of this document. Where a row is reported `Survived` but an existing assertion looks
like it should kill it, the row says so and names the assertion rather than guessing a
mechanism.

## Per-file counts

| file | live | must-kill | worth-killing | noise | equivalent |
| --- | --- | --- | --- | --- | --- |
| `apps/api/src/auth/auth.ts` | 102 | 60 | 15 | 2 | 25 |
| `apps/api/src/mcp/entries/index.ts` | 100 | 69 | 28 | 0 | 3 |
| `apps/api/src/auth/routes.ts` | 97 | 61 | 28 | 0 | 8 |
| `apps/api/src/ops/index.ts` | 96 | 37 | 47 | 5 | 7 |
| `apps/api/src/mcp/surface.ts` | 48 | 15 | 17 | 0 | 16 |
| `apps/api/src/reconciler.ts` | 29 | 28 | 1 | 0 | 0 |
| `apps/api/src/ingress/hostnames.ts` | 27 | 3 | 14 | 0 | 10 |
| `apps/api/src/ingress/limits.ts` | 25 | 2 | 7 | 0 | 16 |
| `apps/api/src/auth/verify.ts` | 24 | 13 | 6 | 0 | 5 |
| `apps/api/src/config.ts` | 23 | 15 | 8 | 0 | 0 |
| `apps/api/src/ingress/spa.ts` | 22 | 14 | 7 | 0 | 1 |
| `apps/api/src/ops/http-fetch.ts` | 18 | 1 | 15 | 0 | 2 |
| `apps/api/src/trpc/router.ts` | 17 | 17 | 0 | 0 | 0 |
| `apps/api/src/ops.ts` | 12 | 0 | 12 | 0 | 0 |
| `apps/api/src/server.ts` | 11 | 4 | 5 | 0 | 2 |
| `apps/api/src/auth/pages.ts` | 10 | 4 | 6 | 0 | 0 |
| `apps/api/src/auth/constants.ts` | 7 | 5 | 2 | 0 | 0 |
| `apps/api/src/auth/roles.ts` | 7 | 6 | 1 | 0 | 0 |
| `apps/api/src/trpc/base.ts` | 6 | 6 | 0 | 0 | 0 |
| `apps/api/src/auth/endpoints.ts` | 1 | 0 | 1 | 0 | 0 |

`apps/api/src/trpc/mount.ts` and `apps/api/src/mcp/entries/define.ts` have no live row:
every mutant in both is killed.

---

# Untested branches

The 154 `NoCoverage` rows fall into the fourteen clusters below, plus a handful of
single-row cases carried in the full table (the `"declined"` literal at `auth.ts:364`, the
closed-client-list fallback at `auth.ts:569:49`, four `?? ""` defaults behind
`String.split`, and the `HEAD` arm of `spa.ts:48`). Each cluster is a branch no test in
`apps/api/tests/` executes at all.

- **The membership read's two failures (`auth/auth.ts:203-208`, 6 rows).** `membershipsOf`
  answers a store failure by rethrowing (a read that did not happen is not an answer, and
  the identity provider turns a throw into a 500) and a `malformed` person id by logging
  and failing closed to no workspace. Nothing makes `workspacesHeldBy` refuse, so neither
  arm runs and the whole discrimination the docblock argues for is unproven. **Deserves
  tests: yes** — it decides whether a database wobble reads to a person as "you belong
  nowhere".
- **Consent's inner workspace fence (`auth/auth.ts:519-522`, 5 rows).** Better Auth's own
  `/oauth2/consent` refuses `set_workspace` when the person holds no workspace the token
  could name. The tier's own `/consent` page is the outer fence and every test goes through
  it, so this one — the one T-077's adversarial pass added precisely because the page's
  fence does not sit in front of it — never fires. **Deserves tests: yes.**
- **`shouldRedirect`'s late session write (`auth/auth.ts:539-546`, 5 rows).** A session made
  before the person's one membership existed has its `active_workspace_id` set here, once, as
  the platform's own write to the identity set. Every test's session is created after the
  membership, so the session-create hook wins and this fallback never runs. **Deserves tests:
  yes** — provisioning a workspace for a person who is already signed in is the ordinary
  production order.
- **Better Auth's own member and invitation fences (`auth/auth.ts:425-435`, `448`, 6 rows).**
  `beforeAddMember`'s role refusal, `beforeAcceptInvitation`'s refusal and
  `afterCreateOrganization`'s partition write are never executed. `beforeUpdateMemberRole`
  and `beforeCreateInvitation` are covered and killed, so the asymmetry is exact: the
  platform proves it refuses *creating* an invitation and *updating* a role, and proves
  nothing about *accepting* one or *adding* a member. **Deserves tests: yes** for the two
  fences; the partition hook is unreachable while `allowUserToCreateOrganization` is false.
- **The same-origin fence's origin-less arm (`auth/routes.ts:125:33-96`, 12 rows).** The arm
  that admits a browser navigation — `origin === undefined && (site is undefined,
  "same-origin" or "none")` — is never evaluated, because the harness sets `Origin` on
  every POST. **Deserves tests: yes**, and see Platform findings: the fence as a whole never
  refuses anything.
- **The consent failure path (`auth/routes.ts:350-358`, 5 rows).** When the in-process
  `/oauth2/consent` call answers nothing a redirect can be read out of, the route logs
  `auth.consent_failed` with the status and body and renders "Something went wrong". No test
  makes the call fail. **Deserves tests: yes** — this is the operator's only signal that a
  person could not complete a connection.
- **The consent page's malformed-carry fallbacks (`auth/routes.ts:295`, `308`, `310`, `311`,
  `56:73`, 5 rows).** "an unknown address", "This app", "your workspace" and the empty
  `redirect_uri` — every fallback the page renders when the carried query or the client row
  is not what it expects. **Deserves tests: yes**; these are the words a person reads while
  deciding whether to grant.
- **The per-call refusal inside an MCP entry (`mcp/surface.ts:119-124`, `213-215`, 9 rows).**
  `withPrincipal` refusing *inside* `tools/call` logs `mcp.call_refused` and answers "Your
  credentials were refused. Sign in again." Every refusal the suite provokes happens one
  layer earlier, at the request-level gate, so this arm and `refusedResult` are dead in
  tests. **Deserves tests: yes** — ADR 0018 judges a token per call.
- **`open`'s locator input mode through the surface (`mcp/entries/index.ts:185:34`, 3 rows).**
  `open` is only ever called with `{ iri }`, so the `{ locator: args.locator ?? "" }` arm is
  never built. The same gap is `packages/core`'s (T-009's triage flags it there too), and
  fixing it needs both. **Deserves tests: yes.**
- **The whole `session.membership` tRPC procedure (`trpc/router.ts:22`, `32-40`, `49:41`, 14
  rows) and the base's store-failure refusal (`trpc/base.ts:62-65`, 4 rows).** No test calls
  `session.membership` over tRPC at all, and no test makes the session read or a slice read
  fail. **Deserves tests: yes** — the docblocks state the property ("a store failure is
  never told to a client as a signed-out session") and nothing holds it.
- **The reconciler's four quiet paths (`reconciler.ts:72-73`, `102-109`, `119-122`, 16
  rows).** A tick that threw, a tick that could not list the workspaces, a tick that stopped
  at a commit the index refused, and the info and debug lines for a tick that replayed
  something or found nothing. Every covered tick has a refused workspace, so only the warn
  arm ever runs. **Deserves tests: yes.**
- **`orExit` and the two `require*Bootstrap` wrappers (`config.ts:181-192`, 10 rows).** The
  whole of "a process that cannot read its own configuration says why on the way out"
  (`[APP2]`) — the error log and `process.exit(1)` — is never executed. **Deserves tests:
  yes**, through a spawned process rather than by stubbing `process.exit`.
- **The `pnpm ops` process wrapper (`ops.ts`, all 12 rows).** Bootstrap, the pool, stdin,
  the `say` writer and the exit code. The suite drives `runOps` directly through
  `ops/index.ts`, which is the right seam (`[TEST1]`); what is untested is the wiring around
  it. **Deserves tests: partly** — the argv slice and the exit code are worth a spawned-process
  test; the rest is three lines of construction.
- **The smoke check's catch arm and the dump-grep usage refusal (`ops/index.ts:202-204`,
  `255-256`, `182-183`, `232:79`, `238:75`, `251:49`, `400:31`, `509-511`, 13 rows).** A
  surface that throws rather than answers, `smoke` with no `--url`, `dump-grep` with no
  `--tokens`, and `reconcile-watermark`'s stop-and-report refusal (ADR 0012's "reported,
  never skipped"). **Deserves tests: yes** for the catch arm and the stop refusal; the two
  usage arms are worth-killing.

---

# Platform findings

`auth`, `ingress` and `ops` are the platform's security boundary. Everything below is a
live row that names an untested security-relevant branch, a guard that cannot fire, or a
place where the code and a document disagree.

## Fences no test ever makes refuse

1. **`sameOriginOnly` never refuses anything (`auth/routes.ts:117`, `122`, `124-126`, `264`
   — 13 must-kill rows).** Forcing `sameOrigin` true, emptying the refusal block, blanking
   the mount path: every one survives. The three cross-site consent tests each omit or
   falsify `Sec-Fetch-Dest`, so `navigationOnly` (whose own guard at line 152 *is* killed)
   refuses them first. The docblock calls this the fence against "a cross-site form post
   … carrying the person's cookie"; ADR 0034 rests consent's place on the product's origin
   on the pair of fences, and only one of the pair is proven. A test that posts cross-origin
   **with** `sec-fetch-dest: document` is the missing case.
2. **The origin the in-process auth call is told (`auth/routes.ts:101`).**
   `headers.set("origin", request.headers.get("origin") ?? publicUrl)` mutated to `&&`
   replaces a real cross-site `Origin` with `publicUrl` — the value Better Auth's CSRF check
   trusts — and every test stays green, for the same reason as finding 1.
3. **The per-IP limits in front of `/oauth2/*`, `/.well-known/*` and `/jwks`
   (`auth/routes.ts:249-251`).** Blanking each mount path leaves the suite green: the only
   ingress-limit test drives `/consent`. ADR 0022 makes the tunnel's rules the first fence
   and the app's counter the second, and the second is unproven on three of its four
   surfaces.
4. **The MCP 401 flood limit (`mcp/surface.ts:143`).** Emptying `flooded`'s body removes
   `MCP_UNAUTHENTICATED_IP_RULE` entirely (research 80 F8). The `/mcp` ceiling test exercises
   the per-token rule at line 193, never the pre-signature per-IP one.
5. **The scope every MCP call must carry (`mcp/surface.ts:171`, and the per-entry
   `scopes` at `mcp/entries/index.ts:61`, `94`, `131`).** `requiredScopes:
   [MCP_REQUIRED_SCOPE]` emptied, and `find`/`ask`/`open`'s own `scopes: ["knowledge:read"]`
   emptied, all survive: every token the suite mints carries `knowledge:read`. Trap 3
   (prototype 61) is about the challenge advertising the whole surface's scopes; what is
   untested is the guard the trap's note says enforces the one scope.
6. **A verified bearer that names no workspace (`mcp/surface.ts:180`).** `bearerOf`
   returning `undefined` is refused here, at the `/mcp` seam. `token-verifier.test.ts`
   proves the verifier refuses such a token, so the seam's own arm is dead in tests — but
   `bearerOf` reads `authInfo.extra`, which the verifier fills, so the two are not the same
   check.
7. **The OAuth client-registration allow-lists (`auth/auth.ts:491`, `492`, `496`).**
   `clientRegistrationAllowedScopes`, `clientRegistrationDefaultScopes` and
   `clientRegistrationAllowedResources` emptied to `[]` all survive, while
   `clientRegistrationDefaultResources` (line 495) is killed. These are Traps 1 and 2, whose
   comment says every connection dies without them; nothing proves what a CIMD-discovered
   client may register for.
8. **A malformed client-ID URL on the closed client list (`auth/auth.ts:569`).** Dropping
   the optional chain in `URL.parse(clientIdUrl)?.hostname ?? ""` turns an unparseable client
   id into a thrown `TypeError` instead of a refusal, and the `""` fallback is `NoCoverage`.
   ADR 0034 rests consent's origin on this list admitting only `claude.ai`.
9. **`disabledPaths: ["/token"]` and `disableSettingJwtHeader: true` (`auth/auth.ts:234`,
   `377`).** Both survive emptying. `tests/better-auth-endpoints.txt` *lists* `/token` as
   mounted and its header says `disabledPaths` closes it — so the snapshot cannot notice, and
   no test calls `/token` or asserts the absence of a `set-auth-jwt` header. The JWT plugin's
   `/token` under an OAuth provider would mint a JWT from a cookie session.
10. **The sign-in code's storage (`auth/auth.ts:457`).** `storeOTP: "hashed"` blanked
    survives: nothing asserts that the `verification` row does not hold the code that was
    emailed.
11. **The email-code endpoint's stricter rule (`auth/auth.ts:254`).** `customRules`
    emptied to `{}` survives. `tests/oauth-flow.test.ts:697` asserts only that *a* 429
    appears in eleven requests and that `rate_limit` has rows — neither names the rule nor
    its threshold. Probed and confirmed — see **Probes**.
12. **The per-email throttle's key (`auth/routes.ts:162`).** `email.trim().toLowerCase()`
    mutated to `toUpperCase()` or to dropping `trim()` survives: nothing asks for a code at
    `Bob@x` and then `bob@x` and expects one counter, so a sender who varies case gets a
    fresh bucket each time. This is the counter that exists precisely because Better Auth's
    own limiter is per address per path.
13. **The IPv4-mapped IPv6 key (`ingress/limits.ts:31`).** Dropping either anchor from
    `/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i` lets an ordinary IPv6 address that merely
    *contains* a dotted quad be keyed as that IPv4 address — two unrelated clients sharing one
    rate-limit counter, or one client keyed as an address it does not hold.
14. **The three roles' registered statements (`auth/roles.ts:24-25`).** Emptying `Admin`'s
    `organization` and `member` permission arrays leaves "lets an Admin change a Viewer to an
    Editor" green, so the 200 that test asserts is not produced by these lines. ADR 0009's
    "the glossary's three words are the only roles the plugin can name" rests here. Probed
    over the whole suite and confirmed — see **Probes**.
15. **The bare-hostname pattern (`ingress/hostnames.ts:109`).** Dropping either anchor from
    `HOSTNAME_LABEL` weakens the refusal that stops a misconfigured hostname naming a host no
    arriving request can match (T-030, T-039).
16. **`PUBLIC_URL` with credentials (`config.ts:60-61`).** `url.username === ""` and
    `url.password === ""` forced true both survive, so `https://user:pass@app.example` would
    be accepted and carried into the issuer, the token audience, the protected-resource
    document and Better Auth's trusted origin. The refine's own message names credentials.
17. **`SMTP_URL`'s scheme (`config.ts:112`).** All three regex mutants survive, including
    the one that *narrows* to `smtps` only. The comment says the check exists so Coolify
    handing `${SMTP_URL:?}`'s message through as a value stops the process.
18. **The read-only guard in front of the SPA (`ingress/spa.ts:48`, `95`, `101`).** The
    `HEAD` arm is `NoCoverage` and forcing `isReadOnly` true survives, so a POST that falls
    through every mount would be answered with the shell's HTML at 200.
19. **The shell shadowing an authorization-server path (`server.ts:180`).** `if
    (answered.status !== 404) return answered` forced false survives. The comment says the
    shell is answered after Better Auth declines precisely "so no endpoint of it can be
    shadowed by the shell"; a document-accepting GET to a real Better Auth path would now get
    the shell, and nothing notices.
20. **`/health`'s liveness query (`server.ts:114`).** `database.query("select 1")` blanked
    to `""` survives — Postgres accepts an empty statement — so the check that holds `worker`
    back does not prove the database answered anything.
21. **The failure of a procedure inside its transaction (`trpc/base.ts:82`).** `if (!ran.ok)
    throw ran.error` forced false survives: a failed procedure would commit the transaction it
    failed inside. This is exactly the shape `[TEST8]` names, and the comment beside the line
    says so.
22. **The consent page's escaping (`auth/pages.ts:13-16`).** All four replacement strings in
    `escape` can be blanked with every test green, because no test renders a client name,
    workspace name or refusal message containing `&`, `<`, `>` or `"`. The surviving mutants
    *delete* the character rather than escaping it, so they are not themselves an injection —
    but the same silence would hide a change that stopped escaping altogether, and
    `client_name` is arbitrary text from a third party's metadata document rendered on the
    product's own origin (ADR 0034).
23. **`iat` as the revocation instant (`auth/verify.ts:119`).** `new Date(data.iat * 1000)`
    mutated to `/ 1000` survives: the revoked test still refuses, because a mis-scaled instant
    is *older* than any revocation. The other direction — a token issued after a revocation
    must be accepted, ADR 0035's "a fresh sign-in mints anew" — is never asserted.
24. **The JWKS cache and its rotation retry (`auth/verify.ts:76-77`, `86`).** Forcing
    `refresh` true (re-read the key set on every verification) and widening the retry from
    `JWKSNoMatchingKey` to every failure both survive: a verifier that fetched JWKS on every
    bearer would pass the whole suite.
25. **`alg`-less and non-JWT bearers (`auth/verify.ts:97-100`, `109`, `112`).** The
    not-a-JWT catch, the "names no algorithm" refusal and the "claims are not the surface's"
    refusal are all unexercised, and the `workspace === undefined` and `userId === undefined`
    arms of the workspace check survive while the `=== null` arm is killed.

## Audit and record findings

26. **The audit trail cannot tell a refusal from a success (`auth/auth.ts:321-322`, `362`).**
    Eight mutants on `redirected`, two on `refused` and the `"refused"` literal itself all
    survive: `oauth-flow.test.ts`'s audit test asserts only `outcome: "ok"` rows, so a refused
    sign-in, consent or token issue logged as `ok` would pass. Grilling Q12 names the outcome
    field.
27. **Nobody ever declines consent (`auth/auth.ts:363-364`, `auth/routes.ts:322`).** The
    `"declined"` outcome is never produced, and `form.get("accept") === "true"` forced true
    survives — a "Cancel" button that granted access would pass every test.
28. **The audited-path boundary and the token id (`auth/auth.ts:316`, `370`).** Removing
    `if (event === undefined) return` makes every Better Auth path emit an audit line, and
    `token_id: tokenId ?? null` mutated to `&&` makes the `jti` always null. Neither is
    asserted; ADR 0018's `jti` is the thread the audit slice uses.
29. **An issue and a refresh are indistinguishable in the log (`auth/auth.ts:347`).**
    Flipping `grant_type === "refresh_token"` swaps the two rows' names, and the audit test's
    `toMatchObject` on the refresh row omits `client_id`, so the two rows carry the same
    asserted shape.
30. **The identity provider's own actor id (`auth/auth.ts:22-24`).** `PLATFORM_PRINCIPAL`'s
    `kind` and `actorId` (`process:better-answers-identity`) can both be blanked. ADR 0035
    makes the actor id the thing every record names the platform by, and no test reads a row
    written under it.
31. **The reconciler's counts and its log level (`reconciler.ts:70-71`, `117-122`).**
    `replayed += …` mutated to `-=` survives, and every relaxation of the warn condition still
    warns because every covered tick has a refused workspace. The one line an operator reads
    (ADR 0012) has none of its numbers asserted and two of its three levels never produced.
32. **The reconciler's overlap flag and its stop (`reconciler.ts:132`, `140`).** Emptying the
    `finally` that clears `inFlight` leaves the flag set for the life of the process — every
    later tick skipped, the head check silently stopped — and removing `clearInterval` from
    `stop()` leaves ticks running after it. Both survive.
33. **The refusal a caller reads (`ingress/hostnames.ts:106`).** `HOSTNAME_REFUSAL` blanked
    survives because `tests/hostnames.test.ts:242` asserts `expect(body).toContain(HOSTNAME_REFUSAL)`
    — expectation and subject are the same symbol, so `toContain("")` is always true. This is
    `[TEST9]`'s self-referential oracle, the api tier's `NOT_ANSWERED`.

## Dead code and guards that cannot fire

Each of these is a guard a sibling runtime check has already made — the pattern
`CODING_RULES.md`'s § TYPES names as the thing a surviving mutant inside a guard detects.
None is a test gap; each is a candidate for deletion or a comment that says why it stays.

- **`auth/auth.ts:136`** — `Object.hasOwn(AUDITED_PATHS, path)`. Every `ctx.path` begins with
  `/`, and no prototype key does, so `AUDITED_PATHS[path]` is `undefined` for an unaudited
  path with or without the guard.
- **`auth/auth.ts:341`, `351`, `555`** — `claims?.success`, `if (parsed.success)` and
  `person?.id`. Each is guarded by an outer `!refused` or by the endpoint's own return shape,
  so the undefined arm cannot be reached.
- **`auth/auth.ts:584`** (8 rows) — `activeWorkspaceOf`'s normalisation of `null`, `undefined`
  and `""` to `undefined`. Both call sites immediately do `X !== undefined &&
  held.includes(X)`, and `held` never holds any of the three, so the normalisation changes no
  answer.
- **`auth/routes.ts:333`** — `resolved === undefined` cannot be true unless `claims ===
  undefined`, which the first term of the same `||` already caught.
- **`mcp/entries/index.ts:37`, `239`, `241`** — `valueOrThrow`'s throwing arm (the four acts
  declare `never` for their error, as the docblock says) and `run`'s `feedbackInput.safeParse`
  refusal (the door's own `.refine` at line 223 refuses every input that would fail it).
- **`mcp/surface.ts:83-85`, `113-114`, `156`** — the `authInfo === undefined` family (the SDK
  never invokes a tool without one, and line 180 already refuses a bearer-less `authInfo`), and
  the `^Bearer\s+\S+$` pre-flight guard, whose every relaxation ends at the same challenge the
  verifier would have produced. That guard is a cost fence, not a security one.
- **`ingress/hostnames.ts:182`, `209`, `223`, `236`** — `value.length > 0` (an empty string has
  one empty label, which `HOSTNAME_LABEL` already refuses); `surface !== undefined` (the
  catch-all `/*` matches every path, so `find` never answers undefined); the apex's role entry
  (the apex's path set is empty, so a request on it is refused whether its role resolves or
  not); and `role !== undefined` (an unknown host's role is in no entry's host list).
- **`ingress/limits.ts:27:65`, `36:17`, `ingress/hostnames.ts:163:76`, `168:35`** — four `?? ""`
  fallbacks behind `String.split`, which always returns at least one element.
- **`ingress/spa.ts:92`** — the SPA's own `isTheProduct` host check sits behind
  `routeByHostname`, which has already refused every non-`app.` request; a test that proved it
  would have to bypass the fence.
- **`auth/auth.ts:425-427`** — `afterCreateOrganization` is unreachable while
  `allowUserToCreateOrganization` is `false`, and that flag *is* proven, by "workspace creation
  is the platform's (Q11)".

## Code and documents that disagree

- **`ops/index.ts:73`'s docblock names an example its own regex refuses.** "`pg-20260903T020500Z`
  (a dump stamp) or any ISO 8601 instant" — but `parseSince`'s pattern is anchored with `^`, so
  the `pg-` prefix makes the stamp fall through to `new Date("pg-…")`, which is `NaN`, and
  `replay-erasures --since pg-20260903T020500Z` answers usage. `ops.test.ts:105` passes the bare
  `20260903T020500Z`. The two anchor mutants at line 74 are must-kill precisely because
  `parseSince("pg-20260903T020500Z")` is the input that discriminates them, and the repository has
  to decide which side is right — the docblock or the anchor. Nothing in `deploy/` was read for
  this triage, so which the restore scripts pass is open.
- **`tests/better-auth-endpoints.txt` names `/token` as mounted while `auth.ts:234` disables it.**
  The snapshot's own header explains it ("`disabledPaths` closes `/token`"), which is honest — but
  it means the review point cannot see the difference, and finding 9 above is the consequence.

---

# Must-kill shortlist

Ranked by what the branch protects: first the fences that decide who reaches a workspace,
then the records that say what happened, then the contracts a host reads.

1. **`auth/routes.ts:117`, `122`, `124-126`, `264`** — the same-origin fence on `/consent`
   never refuses. Covering test: none; `oauth-flow.test.ts`'s three cross-site tests are all
   refused by `navigationOnly` first. Missing assertion: a POST to `/consent` from
   `https://evil.example` **carrying `sec-fetch-dest: document`**, asserting 403, the refusal
   page's words, no `Location`, and no new `oauth_consent` row.
2. **`auth/auth.ts:518`, `534`** — `consentReferenceId`'s and `shouldRedirect`'s
   still-a-member check. Forcing the active workspace to be used without `held.includes` mints
   a token whose `workspace` claim names a workspace the person has left. Covering test: "mints
   no code for a person whose membership ended…" goes through the tier's own `/consent`, which
   the comment says this fence exists behind. Missing assertion: drive Better Auth's
   `/oauth2/consent` directly for a person whose active workspace was removed, and assert the
   `set_workspace` refusal.
3. **`auth/auth.ts:491`, `492`, `496`** — the CIMD client-registration scope and resource
   allow-lists. Covering test: "reaches consent with Claude's real authorize shape" passes with
   all three emptied. Missing assertion: register through CIMD asking for a scope and a resource
   outside the lists, and assert `invalid_scope` / `invalid_target`.
4. **`auth/auth.ts:234`, `377`** — `/token` and the `set-auth-jwt` header. Covering test: none;
   the endpoint snapshot lists `/token` as mounted by design. Missing assertion: a request to
   `/token` with a valid session asserting 404, and an assertion that no response in the flow
   carries `set-auth-jwt`.
5. **`auth/verify.ts:119`** — the token's `iat` as the instant revocation is judged against.
   Covering test: "refuses a token whose person was revoked after it was issued" refuses either
   way. Missing assertion: revoke, then sign in afresh, and assert the new token is *accepted* —
   the pair, both directions.
6. **`auth/verify.ts:76-77`, `86`, `97-100`, `109`, `112`** — the JWKS cache, the narrow
   rotation retry, and the four refusals a malformed bearer meets. Covering test:
   `token-verifier.test.ts`'s four cases. Missing assertions: count the JWKS reads across two
   verifications; present a non-JWT string, an `alg`-less header, a token with no `jti`, and a
   token with no `workspace` claim at all (as distinct from `null`).
7. **`mcp/surface.ts:171`, `180`, `143`, and `mcp/entries/index.ts:61`, `94`, `131`** — the
   scope gate on every call, the workspace-less bearer refusal at the seam, and the 401 flood
   limit. Covering test: every token the suite mints carries `knowledge:read`, and the ceiling
   test uses the per-token rule. Missing assertions: a token minted with `offline_access` alone,
   asserting each entry is absent from `tools/list` and each call refused; and a flood of
   bearer-less `/mcp` posts from one address asserting 429.
8. **`auth/roles.ts:24-25`** — the three roles' registered statements. Covering test: the two
   role tests are green with Admin's permissions emptied. Missing assertion: after emptying is
   proven observable, an assertion that names which line produced the 403 and the 200 — or a
   note in the source that the plugin does not consult these for `update-member-role`.
9. **`auth/routes.ts:249-251`, `ingress/limits.ts:31`, `auth/routes.ts:162`** — the ingress
   counters: the three unmounted-in-mutation limits, the IPv4-mapped key collision, and the
   per-email key's case folding. Missing assertions: a flood on `/jwks` and on
   `/.well-known/oauth-authorization-server`; `clientKeyOf("2001:db8::ffff:203.0.113.9")` asserted
   as a `/64` and not as the IPv4; and a code asked for at `Bob@x` then ` bob@X ` asserting one
   counter.
10. **`trpc/base.ts:62-65`, `82` and `trpc/router.ts:21-49`** — the tRPC seam's two properties:
    a store failure is a 500 and never a signed-out session, and a failed procedure rolls its
    transaction back. Covering test: none — `session.membership` is never called. Missing
    assertions: call it; then provoke the session read to fail with a real lock (the shape T-088
    used for `readMembership`), asserting `INTERNAL_SERVER_ERROR`; then provoke a procedure
    failure and assert the rows are not there (`[TEST8]`).
11. **`auth/auth.ts:321-322`, `362-364`, `316`, `347`, `370`** — the audit trail's outcome,
    its declined state, its boundary, its refresh naming and its token id. Missing assertions:
    a refused sign-in asserting `outcome: "refused"`; a declined consent asserting `"declined"`;
    the count of `module: "auth"` lines a flow produces; and each token row's `token_id`
    asserted against the `jti` read out of the response.
12. **`reconciler.ts:70-73`, `102-109`, `117-122`, `132`, `140`** — 28 of the file's 29 rows.
    Missing assertions: a tick over a workspace that replays two commits asserting
    `replayed: 2` and the info level; a tick whose reconcile throws; a tick that stops at a
    commit the index refuses; two ticks in a row asserting the second one runs; and `stop()`
    asserting no tick starts after it.
13. **`config.ts:60-61`, `112`, `140-141`, `189-192`** — credentials in `PUBLIC_URL`, the
    SMTP scheme, and the whole of "says why on the way out" (`[APP2]`). Missing assertions:
    `https://user:pass@app.example.test` refused; `smtp://` accepted and `http://` refused; the
    error's own text asserted against a literal; and a spawned `node src/ops.ts` with a broken
    environment asserting exit 1 and the reason on stderr.
14. **`ingress/spa.ts:46`, `48`, `95`, `101`, `103`, `69` and `server.ts:180`, `114`** — the
    SPA's read-only and document guards, its cache header, the shell's shadowing rule and
    `/health`'s query. Missing assertions: a POST to an unknown path asserting it is not the
    shell; an `accept: application/json` GET to an unknown path asserting 404 and not HTML; a
    document-accepting GET to a Better Auth path asserting the library's answer; and a `/health`
    against a database that answers but has no rows.
15. **`mcp/entries/index.ts:41-49`, `98-113`, `141-166`, `185`, `223-225`** — the surface's
    output contracts: the trust and passage schemas, `ask`'s whole answer shape (verdicts `ok`
    and `warn`, citations, conflicts, coverage, the map's `as_of` and `unavailable_since`),
    `open`'s found-concept shape and its two refinements, and `give_feedback`'s flag-needs-a-reason
    refusal. Covering test: `mcp-surface.test.ts` only ever gets `found: false` from `open`,
    `verdict: "refuse"` from `ask` and `hits: []` from `find`. Missing assertions: seed a
    concept and open it through the surface; assert an `ok` answer's structured content; and
    post a flag with no reason asserting the door's own refusal.
16. **`auth/constants.ts:27`, `39`, `53`** — three constants a test reads back into its own
    expectation. `oauth-flow.test.ts:570` compares the observed refresh lifetime against
    `REFRESH_TOKEN_LIFETIME_SECONDS` itself, so all three arithmetic mutants survive; the
    five-minute code life is a number in `constants.ts` and a sentence in `auth.ts:463`, checked
    against neither; and `SEND_EMAIL_CODE_PATH` is spelled once and read by both the mount and
    the test. `[TEST9]`: write ninety days, five minutes and the path down as literals.
17. **`auth/pages.ts:13-16`** — the consent page's escaping. Missing assertion: render consent
    for a client whose `client_name` is `<script>&"` and assert the served HTML contains the
    escaped form and not the raw characters.
18. **`ops/index.ts:217-238`, `265`, `202-204`, `509-511`** — the smoke command's four checks
    (every conjunct can be forced true and the drill still says ok), `dump-grep`'s redaction of
    a long token, the catch arm for a surface that is not there, and `reconcile-watermark`'s
    stop refusal. Missing assertions: run `smoke` against a stub that answers each check wrongly
    in turn; assert the masked and unmasked forms of a token either side of eight characters;
    and a `reconcile-watermark` over a bundle whose next commit the index refuses.
19. **`ingress/hostnames.ts:106`, `109`** — the refusal sentence (written down as a literal,
    not imported) and the DNS label pattern's anchors.
20. **`auth/auth.ts:202-208`, `22-24`, `457`, `254`** — the membership read's two failures, the
    platform actor id, `storeOTP: "hashed"` and the email-code custom rule.

---

# Full table

Rows on the same expression are grouped; `×n` is how many report rows the group holds.

## `apps/api/src/auth/auth.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `auth.ts:22-24` ×3 | Survived | ObjectLiteral/StringLiteral | must-kill | `PLATFORM_PRINCIPAL`'s kind and `process:better-answers-identity` actor id are never read back off a row any test asserts (ADR 0035) |
| `auth.ts:136` | Survived | ConditionalExpression | equivalent | *argued from the code*: every `ctx.path` starts with `/`, no prototype key does, so `AUDITED_PATHS[path]` is `undefined` with or without `hasOwn` |
| `auth.ts:153` | Survived | ConditionalExpression | worth-killing | `isPlatformRole`'s "no role given is fine" arm; no call site hands `refuseForeignRole` an undefined role |
| `auth.ts:159` ×2 | Survived | StringLiteral | worth-killing | the `invalid_role` refusal's `error_description` and its `", "` join; the test asserts `error` only |
| `auth.ts:174-176` ×3 | Survived | ObjectLiteral/StringLiteral | worth-killing | `invitations_not_yet`'s code and description; the invitation test asserts status 501 alone |
| `auth.ts:180` | Survived | ConditionalExpression | equivalent | *argued from the code*: `new URLSearchParams(undefined)` is empty, so both arms of `clientIdOfQuery` answer `undefined` |
| `auth.ts:202` | Survived | ConditionalExpression | must-kill | forces `membershipsOf` to return the failure's value; no test makes `workspacesHeldBy` refuse |
| `auth.ts:203-208` ×6 | NoCoverage | Conditional/Object/String/Array | must-kill | the store-failure rethrow and the `malformed`-id fail-closed, with its warn line, are never executed |
| `auth.ts:216` | Survived | ObjectLiteral | equivalent | *argued from the code*: `drizzleAdapter` is handed `identitySchema` on its own line, and `db` is used nowhere else, so drizzle's copy is unread |
| `auth.ts:219` | Survived | StringLiteral | noise | `appName` reaches no page this tier renders and no document any test reads |
| `auth.ts:222` | Survived | StringLiteral | equivalent | *nothing observable at this seam*: every mounted path still answers with `basePath: ""`, so the library normalises it to the root |
| `auth.ts:231` | Survived | ArrayDeclaration | equivalent | *nothing observable at this seam*: the cross-origin code-request test still refuses with the list emptied, so the library's own push of `baseURL` is what the fence reads |
| `auth.ts:234` ×2 | Survived | ArrayDeclaration/StringLiteral | must-kill | `disabledPaths: ["/token"]` emptied re-opens the JWT plugin's `/token`; the endpoint snapshot lists it as mounted either way |
| `auth.ts:254` | Survived | ObjectLiteral | must-kill | the email-code endpoint's stricter custom rule; the flood test asserts only that some 429 appears in eleven requests |
| `auth.ts:305` | Survived | ConditionalExpression | equivalent | *argued from the code*: returning `{...session, activeOrganizationId: undefined}` writes the value the field already holds |
| `auth.ts:316` | Survived | ConditionalExpression | must-kill | every Better Auth path would emit an audit line; the audit test filters by event name and never counts the module's lines |
| `auth.ts:321` ×8 | Survived | ConditionalExpression/EqualityOperator | must-kill | the redirect-versus-refusal discrimination; no test asserts an `outcome: "refused"` row at all |
| `auth.ts:322:25` ×2 | Survived | ConditionalExpression/BooleanLiteral | must-kill | same cluster: `refused` forced false or inverted, and every refusal logs `ok` |
| `auth.ts:322:41` | Survived | LogicalOperator | worth-killing | a plain `Error` (not an `APIError`) would log `ok`; no audited path is made to fail that way |
| `auth.ts:335` ×3 | Survived | ConditionalExpression/LogicalOperator | equivalent | *nothing observable at this seam*: no other audited path's return shape parses as `{access_token}`, so running the decode block for all of them changes nothing |
| `auth.ts:341` ×2 | Survived | ConditionalExpression/OptionalChaining | worth-killing | the malformed-claims arm of a non-refused token issue; unreachable through the library's own responses |
| `auth.ts:342` | Survived | LogicalOperator | equivalent | *nothing observable at this seam*: this issuer mints `user` and `sub` with the same value on every token |
| `auth.ts:345` ×2 | Survived | LogicalOperator | equivalent | *nothing observable at this seam*: the body's `client_id`, the `azp` claim and the `client_id` claim are the same string on every token |
| `auth.ts:347` | Survived | EqualityOperator | must-kill | swaps the issue and refresh audit rows, which carry identical asserted fields |
| `auth.ts:349` ×3 | Survived | ConditionalExpression/LogicalOperator | equivalent | *nothing observable at this seam*: no other audited path's return parses as `{user:{id}}` |
| `auth.ts:351` | Survived | ConditionalExpression | equivalent | *argued from the code*: a non-refused email-code sign-in always returns `{user:{id}}`, so the guard cannot fire |
| `auth.ts:362` | Survived | StringLiteral | must-kill | the `"refused"` outcome word, never asserted |
| `auth.ts:363` ×4 | Survived | Conditional/Equality/String | must-kill | the `"declined"` arm: no test declines consent |
| `auth.ts:364` | NoCoverage | StringLiteral | must-kill | same — the `"declined"` literal is never produced |
| `auth.ts:370` | Survived | LogicalOperator | must-kill | `token_id` always null; the `jti` ADR 0018 threads an audit by is unasserted |
| `auth.ts:377` ×2 | Survived | ObjectLiteral/BooleanLiteral | must-kill | `disableSettingJwtHeader` off would put a JWT on responses; no test asserts the header's absence |
| `auth.ts:425-427` ×4 | NoCoverage | BlockStatement/String/Array | worth-killing | `afterCreateOrganization`'s partition write, unreachable while `allowUserToCreateOrganization` is false — which is itself proven |
| `auth.ts:434-435` ×2 | NoCoverage | BlockStatement/CallExpression | must-kill | `beforeAddMember`'s role fence never runs; only `beforeUpdateMemberRole` is covered |
| `auth.ts:448` | NoCoverage | BlockStatement | must-kill | `beforeAcceptInvitation` never runs, so nothing proves a hand-written invitation row cannot become a membership |
| `auth.ts:457` | Survived | StringLiteral | must-kill | `storeOTP: "hashed"`; no test asserts the `verification` row does not hold the emailed code |
| `auth.ts:459` | Survived | ConditionalExpression | worth-killing | the guard that keeps the platform from emailing a code for an OTP type it does not offer |
| `auth.ts:462` | Survived | StringLiteral | worth-killing | the sign-in email's subject; the harness reads the code out of the body |
| `auth.ts:491-496` ×3 | Survived | ArrayDeclaration | must-kill | the CIMD registration scope and resource allow-lists (traps 1 and 2), emptied with the flow still green |
| `auth.ts:518:15` ×3 | Survived | Conditional/Logical | must-kill | consent's inner fence: an active workspace the person no longer holds would still name the token |
| `auth.ts:518:15` (short-circuit) | Survived | ConditionalExpression | equivalent | *argued from the code*: `held.includes(undefined)` is false, so forcing `stillActive !== undefined` true changes no answer |
| `auth.ts:519-522` ×6 | Survived/NoCoverage | Conditional/Block/String/Object | must-kill | the `set_workspace` refusal that stops a token being minted with no workspace claim |
| `auth.ts:534:17` ×2 | Survived | LogicalOperator/ConditionalExpression | must-kill | `shouldRedirect` would skip the picker for an active workspace the person has left (one mutant); the other is the same short-circuit as 518 |
| `auth.ts:539-546` ×6 | Survived/NoCoverage | Conditional/Block/Arrow/String/Array/Boolean | must-kill | the platform's own `UPDATE session SET active_workspace_id` for a session made before the membership |
| `auth.ts:555` | Survived | OptionalChaining | equivalent | *nothing observable at this seam*: no token is minted without a person |
| `auth.ts:560` | Survived | StringLiteral | noise | a 60-minute CIMD revalidation interval no test can wait out |
| `auth.ts:569` ×2 | Survived/NoCoverage | OptionalChaining/StringLiteral | must-kill | a malformed client-id URL throws instead of being refused by the closed client list |
| `auth.ts:584` ×8 | Survived | Conditional/Logical/String | equivalent | *argued from the code*: both callers immediately do `X !== undefined && held.includes(X)`, and `held` holds no `null`, `undefined` or `""` |

## `apps/api/src/mcp/entries/index.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `index.ts:37` | Survived | ConditionalExpression | equivalent | *argued from the code*: the four acts declare `never` for their error, so `valueOrThrow`'s throwing arm cannot be reached (the docblock says so) |
| `index.ts:41-46` ×11 | Survived | Object/String/Array | must-kill | the `trust` output schema — every tier, status and rider word — is never produced, because no test opens a real concept through the surface |
| `index.ts:49` | Survived | ObjectLiteral | must-kill | the `passage` schema, likewise never produced |
| `index.ts:58`, `60` ×2 | Survived | StringLiteral | must-kill | `find`'s title and description — the words a host's model reads to decide to call it — are asserted nowhere |
| `index.ts:61` | Survived | ArrayDeclaration | must-kill | `find`'s `scopes: ["knowledge:read"]`; every token the suite mints holds it |
| `index.ts:63`, `64:64` ×2 | Survived | StringLiteral | worth-killing | the two parameter descriptions on `find` |
| `index.ts:64:12` ×2 | Survived | MethodExpression | must-kill | `limit`'s 1..20 bound; no test passes `limit` at all |
| `index.ts:66` | Survived | ObjectLiteral | worth-killing | `find`'s output envelope; the test asserts the value, never the advertised schema |
| `index.ts:69` | Survived | ObjectLiteral | must-kill | the hit item's shape, never produced (`find` always answers `hits: []`) |
| `index.ts:81-83` ×3 | Survived | BooleanLiteral | worth-killing | `destructive`, `idempotent` and `openWorld` hints; the annotations test asserts `readOnlyHint` alone |
| `index.ts:91`, `93` ×2 | Survived | StringLiteral | must-kill | `ask`'s title and description |
| `index.ts:94` | Survived | ArrayDeclaration | must-kill | `ask`'s scope requirement |
| `index.ts:96` | Survived | StringLiteral | worth-killing | the `question` parameter's description |
| `index.ts:98-113` ×9 | Survived | Object/String | must-kill | `ask`'s whole answer contract — `ok`/`warn` verdicts, citations, conflicts, coverage, and the map's `as_of` and `unavailable_since` (ADR 0016) — never produced; every test answer is `refuse` on a `live` map |
| `index.ts:118-120` ×3 | Survived | BooleanLiteral | worth-killing | `ask`'s three unasserted annotation hints |
| `index.ts:128`, `130` ×2 | Survived | StringLiteral | must-kill | `open`'s title and description |
| `index.ts:131` | Survived | ArrayDeclaration | must-kill | `open`'s scope requirement |
| `index.ts:134`, `139` ×2 | Survived | StringLiteral | worth-killing | the `iri` and `locator` parameter descriptions |
| `index.ts:135` | Survived | MethodExpression | must-kill | `locator`'s `min(1)` narrowed to `max(1)`; no call to `open` ever carries a locator |
| `index.ts:141-142` ×5 | Survived | Conditional/Object/String | must-kill | the exactly-one-of-iri-or-locator refinement and its message; nothing calls `open` with both or neither |
| `index.ts:149`, `156`, `158` ×3 | Survived | ObjectLiteral | must-kill | the found-concept output shape, its relations and its evidence — never produced |
| `index.ts:165-166` ×5 | Survived | Conditional/Object/String | must-kill | the concept-xor-passage refinement on a found result, and its message |
| `index.ts:176-178` ×3 | Survived | BooleanLiteral | worth-killing | `open`'s three unasserted annotation hints |
| `index.ts:185` ×4 | Survived/NoCoverage | Conditional/Object/Logical/String | must-kill | `run`'s locator arm — `open` by locator is never called through the surface |
| `index.ts:194:10`, `195` ×2 | Survived | MethodExpression/StringLiteral | must-kill | `feedbackInput`'s "helpful" arm; no test sends a helpful verdict |
| `index.ts:194:37`, `198`, `213`, `214:53`, `218` ×5 | Survived | StringLiteral | worth-killing | parameter descriptions on `give_feedback`'s two schemas |
| `index.ts:200`, `216` ×6 | Survived | StringLiteral | must-kill | the reason words `out-of-date`, `incomplete` and `should-not-have-shown`, in both schemas; only `wrong` is ever sent |
| `index.ts:201`, `219` ×4 | Survived | MethodExpression/StringLiteral | worth-killing | `detail`'s 2,000-character cap and its descriptions; no test sends a detail |
| `index.ts:207`, `209` ×2 | Survived | StringLiteral | must-kill | `give_feedback`'s title and description |
| `index.ts:214:24` | Survived | StringLiteral | must-kill | the `"helpful"` member of the outer verdict enum |
| `index.ts:223-225` ×8 | Survived | Conditional/Equality/String/Object/Array | must-kill | the flag-needs-a-reason refinement, its message and its `path`; no test posts a flag without a reason |
| `index.ts:227` | Survived | ObjectLiteral | worth-killing | `give_feedback`'s advertised output schema |
| `index.ts:233-235` ×3 | Survived | BooleanLiteral | worth-killing | the write entry's three unasserted annotation hints |
| `index.ts:239`, `241` ×2 | Survived/NoCoverage | ConditionalExpression/StringLiteral | equivalent | *argued from the code*: the door's `.refine` at 223 refuses every input that would fail `feedbackInput.safeParse`, so this second guard cannot fire |

## `apps/api/src/auth/routes.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `routes.ts:53` | Survived | Regex | equivalent | *argued from the code*: `URL.search` is either empty or begins with `?`, and the replace is not global, so dropping the anchor removes the same character |
| `routes.ts:56` ×2 | Survived/NoCoverage | OptionalChaining/StringLiteral | must-kill | the consent page's "an unknown address" answer to a malformed carry, and the throw that replaces it without the optional chain |
| `routes.ts:75` | Survived | ConditionalExpression | worth-killing | `nextLocation`'s `Location`-header arm; Better Auth answers this flow with JSON, so the arm is dead in tests |
| `routes.ts:85-86` ×2 | Survived/NoCoverage | BlockStatement/StringLiteral | worth-killing | `forwardCookies` never forwards anything: the loop body is `NoCoverage`, so a cookie the in-process call set would be dropped silently |
| `routes.ts:93` | Survived | ConditionalExpression | equivalent | *argued from the code*: a `cookie: null` header reads to `getSession` as no session, the same as no header |
| `routes.ts:94-96` ×6 | Survived | Array/Block/Conditional/Equality/Call | must-kill | the client IP and user agent forwarded into the in-process auth call; without them Better Auth's own limiter keys every caller as one (grilling Q8) |
| `routes.ts:101` | Survived | LogicalOperator | must-kill | replaces a real cross-site `Origin` with `publicUrl` before Better Auth's CSRF check reads it; masked by `navigationOnly` |
| `routes.ts:102` | Survived | StringLiteral | worth-killing | the `accept: application/json` the in-process call asks for |
| `routes.ts:117` ×5 | Survived | Conditional/Equality/String/Block | must-kill | `sameOriginOnly`'s method guard; forcing it either way leaves every test green |
| `routes.ts:122` | Survived | StringLiteral | must-kill | the `sec-fetch-site` header name; the fence's second reading is never load-bearing |
| `routes.ts:124`, `125:8` ×5 | Survived | Conditional/Logical/Equality | must-kill | the same-origin predicate itself, forced true or narrowed, with no test noticing |
| `routes.ts:125:33` ×12 | NoCoverage | Conditional/Logical/Equality/String | must-kill | the origin-less arm — the one that admits a browser navigation — is never evaluated |
| `routes.ts:126` ×2 | Survived | ConditionalExpression/BlockStatement | must-kill | the 403 the fence returns; it never returns it |
| `routes.ts:128`, `154` ×4 | Survived | StringLiteral | worth-killing | the two refusal pages' titles and sentences; the tests assert 403 alone |
| `routes.ts:162` ×2 | Survived | MethodExpression | must-kill | the per-email throttle's key drops case folding or trimming, so a sender who varies either gets a fresh bucket |
| `routes.ts:164` | Survived | MethodExpression | worth-killing | the code request's `trim().min(1)`; an empty address would be hashed into a counter of its own |
| `routes.ts:182` ×4 | Survived/NoCoverage | Conditional/Logical/Block | must-kill | the pass-through for a code request with no readable address; forced false it would read `asked.data` off `undefined` |
| `routes.ts:188` | Survived | StringLiteral | equivalent | *nothing observable at this seam*: the `"email"` counter scope is only ever compared with itself, and its key space (sha256 hex) cannot collide with the `ip` scope's |
| `routes.ts:196` | Survived | StringLiteral | worth-killing | the per-email 429's sentence; the throttle test asserts the status alone |
| `routes.ts:246-247` ×3 | Survived | Array/String | worth-killing | the protected-resource document's `bearer_methods_supported` and `resource_documentation`; only `resource` is asserted |
| `routes.ts:249-251` ×3 | Survived | StringLiteral | must-kill | the per-IP limits in front of the discovery documents, `/oauth2/*` and `/jwks`, unmounted with every test green |
| `routes.ts:264` | Survived | StringLiteral | must-kill | the same-origin fence's own mount path, likewise |
| `routes.ts:277-278` ×5 | Survived | String/Method/Conditional | worth-killing | the consent page's `client_id` and scope-list parsing; no test renders it with a missing or empty scope query |
| `routes.ts:281-283` ×4 | Survived | Conditional/Block/String | must-kill | the "Sign in first" 401 on the consent page; the only test that reaches it asserts the status is *not* 429 |
| `routes.ts:292`, `295` ×4 | Survived/NoCoverage | String/Logical/OptionalChaining | must-kill | the workspace name a person is told they are granting access to is never asserted, so the query can be blanked |
| `routes.ts:306`, `308`, `310`, `311` ×4 | Survived/NoCoverage | OptionalChaining/String | worth-killing | the client-name, redirect-uri and workspace fallbacks the page renders when a lookup fails |
| `routes.ts:322` | Survived | ConditionalExpression | must-kill | `accept` forced true: a Cancel that granted access would pass every test |
| `routes.ts:326` | Survived | ConditionalExpression | worth-killing | the revocation re-check runs only on accept; nothing declines, so the guard is unobserved |
| `routes.ts:332` ×2 | Survived | ArrowFunction/BooleanLiteral | equivalent | *argued from the code*: only `resolved.ok` is read; the callback's value is discarded |
| `routes.ts:333` ×3 | Survived | Logical/Conditional | equivalent | *argued from the code*: `resolved === undefined` is true exactly when `claims === undefined`, which the first term already caught |
| `routes.ts:335` ×2 | Survived | StringLiteral | worth-killing | the "Sign in again" page's words on a revoked session |
| `routes.ts:346` ×3 | Survived | Conditional/Call | worth-killing | the cookie forwarding after a decided consent, unobserved for the same reason as 85 |
| `routes.ts:348`, `350-358` ×7 | Survived/NoCoverage | Conditional/Object/String | must-kill | the consent-could-not-be-completed path: the `auth.consent_failed` warn line and the 400 page, never produced |
| `routes.ts:376` ×2 | Survived/NoCoverage | ConditionalExpression/ObjectLiteral | must-kill | `/me`'s refusal for a resolver word; revocation ends the session one line earlier, so the two refusals are conflated |

## `apps/api/src/ops/index.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `ops/index.ts:74` ×2 | Survived | Regex | must-kill | `parseSince`'s dump-stamp anchors; the discriminating input is `pg-20260903T020500Z`, the docblock's own example, which the anchored pattern refuses |
| `ops/index.ts:88-89` ×2 | Survived/NoCoverage | EqualityOperator/StringLiteral | equivalent | *argued from the code*: the extra iteration reads `undefined`, defaults to `""`, and `""` does not start with `--`; the same default makes the `?? ""` unreachable |
| `ops/index.ts:90` ×2 | Survived | Conditional/String | worth-killing | a bare positional argument would be read as a flag; every ops test passes `--name value` pairs |
| `ops/index.ts:104` | Survived | ConditionalExpression | worth-killing | `flagValue` returning a bare `--flag`'s `true` as if it were a string; no test passes a value-less flag where a value is wanted |
| `ops/index.ts:143`, `343`, `396`, `441`, `462` ×5 | Survived | String/Equality | noise | a usage-text separator, three `refused()` command labels and a poll-deadline boundary |
| `ops/index.ts:157` | Survived | ConditionalExpression | equivalent | *argued from the code*: `parseSince(undefined)` answers `undefined` too, by way of `new Date("undefined")` |
| `ops/index.ts:159`, `182-183`, `186`, `190` ×6 | Survived/NoCoverage | Conditional/Block/String | worth-killing | the `--since` and `--url` usage refusals, the trailing-slash normalisation and the no-app-hostname request shape |
| `ops/index.ts:200-201` ×2 | Survived | String/Assignment | worth-killing + equivalent | the `FAIL` marker is unasserted; `failed += 1` mutated to `-=` is *argued from the code* equivalent, since only `failed === 0` is read |
| `ops/index.ts:202-204` ×3 | NoCoverage | Block/String/Assignment | must-kill | the smoke check's catch arm — a surface that throws rather than answers, which is the drill's "the platform is not there" case |
| `ops/index.ts:209`, `214`, `229`, `235` ×4 | Survived | StringLiteral | worth-killing | the four check names in the drill's report |
| `ops/index.ts:211`, `217`, `220-224`, `232`, `238` ×22 | Survived/NoCoverage | Conditional/Logical/Boolean/String | must-kill | every conjunct of every smoke predicate can be forced true and the drill still says ok; the only smoke test runs against a healthy app |
| `ops/index.ts:241` | Survived | ConditionalExpression | worth-killing | the `--find`/`--guide`/`--ask` note flags are never passed |
| `ops/index.ts:251-256` ×7 | Survived/NoCoverage | Method/Conditional/Equality/Block/String | worth-killing | `dump-grep`'s token trimming, empty-token filter and no-tokens usage refusal |
| `ops/index.ts:265` ×2 | Survived | Conditional/Equality | must-kill | the redaction of a long token in the report a regulator reads (ADR 0020), proven in one direction only |
| `ops/index.ts:278-279`, `286` ×7 | Survived | Conditional/Block/Method/Arrow/Boolean/String | worth-killing | the missing-`--workspace` usage arm and the not-built message's list of absent tables |
| `ops/index.ts:308`, `323`, `427`, `432`, `467` ×7 | Survived | Conditional/String | worth-killing | `reasonOf`'s Error arm and four refusal or usage sentences the tests assert only by exit code |
| `ops/index.ts:370`, `394`, `397` ×3 | Survived | Arrow/Arithmetic | equivalent | *argued from the code*: `await undefined` resolves at once and `Math.min` caps the sleep, so the loop's own deadline still governs when it ends |
| `ops/index.ts:400`, `403`, `407-408` ×5 | Survived/NoCoverage | Conditional/String | worth-killing | `waitForJob`'s job-read-failure arm and the three ending phrases' nouns |
| `ops/index.ts:509-511` ×3 | Survived/NoCoverage | Conditional/Block/String | must-kill | `reconcile-watermark`'s stop-and-report refusal — ADR 0012's "reported, never skipped" |
| `ops/index.ts:527` ×5 | Survived | Conditional/Logical/String | worth-killing | the `--help` and `help` words; only the no-command and unknown-command cases are driven |
| `ops/index.ts:534-535` ×2 | Survived | ConditionalExpression/StringLiteral | must-kill | routing every unknown command to `sliceCommand` answers the same exit code, so "answers usage, not a guess" is asserted by its code alone |

## `apps/api/src/mcp/surface.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `surface.ts:73`, `161`, `189` ×3 | Survived | StringLiteral | worth-killing | the three refusal wordings and the "bearer refused" log message; the tests assert the challenge, not the words |
| `surface.ts:78`, `199-205` ×5 | Survived | Object/String | worth-killing | the `mcp` logger's module tag and the whole `mcp.request` line — client id, method and name |
| `surface.ts:83-85` ×5 | Survived/NoCoverage | Conditional/OptionalChaining/Array | equivalent | *argued from the code*: the SDK never builds a server without `authInfo` on this mount, and line 180 refuses a bearer-less one first |
| `surface.ts:88` ×2 | Survived | Object/String | worth-killing | the server name and version a host records for the connection |
| `surface.ts:90` | Survived | ObjectLiteral | must-kill | the `tools` capability; `server/discover`'s test asserts the capability key exists, not that `tools` is in it |
| `surface.ts:95` | Survived | ObjectLiteral | worth-killing | `server/discover`'s cache hint; only `tools/list`'s is asserted |
| `surface.ts:113-114` ×3 | Survived/NoCoverage | Conditional/Block/String | equivalent | *argued from the code*: a bearer-less `authInfo` is refused at line 180 before any tool is invoked |
| `surface.ts:119-124` ×6 | Survived/NoCoverage | Conditional/Block/Object/String | must-kill | the per-call principal refusal, its `mcp.call_refused` line and its message; every refusal the suite provokes happens at the request gate instead |
| `surface.ts:136-139` ×6 | Survived | Object/String/Arrow | worth-killing | the handler's legacy mode, not distinguished from the SDK's default, and the `onerror` log, never triggered |
| `surface.ts:143` | Survived | BlockStatement | must-kill | the 401 flood limit in front of `/mcp` before any signature work |
| `surface.ts:146` | Survived | StringLiteral | equivalent | *nothing observable at this seam*: the `ip` counter scope is only compared with itself |
| `surface.ts:156` ×7 | Survived | Conditional/Logical/Regex/Block | equivalent | *nothing observable at this seam*: relaxing the pre-flight bearer pattern only decides whether the verifier is asked, and both paths answer the same challenge after the same flood check |
| `surface.ts:171` | Survived | ArrayDeclaration | must-kill | `requiredScopes: [MCP_REQUIRED_SCOPE]`; every token the suite mints carries `knowledge:read` |
| `surface.ts:180` | Survived | ConditionalExpression | must-kill | a verified bearer whose `extra` carries no workspace or user is refused here, and nothing at this seam proves it |
| `surface.ts:213-215` ×5 | Survived/NoCoverage | Arrow/Object/Array/Boolean | must-kill | `refusedResult`'s content and `isError: true`; both call sites are unreached |

## `apps/api/src/reconciler.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `reconciler.ts:70-71` ×2 | Survived | AssignmentOperator | must-kill | the replayed and already-landed counts, never asserted |
| `reconciler.ts:72-73` ×3 | Survived/NoCoverage | Conditional/Block/Object | must-kill | the stopped list — ADR 0012's commit the index refused — never populated |
| `reconciler.ts:102-103` ×4 | Survived/NoCoverage | Conditional/Block/Object/String | must-kill | a tick that threw is invisible |
| `reconciler.ts:106-109` ×5 | Survived/NoCoverage | Conditional/Block/Object/String | must-kill | a tick that could not list the workspaces is invisible |
| `reconciler.ts:117` ×5 | Survived | Conditional/Equality | must-kill | every relaxation of the warn condition still warns, because every covered tick has a refused workspace |
| `reconciler.ts:119-122` ×8 | NoCoverage | Conditional/Equality/Block/String | must-kill | the info line for a tick that replayed something and the debug line for a quiet tick are never produced |
| `reconciler.ts:132` | Survived | BlockStatement | must-kill | the `finally` that clears `inFlight`; without it every later tick is skipped for the life of the process |
| `reconciler.ts:136` | Survived | CallExpression | worth-killing | `timer.unref()`, which is what lets the process exit |
| `reconciler.ts:140` | Survived | CallExpression | must-kill | `clearInterval` in `stop()`; "no tick starts after this" is unproven |

## `apps/api/src/ingress/hostnames.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `hostnames.ts:92` | Survived | ArrayDeclaration | worth-killing | the apex's empty path set is only proven by requests that would 404 anyway |
| `hostnames.ts:106` | Survived | StringLiteral | must-kill | `HOSTNAME_REFUSAL` blanked survives because the test asserts `toContain(HOSTNAME_REFUSAL)` — the same symbol on both sides (`[TEST9]`) |
| `hostnames.ts:109` ×2 | Survived | Regex | must-kill | the DNS-label pattern's anchors; a value with a scheme, port or path would pass |
| `hostnames.ts:124`, `163`, `168` ×4 | Survived/NoCoverage | Regex/String | equivalent | *argued from the code*: an unanchored bracket strip removes the same characters from a well-formed literal, and `split` always returns at least one element |
| `hostnames.ts:166-167` ×4 | Survived | Method/Arithmetic/String | worth-killing | `hostIsAsWritten`'s IPv6-literal branch; no test gives an IPv6 `PUBLIC_URL` |
| `hostnames.ts:182` ×2 | Survived | Conditional/Equality | equivalent | *argued from the code*: an empty hostname has one empty label, which `HOSTNAME_LABEL` already refuses |
| `hostnames.ts:183-184`, `192` ×4 | Survived | Conditional/Equality/String | worth-killing | the 63-character label bound and the two refine messages an operator reads on a bad deploy |
| `hostnames.ts:202` | Survived | ConditionalExpression | worth-killing | a request to exactly `/agent/v1` — a prefix pattern's own prefix — is never made |
| `hostnames.ts:209`, `223`, `236` ×4 | Survived | Conditional/Array/String | equivalent | *argued from the code*: the catch-all makes `find` never answer undefined, the apex carries nothing whether its role resolves or not, and an unknown role is in no host list |
| `hostnames.ts:225`, `243`, `247` ×4 | Survived | Object/String | worth-killing | the ingress refusal's log line and the `not_found` error word |

## `apps/api/src/ingress/limits.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `limits.ts:27`, `35-36` ×6 | Survived/NoCoverage | Regex/String | equivalent | *argued from the code*: an unanchored bracket strip removes the same characters, `split` always returns an element, and a tail default lands after eight groups, past the four the key reads |
| `limits.ts:31` ×2 | Survived | Regex | must-kill | an IPv6 address that merely contains a dotted quad would be keyed as that IPv4 client — a rate-limit key two unrelated clients can share |
| `limits.ts:37` ×3 | Survived/NoCoverage | Conditional/String/Array | worth-killing | an address that begins with `::` is never keyed |
| `limits.ts:38`, `41` ×8 | Survived | Conditional/Equality/String/Array/Arithmetic | equivalent | *argued from the code*: only `expanded.slice(0, 4)` becomes the key, and every valid `::` address leaves at least one zero group in the first four |
| `limits.ts:50` ×2 | Survived | Conditional/String | worth-killing | a present-but-empty client-IP header falls into its own bucket rather than the named `unknown` one |
| `limits.ts:55`, `75` ×2 | Survived | StringLiteral | worth-killing | the 429's `too_many_requests` word and its sentence |
| `limits.ts:67` | Survived | StringLiteral | equivalent | *nothing observable at this seam*: the counter scope is only compared with itself and its key space cannot collide with the email scope's |

## `apps/api/src/auth/verify.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `verify.ts:29` | Survived | StringLiteral | must-kill | the default for a missing `scope` claim decides what a scope-less token reaches, and no test mints one |
| `verify.ts:76-77` ×2 | Survived | Boolean/Conditional | must-kill | the key-set cache; a verifier that re-read JWKS on every bearer passes the whole suite |
| `verify.ts:86` | Survived | ConditionalExpression | must-kill | the retry narrowed to an unknown `kid` becomes a retry on every verification failure |
| `verify.ts:97-100` ×4 | Survived/NoCoverage | Block/Conditional/String | must-kill | the not-a-JWT catch and the `alg`-less refusal; no test presents either |
| `verify.ts:105-106` ×2 | Survived/NoCoverage | Block/String | worth-killing | the signature-failure message and its "did not verify" fallback |
| `verify.ts:109` ×2 | Survived/NoCoverage | Conditional/String | must-kill | a token whose claims do not parse is never presented |
| `verify.ts:111`, `123` ×4 | Survived | Logical/String | equivalent | *nothing observable at this seam*: `user` and `sub`, and `azp` and `client_id`, carry the same value on every token this issuer mints |
| `verify.ts:112` ×2 | Survived | ConditionalExpression | must-kill | a token with no `workspace` claim at all, and one with no `user` or `sub`, are never presented; only the `null` case is |
| `verify.ts:113` | Survived | StringLiteral | worth-killing | the "names no workspace" refusal's words |
| `verify.ts:119` | Survived | ArithmeticOperator | must-kill | the issued-at instant revocation is judged against; a mis-scaled instant still refuses in the one revoked test |
| `verify.ts:124` ×3 | Survived | Method/Conditional/String | worth-killing | the scope list's empty-string filter |
| `verify.ts:161` | Survived | ConditionalExpression | equivalent | *nothing observable at this seam*: the organisation plugin always returns the field, `null` when unset, and the `null` arm is killed |

## `apps/api/src/config.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `config.ts:53` ×2 | Survived | Regex | worth-killing | the https-only anchors; both variants still refuse `http`, and only `httpsx`-shaped schemes discriminate |
| `config.ts:60-61` ×2 | Survived | ConditionalExpression | must-kill | credentials in `PUBLIC_URL` would be carried into the issuer, the audience, the PRM document and the trusted origin |
| `config.ts:63`, `70`, `76`, `121` ×4 | Survived | StringLiteral | worth-killing | the four refine messages an operator reads when a deploy stops |
| `config.ts:112` ×3 | Survived | Regex | must-kill | `SMTP_URL`'s scheme check, including a mutant that narrows it to `smtps` alone |
| `config.ts:140-141` ×2 | Survived | Arrow/String | must-kill | `invalid()`'s message; the tests assert `ok === false` and never the reason, so "says why" is unproven |
| `config.ts:181`, `185` ×2 | NoCoverage | BlockStatement | worth-killing | the two `require*Bootstrap` wrappers `[APP2]` names |
| `config.ts:189-192` ×8 | NoCoverage | Block/Boolean/Conditional/Object/String/Call | must-kill | `orExit`'s error log and `process.exit(1)` — the whole of the tier's boot refusal |

## `apps/api/src/ingress/spa.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `spa.ts:43` | Survived | Regex | worth-killing | `asksForAFile`'s end anchor; a screen address with a dot mid-path would be read as a file |
| `spa.ts:46` ×4 | Survived | Conditional/Logical/String | must-kill | forcing `asksForADocument` true serves the shell's HTML to a JSON client asking for an unknown path |
| `spa.ts:48` ×4 | Survived/NoCoverage | Conditional/Equality/String | must-kill | the read-only guard, whose `HEAD` arm is never covered; forced true, a POST is answered with the shell |
| `spa.ts:68` ×3 | Survived | Conditional/OptionalChaining/String | worth-killing | the content-type test in `documentHeaders`; forced true it sets `no-cache` on every hashed asset |
| `spa.ts:69` | Survived | StringLiteral | must-kill | the shell's `cache-control: no-cache` — the revalidation the docblock says stops a browser serving yesterday's build |
| `spa.ts:82` ×2 | Survived | Conditional/Block | worth-killing | the no-build passthrough, not distinguished from a build that serves nothing |
| `spa.ts:92` | Survived | ConditionalExpression | equivalent | *nothing observable at this seam*: `routeByHostname` has already refused every non-`app.` request before this mount |
| `spa.ts:95`, `101`, `103` ×5 | Survived | Conditional/Logical | must-kill | the same two guards on the asset and shell handlers, and the shell's document check |
| `spa.ts:105` | Survived | ConditionalExpression | worth-killing | `documentHeaders(undefined)` when `index.html` is absent |

## `apps/api/src/ops/http-fetch.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `http-fetch.ts:16`, `22` ×3 | Survived | Conditional/String | worth-killing | the https passthrough and the default port 80; every smoke test gives an explicit `http` URL with a port |
| `http-fetch.ts:24` ×2 | Survived | Logical/String | equivalent | *nothing observable at this seam*: `/mcp` answers a GET the same challenge it answers a POST, so the method never reaches an assertion |
| `http-fetch.ts:34-35` ×4 | Survived/NoCoverage | Conditional/String | worth-killing | the repeated-header branch; no response in the smoke path carries one |
| `http-fetch.ts:39` ×7 | Survived | Conditional/Logical | worth-killing | the null-body statuses; a 204 would throw rather than answer |
| `http-fetch.ts:42` | Survived | StringLiteral | worth-killing | the response-error listener |
| `http-fetch.ts:45` | Survived | StringLiteral | must-kill | the request-error listener — the drill's "the platform is not there" case, which "fails when the surface does not answer" does not reach |

## `apps/api/src/trpc/router.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `router.ts:21-22` ×4 | Survived/NoCoverage | Arrow/Object/String | must-kill | `storeFailed` is never built: no store failure is provoked through tRPC |
| `router.ts:25`, `32-40` ×12 | Survived/NoCoverage | Object/Block/Boolean/Conditional/String | must-kill | the whole `session.membership` procedure and its two refusals; no test calls it |
| `router.ts:49` ×2 | Survived/NoCoverage | Conditional/String | must-kill | `routes.list`'s store-failure arm |

## `apps/api/src/ops.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `ops.ts:17-40` ×12 | NoCoverage | String/Object/Block/Array/Call/Method/Arrow | worth-killing | the `pnpm ops` process wrapper — bootstrap, pool, stdin, the `say` writer, the argv slice and the exit code; the suite drives `runOps` directly, which is the right seam |

## `apps/api/src/server.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `server.ts:85-86` ×2 | Survived/NoCoverage | Logical/Object | worth-killing | the production CIMD fetcher and its timeout and body cap are only constructed in the branch no test takes; reported `Survived` where the injected fetch looks load-bearing, so worth a probe before effort |
| `server.ts:96` | Survived | StringLiteral | worth-killing | the `"starting"` identity state, never observed: the init settles before any request |
| `server.ts:104-105` ×2 | Survived | Object/String | must-kill | the "authorization server failed to initialise" log — the only signal that the app is up while OAuth is dead |
| `server.ts:114` | Survived | StringLiteral | must-kill | `/health`'s `select 1` blanked still passes, because Postgres accepts an empty statement |
| `server.ts:131`, `160` ×2 | Survived | StringLiteral | equivalent | *nothing observable at this seam*: Hono reads a `""` base path as the root, and both mounts' routes answer throughout the suite |
| `server.ts:152` ×2 | Survived | Logical/String | worth-killing | the MCP server version handed to a host |
| `server.ts:180` | Survived | ConditionalExpression | must-kill | the shell would shadow an authorization-server path, which the comment beside the line says it must not |

## `apps/api/src/auth/pages.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `pages.ts:13-16` ×4 | Survived | StringLiteral | must-kill | `escape`'s four replacements; no test renders a client name, workspace name or message containing `&`, `<`, `>` or `"` |
| `pages.ts:43`, `61-62` ×3 | Survived | String/Arrow | worth-killing | the consent page's `<title>` and the whole of `refusedPage`'s HTML, asserted nowhere |
| `pages.ts:48-50` ×3 | Survived/NoCoverage | StringLiteral | worth-killing | the absent-arm of each scope line; a read-only connection's consent page is never asserted |

## `apps/api/src/auth/roles.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `roles.ts:24-25` ×6 | Survived | Array/String | must-kill | Admin's `organization` and `member` statements emptied leave "lets an Admin change a Viewer to an Editor" green, so that test's 200 is not produced by these lines |
| `roles.ts:26` | Survived | StringLiteral | worth-killing | the `cancel` invitation permission; no test cancels one |

## `apps/api/src/auth/constants.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `constants.ts:17` | Survived | StringLiteral | worth-killing | `UNKNOWN_CLIENT_IP`; no test calls `clientIpOf` with no header and asserts the bucket's name |
| `constants.ts:27` ×3 | Survived | ArithmeticOperator | must-kill | ninety days; `oauth-flow.test.ts:570` compares the observed lifetime against this same constant (`[TEST9]`) |
| `constants.ts:39` | Survived | ArithmeticOperator | must-kill | five minutes; the number is here and the sentence is in `auth.ts:463`, and nothing checks they agree |
| `constants.ts:53` | Survived | StringLiteral | must-kill | `SEND_EMAIL_CODE_PATH` is read by both the mount and the test that drives it, so the path Better Auth serves is never written down |
| `constants.ts:90` | Survived | ArithmeticOperator | worth-killing | the CIMD response cap, wired only in the branch no test takes |

## `apps/api/src/trpc/base.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `base.ts:62-65` ×5 | Survived/NoCoverage | Conditional/Block/Object/String | must-kill | a session store that could not be reached would be reported to a person as "not signed in", which the comment beside the line forbids |
| `base.ts:82` | Survived | ConditionalExpression | must-kill | a failed procedure would commit the transaction it failed inside (`[TEST8]`) |

## `apps/api/src/auth/endpoints.ts`

| file:line | status | mutator | verdict | why (one clause) |
| --- | --- | --- | --- | --- |
| `endpoints.ts:43` | Survived | MethodExpression | worth-killing | `mountedPaths`'s sort; the snapshot test asserts the *committed file* is sorted and compares membership, never the built list's order |

---

# Probes

Run through `pnpm mutant-probe`, which pins the mutation to the text on the line it names,
restores in a `finally`, and prints the `src` diff-stat against HEAD. Controls both ways
before any verdict was written down.

| probe | file:line | from → to | suite | expected | result |
| --- | --- | --- | --- | --- | --- |
| **positive control** | `auth/auth.ts:158` | `"invalid_role"` → `"probe_control"` | `oauth-flow` | killed (report says Killed) | **killed** — 1 of 36 failed, at `oauth-flow.test.ts:755` |
| **negative control** | `auth/auth.ts:234` | `["/token"]` → `[]` | whole api suite | survived (report says Survived) | **survived** — 0 of 382 failed |
| `roles.ts` statements | `auth/roles.ts:25` | `["create", "update", "delete"]` → `[]` | whole api suite | — | **survived** — 0 of 382 failed |
| email-code custom rules | `auth/auth.ts:254` | `{ ...BETTER_AUTH_RATE_LIMIT.customRules }` → `{}` | whole api suite | — | *killed by an unrelated timeout — see below* |
| email-code custom rules, again | `auth/auth.ts:254` | same | `oauth-flow` | — | **survived** — 0 of 36 failed |

The harness discriminates: one mutant the report calls Killed comes back `killed`, another
it calls Survived comes back `survived`, and the tree is clean against HEAD after each.

Both subjects were chosen because **an existing assertion looked as though it should kill
the row**, which is the retro's lesson in its other direction: a must-kill called on a row
that is not one is the same failure as an equivalent called on a row that is.

- **`roles.ts:25` is confirmed.** Emptying Admin's `member: ["create", "update", "delete"]`
  leaves all 382 tests green, so "lets an Admin change a Viewer to an Editor" does not get
  its 200 from that line. Platform finding 14 and shortlist item 8 stand as written; what the
  ticket has to settle is whether the plugin consults these statements for
  `update-member-role` at all, and if it does not, say so beside the code.
- **`auth.ts:254` is confirmed, and the first probe of it is a hazard worth recording.**
  Over the whole suite the probe answered `killed` — but the one failure was
  `tests/provision-worktree.test.ts` timing out at 60,000 ms, a git-worktree gate with no
  coupling to `auth.ts`, and the same test finished in 34 s during the negative control
  minutes earlier. A whole-suite probe on this repository runs the repo-tree gates
  (`image.test.ts`, `provision-worktree.test.ts`, `provision-skills.test.ts`) whose durations
  sit near their timeouts under load, so **a timeout in an unrelated file reads exactly like a
  kill**. Re-run against `oauth-flow`, which holds all three limits tests, the mutant
  survives: the email-code endpoint's stricter custom rule is not what the flood test's 429
  proves. Add "a whole-suite probe's kill is only a kill when the failing test is one that
  touches the mutated file" to `docs/agents/mutation-triage.md`'s controls section.

---

# Proposed tickets

Five tracer bullets, cut by module. Each title states the behaviour once it is true.
Between them they own all 360 must-kill rows and the 220 worth-killing rows in the same
files; each list names the clusters, and a row not named rides with the module it sits in.
The 7 noise and 95 equivalent rows are not ticketed — the equivalent ones under *dead code
and guards that cannot fire* are a deletion or a comment, not a test, and belong in
whichever ticket next touches the file.

## T-A: The consent flow's own fences refuse — the cross-site form, the origin header, the workspace check and the decline all get runtime tests

Owns `auth/routes.ts:101`, `117`, `122`, `124-126`, `264`, `281-283`, `292`, `295`, `322`,
`348`, `350-358`, `376`, `56`; `auth/auth.ts:518`, `519-522`, `534`, `539-546`; and
`auth/pages.ts:13-16`. 61 must-kill rows. The first test is the one the suite is missing
by construction: a cross-origin POST to `/consent` **carrying `sec-fetch-dest: document`**,
so `sameOriginOnly` is the fence that answers. Then: a decline; a consent driven at Better
Auth's own `/oauth2/consent` for a person whose active workspace was removed; a consent
whose in-process call fails; and a consent page rendered for a client whose `client_name`
carries `&`, `<`, `>` and `"`.

## T-B: The bearer's whole life is proved at the seam — the scope gate, the workspace claim, the issued-at instant, the JWKS cache and the flood limit

Owns `auth/verify.ts:29`, `76-77`, `86`, `97-100`, `109`, `112`, `119`; `mcp/surface.ts:119-124`,
`143`, `171`, `180`, `213-215`, `90`; `auth/auth.ts:234`, `377`, `457`, `491-496`, `569`;
`auth/roles.ts:24-25`. 45 must-kill rows. A token minted with `offline_access` alone; a
non-JWT, an `alg`-less header and a claims-less token; a revocation followed by a fresh
sign-in that must be *accepted*; two verifications counted against the JWKS reads; a
bearer-less `/mcp` flood; a request to `/token`; and a CIMD registration asking for a scope
outside the allow-list.

## T-C: Every record the platform writes is read back — the audit outcome, the reconciler's line, the drill's smoke report and the tRPC seam's two refusals

Owns `auth/auth.ts:22-24`, `202-208`, `316`, `321-322`, `347`, `362-364`, `370`, `434-435`,
`448`; all 28 of `reconciler.ts`; `trpc/base.ts:62-65`, `82`; `trpc/router.ts:21-49`;
`server.ts:104-105`; and the operator-facing half of `ops/index.ts` — `202-204`,
`211-238`, `265`, `509-511`, `534-535` — with `ops/http-fetch.ts:45`. Roughly 115 must-kill
rows, the largest of the five. A refused sign-in and a declined consent asserted by outcome;
each token row's `token_id` asserted against the `jti` read from the response; a reconciler
tick that replays, one that throws, one that stops and two in a row; a `session.membership`
call, then the same call with the session read failing under a real lock, then a procedure
that fails inside its transaction with the rows asserted absent; and `smoke` run against a
stub that answers each of its four checks wrongly in turn, plus one that does not answer at
all.

## T-D: The ingress fences bite — the hostname refusal, the per-IP and per-email counters, the SPA's guards and `/health`'s query

Owns `ingress/hostnames.ts:106`, `109`; `ingress/limits.ts:31`; `auth/routes.ts:162`,
`182`, `249-251`; `ingress/spa.ts:46`, `48`, `69`, `95`, `101`, `103`; `server.ts:114`,
`180`; `config.ts:60-61`, `112`, `140-141`, `189-192`. 40 must-kill rows. The refusal
sentence written down as a literal instead of imported; a flood on `/jwks` and on the
discovery documents; `clientKeyOf` over an IPv6 address containing a dotted quad; one code
asked for at two spellings of the same address; a POST and a JSON GET to an unknown path;
`/health` against a database that answers nothing; `PUBLIC_URL` with credentials and an
`smtp://` `SMTP_URL`; and a spawned entry point with a broken environment asserting exit 1
and its reason. It also picks up the twelve `ops.ts` wrapper rows, since the spawned-process
test is the same test.

## T-E: The MCP surface's contract is written down — the four entries' words, `ask`'s answer, `open`'s concept and the constants a test reads back from the code

Owns `mcp/entries/index.ts:41-49`, `58-64`, `69`, `91-94`, `98-113`, `128-135`, `141-142`,
`149-166`, `185`, `194-225`; `auth/constants.ts:27`, `39`, `53`; `ops/index.ts:74`. 74
must-kill rows. One test asserting each entry's name, title, description and scope list
verbatim; a seeded concept opened through the surface so the trust, passage and
found-concept schemas are produced; an `ok` answer with citations; a flag with no reason
refused at the door; `open` called by locator; and the three constants — ninety days, five
minutes, the code path — spelled as literals in the tests that read them, plus a decision on
whether `parseSince` or its docblock is right about the `pg-` prefix.
