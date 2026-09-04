---
date: 2026-09-04
status: research
---

# Multi-tenant SaaS as the primary product, single-instance/on-prem as an option — is the architecture already shaped for it, and what do comparable platforms do?

Read on 4 September 2026. In-repo claims cite a file and line. External claims cite the
primary source (vendor docs, pricing pages, source repositories, first-party engineering
posts) fetched today by a research agent; where a fact is not public that is said rather
than guessed. This is an assessment, not a change proposal.

## The question

Is the current architecture optimised for offering **multi-tenant SaaS as the primary
product**, with **single-instance / on-premise as a separate option** — and how do industry
norms for comparable platforms handle that split? The goal itself is already a stated
principle: "**Multi-tenant-ready data model, single deployment**, UK-preferred hosting,
customer-hosted later" (`docs/vision.md:53`), with "customer-hosted deployment" and "the
customer-hosted worker" in the *Later* row of the use-case table (`docs/vision.md:46`).

## 1. What the comparators do

| Platform | SaaS tenancy | Self-hosted / on-prem | How the split is made |
| --- | --- | --- | --- |
| Guru | Shared multi-tenant AWS, logical isolation "by a unique team ID" | None offered | No split — cloud-only; everything (SSO/SCIM, DLP, audit, compliance) sold as one custom-priced enterprise package |
| Onyx | Both: multi-tenant self-serve cloud (Postgres schema-per-tenant) **and** single-tenant "Enterprise cloud" | Yes — free MIT self-host and paid self-hosted EE | One repo, one image set; EE code under `ee/` directories with a separate licence; features and tenancy switched by config (`MULTI_TENANT` env, EE flag) |
| Dust | Workspace-based SaaS; infra tenancy model not public | MIT repo exists but no self-hosting docs at all — effectively cloud-only | No split — Enterprise is a tier (SSO, SCIM, audit logs, data residency, multiple workspaces), not a deployment |
| Factory.ai | Cloud SaaS (tenancy internals not public) | On-prem is an Enterprise-tier line item | Pure tier separation, no editions: SSO/SCIM/audit/ZDR at *Business*; on-prem, dedicated compute, CMEK, residency at *Enterprise* |

Per platform, from the sources:

