# T-012 — cubic code review: research findings and draft config

Research only. Nothing in this document has been applied to the tree; the draft
`cubic.yaml` in § 7 is text, not a file. Written 31/08/2026.

---

## 1. GitHub App installation — already done

The blocker named in T-012's `## Notes` ("the repo has to be granted to it in the
cubic dashboard before any `cubic.yaml` is read") is **stale**. Checked directly
against the GitHub API:

```
app_slug:              cubic-dev-ai
app_id:                1082092
installation id:       157824676
account:               betteranswers (Organization, id 322156400)
repository_selection:  "all"
created_at:            2026-08-31T00:07:12+01:00
permissions:           contents:write, pull_requests:write, checks:write,
                       issues:write, actions:write, workflows:write,
                       members:read, metadata:read, statuses:read,
                       deployments:read, administration:read,
                       organization_custom_roles:read,
                       organization_custom_properties:read
events:                commit_comment, issue_comment, member, membership,
                       organization, pull_request, pull_request_review,
                       pull_request_review_comment,
                       pull_request_review_thread, repository
management URL:        https://github.com/organizations/betteranswers/settings/installations/157824676
```

Repository state: `betteranswers/better-answers` is `PUBLIC`, default branch
`main`. One PR in the repo's history (#2, `task/T-002-repo-skeleton`, merged
30/08/2026) — it predates the installation, so no cubic review exists yet.

`repository_selection: "all"` means every repository in the org is granted,
including this one and any future one. No per-repository grant step is needed.

Two other apps are installed on the org and are unrelated: `renovate`
(app id 2740, selected repos) and `claude-design-import` (app id 3235966).

**What this changes for the task:** the human step is a dashboard *confirmation*,
not an installation. It is short, and the task is not blocked in the way its
Notes describe.

---

## 2. Ordered dashboard steps — the part only the user can do

1. Go to <https://cubic.dev/dashboard> and sign in with GitHub. Confirm the
   workspace shown is the **`betteranswers` organization**, not a personal
   account. Whoever installed the app is automatically a cubic admin, and GitHub
   org admins become cubic admins on install, so no role grant should be needed.
