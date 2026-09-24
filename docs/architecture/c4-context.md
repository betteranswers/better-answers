# System context — Better Answers

Level 1. The platform as one system: who uses it, which systems it talks to, and in which block of the route each outside system first matters. The people are the route spec's user stories; the systems are the ADRs' — sign-in and SharePoint (ADRs 0034, 0013), the model routes (ADRs 0020, 0025), the backups (ADR 0022).

```mermaid
C4Context
  title System context — Better Answers, a living company knowledge map

  Person(admin, "Admin", "Binds sources, reviews findings, publishes, decides every suggestion, manages people and thresholds")
  Person(editor, "Editor", "A bid writer: types and edits concepts, writes guide Briefs, asks, saves Answers, answers a question set")
  Person(viewer, "Viewer", "Reads, searches, opens a concept and its evidence, flags an answer")
  Person(operator, "Operator", "Provisions a workspace and its first member, releases by digest, runs the drill and the ops commands")
  Person_Ext(subject, "Person named in a document", "Whose data the company holds; withheld by default, erased to a pseudonym on a valid request")

  System(platform, "Better Answers", "Sources to concepts to a derived map, with the records the platform keeps over them; one origin, app. on the client's apex")

  System_Ext(claude, "Claude and Claude Code", "The MCP client: find, ask, open and give_feedback as the signed-in person, by OAuth; personal tokens are P1's")
  System_Ext(m365, "Microsoft 365", "Entra sign-in on an exact invited-email match; SharePoint libraries read through Graph")
  System_Ext(website, "The client's public website", "Bound per URL prefix, enumerated and indexed on a cadence, no JavaScript rendering")
  System_Ext(models, "Model providers", "Per-workspace routes by purpose: extraction, enrichment, answering, judging; embedding held in reserve")
  System_Ext(email, "Email over SMTP", "Sign-in codes today; invitations from P1, the alert email from O1")
  System_Ext(backups, "Off-host buckets and the dead-man switch", "Encrypted dumps and git bundles under governance lock, the object-store mirror, healthchecks.io's checks")

  Rel(admin, platform, "Runs the gates and Control Centre in", "HTTPS")
  Rel(editor, platform, "Writes knowledge and asks in", "HTTPS")
  Rel(viewer, platform, "Reads and flags in", "HTTPS")
  Rel(operator, platform, "Provisions, releases and drills", "pnpm ops; a release.yml dispatch")
  Rel(subject, platform, "Is named in documents; requests access or erasure through the company")

  Rel(admin, claude, "Works from")
  Rel(editor, claude, "Works from")
  Rel(claude, platform, "Calls the four MCP entries of", "MCP over HTTPS, OAuth 2.1 with PKCE")

  Rel(platform, m365, "Signs people in with; enumerates libraries of", "OIDC, Microsoft Graph")
  Rel(platform, website, "Fetches pages of", "HTTPS")
  Rel(platform, models, "Calls per route, every call a row", "Messages-API-shaped HTTPS")
  Rel(platform, email, "Sends through", "SMTP")
  Rel(platform, backups, "Copies dumps, bundles and mirrors to; pings each scheduled job's check", "S3, HTTPS")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## What the diagram claims

- **One system, one origin.** The product, sign-in, consent, the authorization server, discovery and the MCP surface all sit on `app.<apex>` (ADR 0034). There is no second server for agents; the MCP client is the same person under the same predicate and the same audit (stories 38 and 39). The bearer comes from OAuth consent; the *personal token* minted on the Account page is P1's and not built.
- **The person named in a document never signs in.** Their relation to the platform is through the company — a document that names them, an Admin who records their request — which is why they are drawn outside.
- **Three of the six outside systems are not reached until a route block lands them.** Microsoft sign-in is P1's, SharePoint and the website are S4's, the model providers are S2's for answering and judging and S7's for extraction. The embedding route is fixed and unread until S8's trigger; no v0.1 block embeds (ADRs 0016 and 0020 as amended 2026-09-09).
- **Email and the backups exist today.** Sign-in by email code, the hourly to monthly dumps, the nightly mirror and git bundles are built and drilled; an invitation email is P1's and the alert email O1's; every restore replays the erasures completed after its dump — `restore-drill.sh` and `restore-production.sh` run `pnpm ops replay-erasures` before `api` answers. The dead-man switch hears from every scheduled job, the api's head check and daily sweeps among them (`c4-dynamic-scheduled-work.md`).
- **The operator works through the api container and a workflow.** Provisioning, adding a member, importing a bundle and the drill's steps are `pnpm ops` commands; a *release* is a `release.yml` dispatch that sets the platform stack's digests in Coolify and deploys (`c4-deployment.md`).

## Not on this diagram

The share agent and `/agent/v1` (ADR 0008; out of scope for v0.1), the customer-hosted worker (v1.0), imported and vendor bundles, and the build and release pipeline and the Cloudflare edge — which are infrastructure and are drawn on `c4-deployment.md`.