- **Guru** — "Your content is stored and managed in a highly secure AWS database, separated
  and protected from other client content by a unique team ID"
  (https://www.getguru.com/security) — i.e. shared-schema, row-level logical isolation, the
  same family as this platform's RLS. Neither the security page nor the pricing page
  (https://www.getguru.com/pricing) mentions any self-hosted or on-prem option; pricing is
  now a single custom enterprise package bundling SOC 2 / HIPAA, SSO + SCIM, RBAC, DLP
  masking and centralised audit logs. **The closest competitor does not offer on-prem at
  all.** Deeper tenancy internals are not public.
- **Onyx** (ex-Danswer) — the richest model, and one ADR 0027 already names as the category
  norm (`docs/adr/0027-…:8`). One repository; "All content that resides under 'ee'
  directories of this repository is licensed under the Onyx Enterprise License", everything
  else MIT (https://raw.githubusercontent.com/onyx-dot-app/onyx/main/LICENSE). Three
  deployment paths — free self-host, Onyx Cloud, self-hosted EE
  (https://docs.onyx.app/deployment/overview) — all from the same images ("Onyx Lite is not
  a separate application. It uses the same Onyx images with a different configuration",
  https://docs.onyx.app/deployment/configuration/configuration). Multi-tenancy is a flag
  that defaults **off**: `MULTI_TENANT = os.environ.get("MULTI_TENANT", …)` with
  schema-per-tenant (`tenant_<id>` Postgres schemas, a shared `public` schema mapping users
  to tenants) when on
  (https://raw.githubusercontent.com/onyx-dot-app/onyx/main/backend/shared_configs/configs.py,
  https://github.com/onyx-dot-app/onyx/pull/3857). So a self-hosted Onyx is a single-tenant
  instance of the multi-tenant codebase. Their cloud also sells a **single-tenant
  "Enterprise cloud"** ("complete data separation… hosted in any region of choice", ~100
  licence minimum, https://docs.onyx.app/security/onyx_cloud/single_tenant). EE tier holds:
  OIDC/SAML SSO, SCIM, RBAC/user groups, source-ACL permission sync, usage analytics, audit
  trails, whitelabeling, on-prem and region-specific deployment
  (https://www.onyx.app/pricing).
- **Dust** — plans are per-**workspace** (seats, connectors, Spaces); Enterprise adds
  "multiple workspaces per organization", SSO, SCIM, audit logs and US/EU data residency
  (https://docs.dust.tt/docs/subscriptions, https://dust.tt/home/pricing). The repo is MIT
  (https://github.com/dust-tt/dust) but there are **no deployment or self-hosting docs
  anywhere** — open code, cloud-only product. Their infrastructure tenancy model is not
  public; do not assume schema-per-workspace.
- **Factory.ai** — no editions, no fork, just tiers (https://factory.ai/pricing). Business
  (custom, ≤150 seats): SSO, SAML/SCIM, Zero Data Retention, audit logging, basic admin
  controls. Enterprise (custom): everything plus **on-premise deployment options**,
  dedicated/partitioned inference compute, customer-managed encryption keys, data
  residency, sub-organisations. The pattern to copy: *deployment isolation is the top-tier
  differentiator of one product, not a second product.*

## 2. The industry norm for "multi-tenant primary, single-instance secondary"

From first-party statements by companies that maintained both sides:

- **One codebase, always.** GitLab ran separate CE/EE repositories and merged them in 2019
  because two codebases meant duplicate work, merge conflicts and manual porting
  (https://about.gitlab.com/blog/2019/02/21/merging-ce-and-ee-codebases/). Their standing
  rule: EE code lives in a top-level `ee/` directory of the one repo, gated at runtime by
  `License.feature_available?`, and "GitLab Enterprise Edition works like GitLab Community
  Edition when no license is active" (https://docs.gitlab.com/development/ee_features/).
  Mattermost ships enterprise code openly in the same repo under a source-available licence,
  unlocked by a licence key, and its cloud "uses the same Kubernetes-based platform as the
  self-hosted edition" (https://docs.mattermost.com/product-overview/editions-and-offerings.html).
- **Same artifacts, different configuration.** Onyx: same images, tenancy and EE both env
  flags (above). The norm is that what varies between cloud and self-hosted is *wiring* —
  IdP/SSO, networking and residency, licence state, telemetry, billing — never schema or
  migrations.
- **Self-hosted is explicitly second-class in support, not in code.** Sentry's own dev docs
  call self-hosted "the Business plan without any software limitations and no paid tier",
  minus billing and closed-source AI, with "no guarantees or dedicated support"
  (https://develop.sentry.dev/self-hosted/).
- **The pain is operating other people's stateful infrastructure.** PostHog sunset its
  supported Kubernetes self-hosted offering in 2022/23: only ~3.5% of users ran it, yet
  "we've seen issues crop up in every part of the stack" and debugging meant "long calls
  with expensive engineers on both sides"; the MIT docker-compose "hobby" deploy survived
  untouched (https://posthog.com/blog/sunsetting-helm-support-posthog). The lesson is not
  "don't offer self-hosted" but "offer the single-box compose deployment you already run,
  and never promise to operate a distributed stack on someone else's hardware".
- **The stable equilibrium** the comparators converge on: multi-tenant cloud primary; a
  **single-tenant dedicated instance** (their cloud or the customer's VPC/metal) as the
  top-tier SKU (Onyx single-tenant cloud, Factory Enterprise on-prem); and where a free
  self-host exists it is *the same image with the tenancy/enterprise flags at their
  single-tenant defaults*. SSO/SCIM to the customer's IdP is universally the enterprise
  seam — all four comparators gate it there.

## 3. Assessment: which current decisions help, and which would fight it

### Decisions that directly serve the goal

- **Shared-schema RLS with `workspace_id` on every tenant row, one seam.** One database,
  one runtime role pattern, every tenant-table policy through one
  `current_workspace_id()` function, "a missing scope is an empty GUC is zero rows"
  (`docs/adr/0032-…:27`), coverage-tested (`packages/schema/test/rls.test.ts`, per ADR
  0009:56). ADR 0032's own staff review pinned this to "the standard multi-tenant-Postgres
  pattern (single database, RLS, per-transaction GUC, non-owner runtime role, list
  partitioning — which Supabase, Crunchy Data and AWS's SaaS-factory material all
  document)" (`docs/adr/0032-…:14`) and *removed* the two deviations (AGE, per-workspace
  roles). This is a stronger multi-tenant posture than Onyx's flag-and-schema-per-tenant
  bolt-on: here multi-tenancy is the only code path. **A single-instance deployment is
  simply this stack with one workspace row — no flag, no second mode, nothing to test
  twice.** That is exactly the property the norm says to protect.
- **Better Auth's organisation model *is* the workspace table.** `organization` is mapped
  onto `workspace`, the workspace id rides the token's `referenceId`, and workspaces are
  platform-provisioned through one act with Better Auth's own after-create hook already
  "wired to the same partition step for the day self-serve is flipped"
  (`docs/adr/0009-…:56-58`). Tenant onboarding is one transaction; the self-serve SaaS
  motion is a named, pre-wired flip, not a rebuild.
- **A bare git repository per workspace** (`/data/git/<workspace>.git`,
  `docs/adr/0024-…:13`). Per-tenant physical isolation of the one asset the product's
  claim rests on, with portability already defined as "the bundle snapshot and the
  repository export (a `git bundle`) through the app". This is both the tenant-isolation
  story *and* the on-prem exit story ("open format you own", `docs/adr/0027-…:16`) in one
  mechanism. Per-workspace `index.chunk` partitions with per-partition HNSW
  (`docs/adr/0032-…:29`) give the same per-tenant isolation for recall.
- **One deploy unit, compose-shaped, public in full.** Two compose stacks plus a database
  resource, images by digest, app-owned forward-only migrations (`docs/adr/0022-…:8-10`,
  ADR 0007). ADR 0027 puts the whole of `deploy/` — compose files, Dockerfiles, wizard,
  runbook, backup and restore scripts — under Apache-2.0 with **no `ee/` directory and no
  paid gate** (`docs/adr/0027-…:8`), and its amendment draws exactly the line the norm
  draws: public halves carry "everything a reader needs to stand up their own deployment"
  while this estate's addresses and edge policy live gitignored, and "the wizard asks for
  every estate value rather than carrying one" (`docs/adr/0027-…:42`). That is PostHog's
  surviving hobby-deploy shape — a single-box compose stack the vendor itself runs daily —
  which is the one form of self-hosted the industry record says stays cheap.
- **Estate values are env, refused at boot, never constants.** The three hostnames derive
  from or arrive as bootstrap env and the app refuses to start without them
  (`docs/adr/0022-…:69-73`); the second hostname fence is one list in
  `apps/api/src/ingress/hostnames.ts` (`docs/adr/0022-…:65`). Nothing about Cloudflare,
  IONOS or Coolify is load-bearing in code — the tunnel is an ingress choice, and a
  customer's reverse proxy replaces it without a code change.
- **The hybrid step is already designed.** The customer-hosted worker reads the workspace
  repository "over git smart HTTP (`git http-backend` behind the app's principal check,
  read-only, under the run's token) — designed here, built when that worker is"
  (`docs/adr/0024-…:13`), and the share agent is already "a program a client's IT installs
  on their own network" (`docs/adr/0027-…:16`). This matches how the comparators actually
  sell "on-prem" first: a data-plane component on the customer's network before a full
  instance (Factory's on-prem options; Onyx's single-tenant cloud before customer metal).

### Decisions that would fight it, or need a settled answer first

- **No entitlement mechanism at all — deliberate, but it forecloses the Factory/Onyx
  pattern.** ADR 0027: "There is no `ee/` directory and no paid gate in the code. What a
  client pays for is the hosted service" (`docs/adr/0027-…:8`), and the `ee/` option was
  explicitly rejected (`docs/adr/0027-…:25`). Under Apache-2.0 with everything public, a
  single-instance/on-prem *product* can only be priced as support, operations and services
  (the Sentry posture) — there is no licence key to sell and any feature-gating later
  means re-licensing future commits (which ADR 0027 notes is reachable from open core, not
  the reverse, `docs/adr/0027-…:21`). This is coherent, but it is a **commercial**
  decision wearing an architectural coat: if on-prem is ever to be a paid tier in the
  Factory sense, the entitlement question must be reopened *before* any gate-worthy
  feature exists, because the flip is one-way.
- **Concept IRIs are minted on the vendor's apex.** "Concept identity is a platform-minted
  opaque IRI on the bare apex `better-answers.com`" (ADR 0002, `docs/adr/README.md:10`).
  On a customer-run instance, every concept in the customer's own portable bundle carries
  the vendor's domain in its identity key. If the IRI is truly opaque (never dereferenced)
  this is cosmetic; if anything ever resolves it, a single-instance deployment needs its
  own minting authority or the asset is tethered. ADR 0002 should be re-read with that
  question when the customer-hosted work starts.
- **Sign-in is email-code or Microsoft, never a password — and no SAML.** ADR 0034 names
  "the per-client `sso` shape a written trigger" (`docs/adr/README.md:42`), which is the
  right shape (a trigger, not an absence), but the industry record is unanimous that
  SSO/SCIM against the customer's IdP is *the* enterprise seam (all four comparators gate
  exactly this). The trigger will fire with the first enterprise or on-prem conversation,
  earlier than the on-prem work itself.
- **Vendor-estate assumptions in the ops layer, all soft.** The backup chain (B2 buckets,
  governance lock, escrow, healthchecks.io dead-man, `RELEASES.md` + `release.yml`
  promotion) is the *vendor's* operation of the primary estate (`docs/adr/0022-…`,
  T-005 amendment). None of it blocks a second deployment — the scripts are public and
  parameterised — but a customer-run instance needs a stated boundary: which of these are
  "the product" (compose, migrate, restore-production.sh, the ops contract) and which are
  "our estate's operation" (the specific buckets, escrow, dead-man). ADR 0027's
  public/private split already implies the line; it has not been written as a support
  posture (Sentry's "no guarantees" sentence is the model).
- **Scale assumptions sized to the two-box estate, not to tenancy.** Worker capped at
  1.5 GB with `MAX_CONCURRENT_RUNS=1` (`docs/adr/0024-…:11`), `vector(N)` fixed to the
  day-one embedding model's dimension with a named reopening condition
  (`docs/adr/0032-…:29`), no per-tenant fairness in the queue beyond one-at-a-time. These
  are honest v0.1 constraints with named growth steps (A then E, `docs/adr/0024-…:11`) —
  they will bite as *SaaS scaling* work, not as fork pressure, and are the same knobs an
  on-prem instance would tune.

### Verdict

**Yes — the architecture is unusually well optimised for exactly this goal, more by
construction than by accident.** The primary product is a shared-schema multi-tenant SaaS
in the textbook pattern (like Guru's, unlike Onyx's flagged-on retrofit); the secondary
option falls out as "the same compose unit with one workspace", which is the only
self-hosted shape the industry record says survives; and the two components a cautious
buyer wants on their own network first (share agent, customer-hosted worker) are already
designed as hybrid steps. The genuine open items are not architectural: entitlement/
pricing model for on-prem (ADR 0027's posture makes it services-shaped), enterprise SSO
(a named trigger), the IRI apex (one ADR 0002 question), and a written support boundary
for anyone who runs the public deploy unit themselves.

## 4. What would have to be true to offer on-prem later without forking

1. **Multi-tenant stays the only code path.** A single-instance deployment is a
   one-workspace instance of the same images and the same migration journal — never a
   `workspace_id`-less build, never an Onyx-style tenancy flag. (Already true; protect it
   in review.)
2. **Every estate fact stays env/wizard-supplied and boot-checked.** No code path may read
   this estate's configuration; the ADR 0027 amendment's testable line ("no public file
   names a hostname's Access posture, a rate-limit placement, a bucket name…",
   `docs/adr/0027-…:44`) generalises to "no *code* file either". (Already the rule.)
3. **SSO to the customer's IdP exists** before the first on-prem (realistically, first
   enterprise) deal — ADR 0034's written `sso` trigger, via Better Auth's SSO plugin,
   with email-code as the fallback.
4. **ADR 0002's apex question is answered**: either IRIs are documented as opaque and
   never-dereferenced (so the apex is a namespace, not a dependency), or a per-deployment
   minting authority is specified.
5. **The customer-hosted worker's read path is built as designed** (`git http-backend`
   behind the principal check, `docs/adr/0024-…:13`) — the hybrid rung that defers full
   on-prem while answering "nothing leaves the site" for the data plane.
6. **A support boundary is written** (Sentry-style): the compose unit, migrations, restore
   script and ops contract are the product; the vendor's buckets, escrow, dead-man and
   promotion workflow are the vendor's estate; a customer-run instance gets the former,
   community-grade, unless a contract says otherwise. This is the fence against PostHog's
   "long calls with expensive engineers on both sides".
7. **The commercial question is settled deliberately**: with no `ee/` and Apache-2.0 over
   the whole tree, on-prem revenue is services and support unless future commits are
   re-licensed (ADR 0027's named path). Whichever way, decide it before building any
   feature someone would pay to unlock — the comparator record (GitLab pre-2019) shows
   retrofitting a gate across a fork is the expensive version.

## Sources

In-repo: `docs/vision.md`, `docs/okf-v02.md`, `docs/adr/README.md`, ADRs 0002 (via index),
0003, 0009, 0022, 0024, 0027, 0032, 0034 (via index),
`docs/research/better-auth-tenancy-and-agent-auth-2026-09-01.md`. External: URLs inline
above; all fetched 2026-09-04. Not public and therefore not claimed: Guru's tenancy
internals beyond the team-ID statement; Dust's infrastructure tenancy model; whether Onyx
Cloud and self-hosted share byte-identical image tags.