2. Open the AI review settings page (<https://cubic.dev/ai-review>). Select
   `betteranswers/better-answers` in the repository picker. Confirm AI review is
   **on** for this repository — settings can be held per repository or globally
   for the whole installation, so check which scope is in force.
3. On that page, open the **Custom Agents** sidebar and note whether any agents
   are already defined in the UI. **UI-defined agents consume the same
   five-agent-per-repository cap as YAML ones.** Repository YAML agents are
   listed first and UI (and org) agents fill the remaining slots, so pre-existing
   UI agents cannot displace the five below — but if a sixth YAML agent were ever
   added it would be dropped silently. Disable any UI agents that duplicate a
   YAML one.
4. Confirm the plan line reads free-for-public-repositories. cubic is
   automatically free for all public repos with no application; the 7-day trial
   and the 20-review/month free plan are the private-repo path and should not
   apply here.
5. If the dashboard prompts to verify the GitHub email
   (`docs.cubic.dev/account/verify-github-email`), do it — an unverified email
   can gate access.
6. **Merge `cubic.yaml` to `main`.** cubic reads configuration *only from the
   default branch*. A `cubic.yaml` sitting on a feature branch does nothing, and
   the PR that adds it is reviewed under the old config.
7. After the merge, reopen the AI review settings page. Confirm the config
   renders there: YAML-defined agents appear as read-only entries labelled
   **"Managed by cubic.yaml"**. Five such entries means the file parsed and every
   agent fitted under the cap.

Optional, worth doing once before step 6: the same settings page has copy and
download buttons that export the current UI settings as a starter `cubic.yaml`.
Exporting first shows exactly which defaults are in force today.

---

## 3. Schema reference

Source: <https://cubic.dev/schema/cubic-repository-config.schema.json>,
cross-checked against <https://docs.cubic.dev/configure/cubic-yaml>.

### Root

- `$schema`: `https://json-schema.org/draft/2020-12/schema`
- `$id`: `https://cubic.dev/schema/cubic-repository-config.schema.json`
- `title`: Cubic Repository Configuration
- `type`: object
- **`additionalProperties: true`**
- `required`: `["version"]`

Top-level keys: **`version`** (const `1`), **`reviews`**, **`pr_descriptions`**,
**`issues`**. Note that `ignore` and `custom_rules` are nested *under* `reviews`;
onyx's file has them there and is correct.

#### The `additionalProperties: true` trap

A misspelled or invented **top-level** key is accepted silently — no validation
error, no dashboard warning, no effect. Every nested object (`reviews`,
`pr_descriptions`, `issues`, `ignore`, `autoApproveRules`, `customRule`) is
`additionalProperties: false`, so typos *inside* them do fail and surface on the
settings page. Keep the `# yaml-language-server:` directive at the top of the
file: editor-side validation is the only thing that catches a root-level typo
before commit.

### `reviews` (`additionalProperties: false`)

| Key | Type / values | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | — | Master toggle for AI reviews on this repository |
| `sensitivity` | **`low` \| `medium` \| `high`** | — | How strictly cubic flags issues. Those three values only |
| `incremental_commits` | boolean | `true` | Review new commits pushed to open PRs; only new issues posted |
| `check_drafts` | boolean | `false` | Review draft PRs immediately on open |
| `architecture_diagrams` | boolean | `false` | Include AI-generated architecture diagrams in review summaries |
| `external_contributors_require_manual_review` | boolean | `false` | Skip automatic reviews for external contributors on public repos |
| `show_ai_feedback_buttons` | boolean | `false` | **Deprecated.** Retained for backward compatibility; ignored |
| `resolve_threads_when_addressed` | boolean | `true` | Auto-resolve GitHub review threads once the issue is addressed |
| `merge_confidence_summary` | boolean | `false` | Include an AI-generated merge confidence summary |
| `auto_approve_behavior` | `disabled` \| `shadow` \| `live` | — | Auto-approval submission mode |
| `auto_approve` | `disabled` \| `always` \| `low_risk_only` \| `custom` | — | Auto-approve mode selection |
| `auto_approve_custom_prompt` | string | — | Criteria used when `auto_approve: custom` |
| `auto_approve_rules` | `$defs.autoApproveRules` | — | Eligibility gates for auto-approval |
| `ultrareview` | `disabled` \| `manual` \| `automatic` | `manual` | Master switch for ultrareviews |
| `auto_ultrareview` | `disabled` \| `high_risk_only` \| `custom` | — | Auto-trigger mode |
| `auto_ultrareview_custom_prompt` | string | — | Criteria describing which PRs warrant an ultrareview |
| `auto_ultrareview_file_patterns` | globList | — | File/directory globs that always trigger an ultrareview |
| `custom_instructions` | string | — | Free-form reviewer guidance; leading/trailing whitespace trimmed |
| `ignore` | `$defs.ignore` | — | Conditional filters that skip AI reviews |
| `custom_rules` | array of `$defs.customRule` | — | YAML-managed custom agents, enforced before UI-defined agents |

### `$defs.ignore` — `reviews.ignore` (`additionalProperties: false`)

| Key | Type | Meaning |
| --- | --- | --- |
| `files` | globList | File globs skipped entirely. `.gitignore` glob syntax |
| `head_branches` | globList | Source branches that never trigger a review |
| `base_branches` | globList | Target branches that never trigger a review |
| `pr_labels` | globList | Labels that disable reviews when present; wildcards allowed |
| `pr_titles` | globList | Wildcard matches applied to the PR title |
| `max_changed_lines` | integer, 1–2147483647 | Automatic-review threshold on added + deleted lines. **Effective ceiling 50,000** |

### `$defs.customRule` — `reviews.custom_rules[]`

`additionalProperties: false`; `required: ["name"]`; plus an **`anyOf`** requiring
**either `description` or `file_paths`**.

| Key | Type | Meaning |
| --- | --- | --- |
| `name` | string, minLength 1 | Rule title shown in the dashboard, and used to attribute findings on a PR |
| `description` | string, minLength 1 | What the rule enforces, in natural language |
| `file_paths` | array, 1–10 items; each string minLength 1, maxLength 500 | Ordered repo-relative instruction files, read **from the PR head commit at review time** — so the file can change without editing the config. Markdown and YAML only, read as plain text. Absolute paths, globs, `../` traversal and binary files are rejected |
| `include` | globList | Scope. Defaults to all files |
| `exclude` | globList | Overrides `include` |

### `pr_descriptions` (`additionalProperties: false`)

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `generate` | boolean | — | Enable AI-authored PR descriptions |
| `instructions` | string | — | Extra guidance inserted into generated summaries. Applied only when `generate: true` |
| `cubic_review_link` | boolean | `true` | Include a link to the review in cubic |
| `skip_if_author_description` | boolean | — | Skip generation when the author wrote a substantive description |

### `issues` (`additionalProperties: false`)

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `fix_with_cubic_buttons` | boolean | — | Show "Fix with cubic" buttons on GitHub issues |
| `pr_comment_fixes` | boolean | — | Allow cubic to make code changes when asked from a PR comment |
| `fix_commits_to_pr` | boolean | — | Push fix commits directly to the PR branch rather than opening a new PR |
| `auto_fix_sign_commits` | boolean | `false` | Sign commits pushed by cubic. The Cursor agent always signs regardless |
| `coding_agent_provider` | `cubic` \| `cursor_cloud_agent` | `cubic` | Which coding agent applies automatic fixes |

### `$defs.autoApproveRules`

`additionalProperties: false`. All globLists except the one boolean. Author and
label matching is case-insensitive.

| Key | Type | Meaning |
| --- | --- | --- |
| `exclude` | globList | Changed files matching these are never eligible for auto-approval |
| `only_files` | globList | Every changed path must match at least one glob for eligibility |
| `exclude_external_contributors` | boolean, default `false` | External-contributor PRs are never auto-approved |
| `exclude_authors` | globList | PRs from matching authors are never auto-approved |
| `only_authors` | globList | Only PRs from matching authors can be auto-approved |
| `exclude_head_branches` | globList | PRs from matching source branches are never auto-approved |
| `only_head_branches` | globList | Only PRs from matching source branches can be auto-approved |
| `exclude_base_branches` | globList | PRs targeting matching base branches are never auto-approved |
| `only_base_branches` | globList | Only PRs targeting matching base branches can be auto-approved |
| `exclude_labels` | globList | PRs with matching labels are never auto-approved |
| `only_labels` | globList | Only PRs with matching labels can be auto-approved |
| `exclude_titles` | globList | PRs whose title matches are never auto-approved |
| `only_titles` | globList | Only PRs whose title matches can be auto-approved |

### `$defs.globList`

`type: array`, `items: string (minLength: 1)`. Empty strings are ignored at
runtime. Description: "List of glob patterns; empty strings ignored at runtime."

### The two hard limits

1. **Maximum 5 enabled custom agents per repository.** The rules library may hold
   more, but only five are active at a time. YAML agents are listed first, then
   org-config agents, then UI agents, filling up to five. T-012's acceptance
   criteria name exactly five rules — that is the entire budget, with no room for
   a sixth.
2. **10,000 characters per custom agent**, shared between `description` and any
   resolved `file_paths`, concatenated in order, with the excess **silently
   discarded**. This rules out pointing `file_paths` at the root
   `CODING_RULES.md`: at **16,015 bytes** it would truncate mid-document and
   consume the agent's whole budget. `app/CODING_RULES.md` (1,987 bytes) and
   `worker/CODING_RULES.md` (1,554 bytes) do fit.

### File location and precedence

The file must be named **exactly `cubic.yaml`** and sit at the **repository
root**. Both are fixed.

Precedence, highest first:

1. Repository `cubic.yaml`
2. Organization `cubic.yaml` — held in a repository named literally
   `cubic-config` in the org
3. Dashboard UI settings, per repository
4. Built-in defaults

Repository settings override organization settings field by field, **except
`custom_rules`, which are additive** (repo agents first, then org agents fill
remaining slots up to five). No `cubic-config` repository exists under
`betteranswers` today, so nothing merges in. If one is ever created, setting
`custom_rules: []` in the repository config opts out of inherited agents
entirely.

---

## 4. What onyx omits — a recommendation per key

Onyx's `/Users/liamj/Documents/development/onyx/cubic.yaml` sets `version`,
`reviews.{enabled, sensitivity, incremental_commits, check_drafts,
custom_instructions, ignore.files, custom_rules}` and `issues.{
fix_with_cubic_buttons, pr_comment_fixes, fix_commits_to_pr}`. Every key below is
unset there. Recommendations are for **a public repository with a single
maintainer and a heavy written constitution**.

| Key | Recommendation | Reason |
| --- | --- | --- |
| `reviews.merge_confidence_summary` | **`true`** | The strongest of these, and the one I would most want that onyx lacks. No second human reviewer exists. A merge-confidence line at the bottom of the summary is the closest thing to a second opinion at the moment of merge, and it costs nothing. |
| `reviews.resolve_threads_when_addressed` | **`true`, set explicitly** | Already the default, but with one maintainer nobody else closes threads, so stale open threads accumulate and make a PR look unfinished. Writing it down records the intent and survives a change of default. |
| `reviews.external_contributors_require_manual_review` | **`false` for now** | Public repo (ADR 0027), zero outside contributors today. Silently withholding a review from a first-time contributor is the wrong signal for an open-core project. It exists as a fair-use lever — flip it the day drive-by PRs start arriving. |
| `reviews.architecture_diagrams` | **`false`** (leave at default) | The maintainer wrote the architecture and it is documented across 27 ADRs. A generated diagram on every summary is noise, not information. Revisit when contributors arrive. |
| `reviews.ultrareview` | **`manual`, set explicitly** | On-demand via a PR comment is the right shape for a solo maintainer. Setting it explicitly documents that the default was chosen, not inherited. |
| `reviews.auto_ultrareview`, `auto_ultrareview_custom_prompt`, `auto_ultrareview_file_patterns` | **Omit for now; revisit** | The obvious patterns are `packages/schema/migrations/**` and `deploy/**` — migrations are forward-only and images deploy by digest (`[OPS1]`, ADR 0022), so both are irreversible and are exactly what deserves a deeper look. But the docs never describe whether `auto_ultrareview` fires while `ultrareview: manual`. Adding it blind risks either silence or an ultrareview on every migration. Trigger one manually first and see what it costs. |
| `reviews.auto_approve`, `auto_approve_behavior`, `auto_approve_custom_prompt`, `auto_approve_rules` | **Do not set. Leave disabled** | A single maintainer self-merging gains nothing from a bot approval. On a repository whose entire point is a written constitution, an automated approval is the one thing that should never happen — it converts the review from a gate into decoration. |
| `pr_descriptions.generate` | **`true`** | Work here is one ordna task per PR. A generated description is a real convenience when the author leaves the body thin. |
| `pr_descriptions.skip_if_author_description` | **`true`** | The ordna task text *is* the real description and is better than anything generated. Generate only to fill a gap. |
| `pr_descriptions.cubic_review_link` | **`true`** (default, set explicitly) | Free navigation from the PR back to the full review. |
| `pr_descriptions.instructions` | **Omit** | `custom_instructions` already carries the repository's vocabulary. A second prose block is one more thing to keep in step with `CONTEXT.md`. |
| `issues.auto_fix_sign_commits` | **Omit (`false`)** | No commit-signing requirement exists in this repository, and requiring signature on bot commits would need key setup nobody has asked for. |
| `issues.coding_agent_provider` | **`cubic`** (default, omit) | Cursor is not in this stack. |
| `reviews.ignore.max_changed_lines` | **Omit** | Reviews are free for public repos, and a large migration, deploy or schema PR is exactly when a review is most valuable. Capping it would silence the reviews that matter most. |
| `reviews.ignore.pr_labels` | **Omit** | No label taxonomy exists on this repository yet. Adding one to suppress reviews would be inventing process to work around a tool. |
| `reviews.ignore.pr_titles` | **Omit** | Titles here name a task (`B1 — Repo skeleton and a green check (T-002)`); there is no throwaway-PR title convention to match against. |
| `reviews.ignore.head_branches` | **Omit** | Branches are `task/T-NNN-*`, one per task, and every one should be reviewed. |
| `reviews.ignore.base_branches` | **Omit** | `main` is the only base branch. |
| `reviews.custom_rules[].exclude` | **Omit** | The `include` globs in the draft are already tight; an exclude on top would be a second place to look when a rule fails to fire. |
| `reviews.custom_rules[].file_paths` | **Omit from the draft; hold as the fallback** | Genuinely attractive: the file is re-read from the PR head commit, so rules track the constitution with no config edit. But `CODING_RULES.md` at 16,015 bytes blows the 10,000-character budget and would truncate mid-document. Use this only if `custom_instructions` prose proves not to pull the constitution in — see § 8. |
| root-level unknown keys | **Never add speculatively** | `additionalProperties: true` means a typo is accepted and does nothing. |

---

## 5. Verifying cubic is live and reading our config

- **Bot comment — the reliable signal.** A summary comment from `@cubic-dev-ai`
  plus inline comments on the diff. Findings raised by a custom agent carry
  **attribution naming which agent fired**. That attributed comment is precisely
  the artefact T-012's acceptance line asks for ("a review naming at least one
  repo-specific rule").
- **Manual trigger.** Comment `@cubic-dev-ai review this` on any open PR to force
  a review without pushing a commit. Useful for re-testing a config change
  without inventing a code change.
- **Dashboard.** The AI review settings page shows every active configuration
  value, and YAML-defined agents appear as read-only entries labelled **"Managed
  by cubic.yaml"**. Seeing five such entries is the direct confirmation that the
  file parsed *and* that every agent fitted under the cap.
- **Failure is silent — this is the important one.** Invalid YAML does **not**
  block a review and does not fail a check. cubic shows the specific parse error
  on the AI review settings page and **falls back to the dashboard UI settings**
  (an invalid repository config falls back to UI settings rather than to the
  organization config, which the docs describe as keeping failure modes
  predictable). A broken config therefore looks exactly like a normal review.
  Confirm at the dashboard; never infer from a review merely appearing.
- **Editor validation before commit.** The
  `# yaml-language-server: $schema=https://cubic.dev/schema/cubic-repository-config.schema.json`
  directive makes the editor download the schema and validate on save. Given
  `additionalProperties: true` at the root, this is the only thing that catches a
  root-level typo.
- **Status check — unknown.** No check run or commit status is documented
  anywhere in the docs. The installation *holds* `checks: write` and
  `statuses: read`, so cubic could create one, but nothing asserts it does. Do
  not add branch protection on a cubic check until one has actually been observed
  on a PR.
- **No dashboard log of config reads** is documented — only the rendered current
  values and any parse error.

---

## 6. Free-tier facts for public repositories

Source: <https://docs.cubic.dev/account/subscription>.

- **"cubic is automatically free for all public repositories"** — no application,
  no trial clock, no card. `betteranswers/better-answers` is `PUBLIC`, so this is
  the applicable path.
- **All features remain available on free plans** — analytics, PR management,
  notifications, integrations. Only AI-review *quantity* is restricted, and
  quantity is not restricted for public repos. Nothing in the draft config below
  is withheld from us.
- The **20 AI reviews per month** permanent free plan, and the **7-day
  no-credit-card trial** that lapses into it, are the private-repo path.
- **Fair use applies and is not quantified.** "High-volume usage may face
  fair-use restrictions" is the only statement; no threshold is published.
- Paid usage is metered in **reviewed lines, not review count**, pooled across
  paid seats. **Reviewed lines exclude generated files, vendored code, and
  ignored files** — a second, independent reason to get `ignore.files` right even
  while free.
- Seats are per-GitHub-organization and do not transfer between orgs.
- Nonprofit and educational institutions get 50% off on verification. Flex
  capacity is $20 per 10,000 extra reviewed lines on paid workspaces. Annual
  billing is 20% cheaper than monthly. None of these apply here.
- A safeguard exists on large PRs: "If an automatic review would use a
  significant portion of your monthly review quota, cubic asks for confirmation
  before starting it," overridable with `@cubic-dev-ai review this`
  (<https://docs.cubic.dev/faq-and-troubleshooting>).

---

## 7. Draft `cubic.yaml`

### Two decisions behind the file

**Sensitivity `medium`, not `high`.** The repository already runs oxlint with
`categories.correctness: error`, `no-console`, `typescript/no-explicit-any`,
`typescript/no-non-null-assertion`, `typescript/consistent-type-imports`, plus
the anti-slop plugin set (fifteen rules as errors, five as warnings, two off).
`high` would multiply generic findings this stack already fails `check` on. The
value cubic adds here is the five agents, not raised generic sensitivity. If
early reviews prove too quiet, `high` is a one-word change.

**`ignore.files` targets `app/lifts/**`, the destination.** The vendored
anti-slop plugin currently sits at `app/tools/anti-slop/` — a lift in substance
(the root `THIRD_PARTY_NOTICES.md` documents it as a snapshot of
`github.com/dmmulroy/anti-slop` at commit `6376385614d6c5d69b7460a11a86b656cdd88a7b`,
boundary-tested by `app/test/anti-slop-lift.test.ts`) but misplaced relative to
ADR 0027's `<tier>/lifts/<name>/`. T-016 moves it. The config is written against
where it is going, with a comment saying so, so that no edit is needed when T-016
lands — at the cost of the ignore not covering it in the window between T-012 and
T-016.

### The file

```yaml
# yaml-language-server: $schema=https://cubic.dev/schema/cubic-repository-config.schema.json
version: 1

reviews:
  enabled: true
  sensitivity: medium
  incremental_commits: true
  check_drafts: false
  resolve_threads_when_addressed: true
  ultrareview: manual

  # No second human reviewer exists, so the confidence line at merge is the
  # closest thing this repository has to a second opinion.
  merge_confidence_summary: true

  # Public repo (ADR 0027). Left off so a first outside contributor still gets a
  # review; flip to true if drive-by pull requests start burning fair use.
  external_contributors_require_manual_review: false

  custom_instructions: |
    Review against this repository's written constitution, not against generic
    TypeScript and Python advice.

    Read these files and treat them as the standard a change is measured by:

    - `CODING_RULES.md` — the constitution. Every rule carries a tag in square
      brackets (`[SEC2]`, `[DESIGN1]`, `[TEST3]`). Cite the tag in any finding
      that rests on a rule.
    - `app/CODING_RULES.md` — rules binding the TypeScript tier alone
      (`[APP1]`–`[APP4]`). `web/` is a browser package following the same
      TypeScript rules; it talks to `app/` over tRPC and neither imports the
      other (ADR 0006).
    - `worker/CODING_RULES.md` — rules binding the Python tier alone
      (`[WRK1]`–`[WRK4]`).
    - `CONTEXT.md` — the glossary. Every domain word in code, tests, commits and
      comments comes from here. A new domain word is settled in `CONTEXT.md`
      before it appears anywhere else, so a diff introducing one without
      touching `CONTEXT.md` is a finding.
    - `AGENTS.md` — the layout, the tier split, and how a task is worked.
    - `docs/adr/` — numbered architecture decision records carrying the reasons
      behind the architecture. Read the ADR a change touches before judging the
      change.

    Judge a change by whether it can be deleted rather than by whether it works:
    a module earns its place when removing it makes complexity reappear across
    its callers. Prefer a small interface over a large implementation.

    Say why a finding matters to this repository, and name the rule tag or ADR
    number it rests on. Leave unwritten any finding that only restates an oxlint
    or anti-slop rule — those already fail `check`.

  ignore:
    files:
      # This file. A review of the review config is circular.
      - cubic.yaml

      # Verbatim third-party snapshots taken by contract (ADR 0027).
      # A finding in one belongs upstream, not on a pull request here.
      # Depends on T-016, which moves the vendored anti-slop plugin from
      # `app/tools/anti-slop/` to `app/lifts/anti-slop/`.
      - app/lifts/**
      - web/lifts/**
      - worker/lifts/**
      - packages/*/lifts/**

      # Generated, and rewritten by tooling rather than by hand.
      - pnpm-lock.yaml
      - worker/uv.lock
      - packages/schema/migrations/meta/**
      - "**/dist/**"

  custom_rules:
    - name: A Principal on every tenant-data call
      description: >
        Rule [SEC2]. Every function in the app tier that reads or writes tenant
        data takes a `Principal` (`workspaceId`, `userId`, `role`) as its first
        parameter. Transports build the Principal; business logic checks the
        role, the role's action threshold, and the read predicate
        (`published_at`, `sensitivity`, `audience`) beside the data access.

        Flag a function that reaches a table, a query builder or the graph and
        takes no Principal first, or takes one later in the parameter list, or
        takes a bare `workspaceId` string in place of one. Flag a read that
        checks the workspace but skips the read predicate, and flag a read
        predicate tested against a source binding's fields rather than against
        `published_at`, `sensitivity` and `audience` columns on the readable
        unit itself — a concept and a composition have no binding (ADR 0023).

        Work that outlives a user session runs under a deferred principal (a
        named person's borrowed, expiring authority) or a platform principal
        (the platform acting as itself, with its own actor id). Flag a
        background job, scheduled run or replay carrying a live user session.

        Every capability is proved by one functional test running through every
        mounted transport — tRPC, MCP and `/agent/v1`. A new capability tested
        through only one of them is a finding.
      include:
        - app/**
        - packages/**
        - worker/**

    - name: The identity provider stays behind its seam
      description: >
        ADR 0009's identity seam. Better Auth is a stay with three written
        leave-triggers, and this seam is what makes the Keycloak fallback two to
        three weeks of work rather than a rewrite.

        A transport verifies a bearer token and builds a `Principal`. Nothing
        behind that seam knows which library minted the token. Flag any
        `better-auth` or `@better-auth/*` import outside the auth module, and
        flag the subtler leak a lint rule cannot see: a Better Auth type,
        interface or object shape re-exported, aliased, structurally copied, or
        embedded in a `Principal`, a context object or a function signature that
        crosses into the rest of the app tier. A session object passed onward
        where a `Principal` belongs is the same finding.

        Rule [DESIGN3] governs seams generally: a seam is introduced where
        something already varies across it — a second store, a second provider.
        A seam built for one implementation with no second in sight is a
        finding. Dependencies arrive as parameters, and results are returned
        rather than written as side effects.
      include:
        - app/**
        - packages/**
        - web/**

    - name: A contradicted ADR is a new ADR
      description: >
        The records in `docs/adr/` carry the reasons behind the architecture,
        and their worth is that they can be trusted as a record of what was
        decided and when. A decision is superseded by a new numbered ADR, or
        extended by an explicitly dated amendment section appended to the
        existing one. Both leave the original reasoning readable.

        Flag a diff that rewrites, softens or deletes the body of an existing
        ADR so that it now agrees with the code being added. Flag a code change
        contradicting an accepted ADR while adding no ADR of its own — name the
        ADR number it contradicts.

        A change that is hard to reverse, surprising to a later reader, and a
        real trade-off needs an ADR in the same pull request.

        The accepted shapes are already in the tree: a
        `## Amendment — <date>, <what changed>` section appended to the existing
        record, or a new numbered file whose title states the new decision. A
        status line moving to `superseded` with a pointer to the replacement is
        correct.
      include:
        - docs/adr/**
        - app/**
        - worker/**
        - packages/**
        - web/**
        - deploy/**

    - name: Comments explain why
      description: >
        Rule [COMMENT1]. A comment carries the reason a reader cannot infer from
        the code: a constraint, a trade-off, a gotcha, why an obvious simpler
        approach was rejected. What the code does is said by the code. What
        happened to the code is said by git history and by `docs/adr/`.

        Flag a new comment that paraphrases the line beneath it, that narrates a
        change ("now uses X instead of Y", "updated to handle Z"), that
        summarises a diff, or that labels a section of a function without adding
        a reason. Flag a docstring restating the signature in prose.

        Leave alone: a comment naming an external constraint, a magic number's
        provenance, a link to a specification or vendor issue, a note on why an
        ordering matters, or a `TODO` carrying a task id.
      include:
        - app/**
        - worker/**
        - packages/**
        - web/**
        - deploy/**

    - name: Versions come from the source
      description: >
        Rule [DEPS1]. Every dependency, container image, Postgres extension and
        tool version is read at the time of the change from Context7 or from the
        vendor's own release page, and the pull request names where it was read.
        The reason is concrete: the stack lock carried Postgres 17 from memory
        while 18 was current.

        Flag a diff adding or bumping a version in `package.json`,
        `pnpm-workspace.yaml`, `pyproject.toml`, a Dockerfile, a compose file or
        a workflow file when the pull request body names no release page or
        Context7 lookup it came from. A Renovate pull request satisfies this
        when it names the release page it read.

        Flag a floating specifier where a pin belongs: `latest`, a bare major, a
        caret or tilde range on a container image or tool, or an image reference
        without a digest anywhere under `deploy/` — a compose file refuses to
        start without one (ADR 0022).

        Licences are pinned the same way: code is lifted or depended on only
        under MIT, BSD, ISC, Apache-2.0 or the PostgreSQL licence (ADR 0027). Flag a new dependency outside that list.
      include:
        - "**/package.json"
        - pnpm-workspace.yaml
        - "**/pyproject.toml"
        - "**/Dockerfile*"
        - deploy/**
        - .github/**
        - renovate.json

pr_descriptions:
  generate: true
  cubic_review_link: true
  skip_if_author_description: true

issues:
  fix_with_cubic_buttons: true
  pr_comment_fixes: true
  fix_commits_to_pr: true
```

### Budget check

Every agent's `description` is well inside the 10,000-character limit — the
longest is the Principal agent at roughly 1,400 characters. No `file_paths` are
attached, so nothing competes for that budget. The file uses exactly **five**
agents, hitting the cap precisely, which is why nothing below could be added.

### Rules dropped, and why

Five agents is the whole budget. Nothing was silently trimmed; these are the
rules that lost the contest for a slot, in order of how soon they should take one.

- **The tenancy rule — workspace on every row — and the Apache AGE graph rules.** The
  strongest omission by a distance: one graph per workspace; `workspace_id` a
  term of the builder's `WHERE` on every node *and* edge; the three visibility
  terms as properties on every element of a bounded variable-length pattern;
  depth capped at 4 by the template, never by the caller; graph name derived only
  through the allowlisted `^ws_[0-9a-z]{26}$` function; `cypher(` refused outside
  the graph query module's builder; split `MERGE`s; `app_rt` under `FORCE ROW
  LEVEL SECURITY`; no `neo4j` driver, Bolt, APOC or `neo4j_graphrag` import in
  either tier. A generic reviewer misses every line of that. It is out **only
  because none of the code exists yet** — `app/src/` is five files
  (`config.ts`, `logger.ts`, `main.ts`, `migrate.ts`, `server.ts`) and there is
  no `app/src/lib/`. **Swap it in the moment the graph query module lands**, most
  likely absorbing the Principal agent, since both are tenant isolation and a
  reviewer looking at a data-layer diff should check both together.
- **`[TEST1]`–`[TEST5]`.** Functional tests through the interface
  (`server.request(...)`, not a function the transport happens to call), real
  Postgres never mocked, factories rather than raw inserts, titles stating
  behaviour. Real and repo-specific — but `[TEST3]`'s module-mocking ban is
  already `anti-slop/no-module-mocking: error`, which weakens the case for
  spending a whole slot.
- **`[GLOSSARY1]`.** A new domain word is settled in `CONTEXT.md` first. Very
  checkable against a diff. Folded into `custom_instructions` rather than
  spending a slot — if it proves not to fire from there, it deserves one.
- **`[LOG1]`.** Prompt and completion content never enter the logger, the
  exporter or the `llm_call` row; every model call writes exactly one row. Worth
  a slot once LLM routing exists; `no-console: error` covers the easy half today.
- **`[OKF1]`/`[OKF2]`.** The bundle-alone test, and a concept file carrying OKF
  v0.2 plus exactly `iri` and `sources[].locator`. Extremely high value and
  near-impossible for a generic reviewer — but no concept files exist yet.
- **`[PIPE1]`.** Never rebuild what cocoindex provides, never rely on what it
  does not; cocoindex types never cross a module seam; every target is
  `managed_by="user"`. Same reason: the worker pipeline is not built.
- **`[APP1]`.** Every intra-repository import carries its `.ts` extension.
  Mechanically checkable, but it fails loudly at run time and `tsc --noEmit`
  catches it, so a review finding adds nothing.

---

## 8. Unknowns — stated as unknown, not guessed

- **Whether cubic creates a GitHub check run or commit status.** Not documented
  anywhere in the docs I read. The installation holds `checks: write` and
  `statuses: read`, so it *can*; I have not confirmed that it does. Do not gate
  branch protection on a cubic check until one has been observed on a real PR.
- **Whether `sensitivity` also gates custom-agent findings**, or only the generic
  reviewer. Undocumented. If `medium` turns out to suppress agent findings,
  raising it to `high` is the fix — worth watching on the first two or three
  reviews.
- **Whether `auto_ultrareview` fires while `ultrareview: manual`.** The schema
  defines the two keys independently and the docs describe neither interaction.
  This is why `auto_ultrareview_file_patterns` is omitted despite
  `packages/schema/migrations/**` and `deploy/**` being obvious candidates.
- **The fair-use threshold for public repositories.** Stated to exist, never
  quantified.
- **Whether `custom_instructions` prose reliably causes cubic to open a file it
  does not auto-detect.** `CLAUDE.md`, `AGENTS.md`, `README` variants,
  `.cursorrules`, `copilot-instructions.md`, `context.md`, `.claude/skills/`,
  `.ai/` and `.github/` are on the documented auto-detect list.
  **`CODING_RULES.md` and `CONTEXT.md` are not.** Naming them in
  `custom_instructions` is what onyx does and is the documented mechanism, but
  the docs stop short of promising a fetch. The pointer chain here is also
  indirect: `CLAUDE.md` contains only `@AGENTS.md`, and `AGENTS.md` points on to
  `CODING_RULES.md`.
  **Fallback if early reviews cite no rule tags:** attach
  `file_paths: [app/CODING_RULES.md]` (1,987 bytes) to the tier-scoped agents and
  `file_paths: [worker/CODING_RULES.md]` (1,554 bytes) where relevant. Those are
  a guaranteed read from the PR head commit and fit the budget. The root
  `CODING_RULES.md` at 16,015 bytes cannot be used this way.
- **Whether custom agents already exist in the dashboard UI for this
  repository.** Only the user can see this — hence step 3 of § 2.
- **Whether any organization-level `cubic-config` repository exists** under
  `betteranswers`. None is visible to me.
- **Whether cubic honours `.gitignore` in addition to `ignore.files`.** The docs
  say ignore globs use `.gitignore` *syntax* and that reviewed lines exclude
  "generated files, vendored code, and ignored files", but do not say whether
  "ignored" means gitignored or config-ignored. `node_modules/`, `dist/`,
  `.venv/`, `coverage/` and `reports/mutation/` are already gitignored here; the
  draft repeats `**/dist/**` in `ignore.files` rather than rely on the ambiguity.
- **Whether `.gitattributes` generated-file marking is honoured for reviews** as
  well as for billing. The settings page has an "Exclude generated files (via
  `.gitattributes`)" control; the repository has no `.gitattributes` today.

---

## 9. Belongs in T-012's Notes

Two facts that will otherwise be rediscovered the hard way.

**1. cubic reads `cubic.yaml` only from the default branch.** Every other config
file in this tree takes effect on the branch that changes it; this one does not.
That makes `cubic.yaml` unusual among our config files, and it has a direct
consequence for the acceptance criteria: **the PR that adds `cubic.yaml` cannot
be the PR that proves it.** The order is:

1. Open the PR adding `cubic.yaml`. It is reviewed under the *old* config.
2. Merge to `main`.
3. Confirm the dashboard lists five agents as "Managed by cubic.yaml".
4. Open a *second* PR — the next task's — and link its attributed cubic comment
   as the artefact for "proven by one real PR that draws a review naming at least
   one repo-specific rule".

**2. UI-defined agents consume the same five-agent cap as YAML ones.** The cap is
five *enabled* agents per repository across all sources. Repository YAML agents
are listed first, then organization-config agents, then dashboard UI agents, up
to five. The draft uses all five, so any agent defined in the dashboard UI is
inert — and if a sixth YAML agent were ever added it would be dropped with no
error. Check the Custom Agents sidebar before and after merging.

**3. The GitHub-side grant is already done** (see § 1), so the Notes' claim that
this task is blocked on a repo grant is stale. `cubic-dev-ai` (app id `1082092`,
installation `157824676`) has been installed on the `betteranswers` org with
`repository_selection: "all"` since 2026-08-31T00:07:12+01:00. What remains is a
dashboard confirmation, not an installation.

---

## Sources

- <https://cubic.dev/schema/cubic-repository-config.schema.json> — the schema
- <https://docs.cubic.dev/configure/cubic-yaml> — file location, precedence, validation
- <https://docs.cubic.dev/ai-review/custom-agents> — the 5-agent cap, 10,000-character budget, `file_paths`
- <https://docs.cubic.dev/ai-review/custom-context> — auto-detected context files
- <https://docs.cubic.dev/ai-review/quickstart> — install and first-review flow
- <https://docs.cubic.dev/ai-review/ai-review-settings> — the dashboard page
- <https://docs.cubic.dev/ai-review/key-features> — what is posted on a PR
- <https://docs.cubic.dev/account/subscription> — pricing and the public-repo policy
- <https://docs.cubic.dev/account/roles-and-permissions> — org connection and roles
- <https://docs.cubic.dev/faq-and-troubleshooting> — the large-PR quota safeguard
- <https://github.com/apps/cubic-dev-ai> — the GitHub App
- `/Users/liamj/Documents/development/onyx/cubic.yaml` — the reference implementation
- GitHub API `GET /orgs/betteranswers/installations` — the installation facts in § 1

Repository files read for § 7:
`CODING_RULES.md`, `app/CODING_RULES.md`, `worker/CODING_RULES.md`, `AGENTS.md`,
`CONTEXT.md` (size only), `.oxlintrc.json`, `.gitignore`,
`THIRD_PARTY_NOTICES.md`, `docs/adr/0009-better-auth-in-process-identity-provider.md`,
`docs/adr/0027-better-answers-is-open-core-under-apache-2-0-the-hosted-service-is-the-product-copyleft-is-run-only.md`,
and the `docs/adr/` index.
