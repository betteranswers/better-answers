---
title: "The platform is a rail of surfaces, each holding groups of screens"
date: 2026-09-30
module: apps/web
problem_type: architecture_pattern
component: web
severity: medium
applies_when:
  - "Adding a surface, a group or a screen, or deciding where a screen belongs"
  - "Deciding who sees a screen, by role or by owning a domain"
  - "Changing a role's home, or what an unbuilt, hidden or moved address shows"
  - "Naming a level of the navigation in code, tests or docs"
tags:
  - adr-0047
  - surface
  - screen
  - rail
  - control-centre
  - inbox
  - visibility
  - home
---

# The platform is a rail of surfaces, each holding groups of screens

## The decision

The platform's navigation has four levels, and the code names them the same way:

- A **surface** is an entry in the icon rail.
- A **group** is a heading in the secondary nav over some of a surface's screens. A surface may have none.
- A **screen** has an address of its own and an icon in the secondary nav.
- A **tab** divides one screen. It has no address.

One navigation list in `apps/web/src/shared/` declares every surface, group and screen, with its address, whether it is built, and who may see it. The rail, the secondary nav, the router, the breadcrumb and jump-to all read it. The shell is the ReUI app-shell-14 block (`https://reui.io/blocks/application/app-shell/app-shell-14`): a full-width top band over the icon rail and a secondary nav that swaps with the surface.

**The rail**, in order:

- **Ask**: asking, and the cited answers a person got. Every role sees it. It is the home of an Editor and a Viewer.
- **Knowledge**: the curated map. Its Browse group is every role's. Its Curation group is for Admins and owners.
- **The work surface**: work produced from the knowledge for someone outside, question sets first. Its name waits for S6, which builds its first screen.
- **Inbox**: what waits on the person. It is for Admins, and for the owner of any domain.
- **Control Centre**: the Admin's one surface, in eight groups: Overview, Suggestions, Sources, Agent Operations, Questions, People, Personal data and System.
- **Briefings** joins at Then: what the platform tells a person unasked, such as sector and account signals, each cited.

The utilities sit at the rail's foot: Keyboard shortcuts today, and help and settings once they exist. The top band, not the rail, reaches three places. The console is reached from the workspace switcher, the Account page from the avatar menu, and any visible screen by jump-to (⌘K).

**What v0.1 declares.** Screen names are today's words. Screens built today are in bold.

| Surface | Group | Screens (built today in bold) | Seen by |
|---|---|---|---|
| Ask | (none) | New question · Your questions | every role (home of Editor and Viewer) |
| Knowledge | Browse · Curation | Search · Guides · All knowledge · Checks due · Conflicts · Kinds · Domains and owners · Exports | Browse: every role. Curation: Admins and owners |
| Inbox | (none) | Waiting on you | Admins and owners |
| Control Centre | Overview | Overview | Admin |
| | Suggestions | Queue | Admin |
| | Sources | **Bindings** · Publish and accept gates · Priced plan · Backlogs · Gone-at-source impact · Agent tokens | Admin |
| | Agent Operations | **Routes and spend** · Ceiling | Admin |
| | Questions | Answer audit · Answer tests | Admin |
| | People | **Members** · **Groups** · Tokens | Admin |
| | Personal data | Erasure and suppression | Admin |
| | System | **Audit log** · Signals · Health · Backups | Admin |
| Console (switcher) | People · Workspaces | **Everyone** · **Names waiting** · **Every workspace** | operator |

In Knowledge, Browse holds Search and Guides, and Curation holds the other six. The work surface and Briefings are not declared yet.

Today's screens that the table does not list moved:

- Knowledge left Control Centre and became a surface. Its review table is now All knowledge. Its conflicts and verification requests are now Conflicts and Checks due.
- Promotions left Questions. A promotion is a suggestion, so it waits in Suggestions' queue, and the owner of the `Answer` domain reaches it through their Inbox.
- Owners left People for Knowledge's Domains and owners. Erasure and suppression moved to Personal data, and the audit log to System. Thresholds is not declared.
- The ceiling left Sources, and routes and spend left System, both for Agent Operations.

Control Centre's groups keep root addresses, `/<group>/<screen>`, so today's addresses under `/people` and `/sources` still work. Two screens move: the audit log to `/system/audit-log`, and routes and spend to `/agent-operations/routes-and-spend`. For a person who may see a moved screen, its old address leads to the new one.

**Who sees what.**

- A person sees a screen by their role, or by owning a domain the screen serves. A group or a surface with no screen the person may see is hidden whole.
- Owning a domain grants acts, so a Viewer may own one. Ownership lands with S3. Until then, visibility reads roles alone.
- The suggestion queue lives in Control Centre › Suggestions. A person's Inbox holds their own items and points into the queue.
- Control Centre is for Admins alone, so an Editor sees no Questions screen there. An Editor who owns the `Answer` domain reaches its promotions through their Inbox. An Editor who owns nothing sees neither.
- A surface, group or screen that is not built appears nowhere: not in the rail, the secondary nav or jump-to.
- A role's home always shows. Until it is built, it says plainly that it is on its way. Today that is Ask, for Editors and Viewers. An Admin's home is People › Members until Control Centre › Overview is built.
- An address that is not built, or that the person may not see, shows the same not-found screen as an address that never existed, and offers the person's home.
- Hiding is navigation only. The api still refuses every act by role.

**The console** stays the operator's separate surface. It is reached from the workspace switcher, which lists it to the operator alone. It is a place, not an account setting.

**Agent Operations against Flux AgentOps.** The owner's reference for the group is the ReUI Flux AgentOps template (`https://flux-agentops.reui.io/`). Its ten screens land here:

- **Overview**: Control Centre › Overview. The idea is taken, not the form: one line for each thing that needs attention, with its action, and no cards of counts.
- **Runs**: a later Runs screen in Agent Operations, for the producer's runs and the by-run revert.
- **Approvals**: Control Centre › Suggestions in v0.1, because nothing platform-prepared lands without acceptance (ADR 0012). At Then, an Approvals screen in Agent Operations holds the acts an agent asks to take in a connected system.
- **Evals**: Questions › Answer tests. *Eval* is never a screen word.
- **Flags**: no counterpart. A *flag* is a reader's feedback on an answer (ADR 0017).
- **Memory**: no counterpart. The agents' only memory is the map, read and curated in Knowledge (ADR 0016).
- **Tools**: a later Connected clients screen in Agent Operations: the MCP surface's four entries and each client's scopes.
- **Providers**: Agent Operations › Routes and spend, a route per purpose.
- **Costs**: Agent Operations › Routes and spend, and Ceiling.
- **Settings**: a later Settings screen in System, an index in which each setting stays with its object.

**The whole structure, beyond v0.1's list.** A block is named where the route names the screen. The later stages are VISION's.

| Surface | Built | v0.1 | Next, Then and Later |
|---|---|---|---|
| Ask | none; the home says it is on its way | New question, Your questions, and the concept page a hit or a citation opens (S2) | none yet |
| Knowledge | none | Search (S2). Guides, All knowledge, Kinds, Domains and owners (S3; S7 renames kinds). Checks due, Conflicts (V1). Exports | What changed in your domains since your last visit. A map explorer. Imported bundles |
| The work surface | none | Question sets (S6) | Next: opportunities, submissions, outcomes, recurring questionnaires. Then: renewal packs, account briefs, case studies. Later: content drafts |
| Briefings | none | none | Then: sector news, account signals, competitor activity |
| Inbox | none | Waiting on you, which S5 and V1 need and no block names | Then: approvals of acts an agent takes as the person |
| Control Centre | Bindings. Routes and spend. Members, Groups. Audit log | Overview, which no block names. Queue (S5). Priced plan (S4). Publish and accept gates, Backlogs, Gone-at-source impact. Ceiling (S7). Answer audit, Answer tests (S2). Tokens (P1). Erasure and suppression. Signals, Health, Backups (O1) | Agent tokens, with the share agent. Runs, Connected clients, Settings. Then: feeds and referenced systems in Sources, Approvals in Agent Operations |
| Console | Everyone, Names waiting, Every workspace | none | The identity-set audit log |

Three things stay open:

- **The work surface's name.** It waits for S6, which builds its first screen.
- **Which surface Search sits on**: Ask or Knowledge. v0.1's list declares it in Knowledge's Browse group.
- **The trust words.** The owner's vocabulary review of 28/09/2026 agreed a direction, deferred to the pre-S2 glossary rewrite. The glossary gives the reader's word, marks implementation terms as internal, and keeps no separate table of words. *Checked by* becomes *Verified by*, and *Unchecked* becomes *Unverified*, which OKF's `verified [{by, at}]` supports. *Score*, *confidence* and *trusted* stay banned. This record changes none of them. The same rewrite may rename screens, and it changes no structure.

## Why

- People come to do one of a few things: ask, read the map, produce work, decide what waits on them, or run the workspace. One person often does several. A rail of surfaces lets each reach the job they came for in one move. A rail of Control Centre's parts showed every role screens it could not use.
- Deciding is not only an Admin's job. An owner of any role decides edit suggestions and checks on their domain, and one of the personas is a Viewer who owns a specialism. So curation sits on Knowledge, what waits on a person sits in their Inbox, and ownership, not role alone, decides what they see.
- Unpublished content is shown to Admins alone, in Control Centre. A suggestion's payload can come from an unpublished binding, so the queue stays in Control Centre, and each Inbox points into it.
- A withheld concept must be indistinguishable from one that does not exist. An address that says "not for you" or "not built yet" tells a person what exists. Nobody should learn what exists by guessing addresses.
- The infrequent reader forgets the tool between visits. A few plainly named surfaces, with nothing listed that cannot be opened, are what such a reader holds.
- Control Centre's groups each hold their own screens, as Flux AgentOps' do. One noun per thing an Admin answers for is what a person holds without reading (ADR 0017). Questions stays apart from Agent Operations: what the platform answered is a matter of content, and what its agents did is a matter of operations and spend. Personal data stays apart from People: a subject request runs on its own one-month clock.
- The v0.1 route planned only what v0.1 builds, so nothing recorded the wider structure. Declaring it now means the shell built for v0.1 needs no restructuring after it.

## Rejected

- One flat rail of Control Centre's six parts, filtered by role: the rail holds surfaces, and Control Centre's groups each hold their own screens.
- No Inbox: an owner's checks and edit suggestions would have no screen.
- Every suggestion kind in the Inbox: unpublished content is shown to Admins only in Control Centre.
- Curation staying in Control Centre: an owner who is not an Admin could not reach it.
- Owners required to be Editors: a Viewer may own a specialism.
- Filtering whole rail entries only, rather than each screen.
- Unbuilt entries marked "Soon", or kept as destinations that say they are not built, as T-225 had them: nobody learns what exists by guessing addresses.
- Personal data kept in People, or Questions folded into Agent Operations.
- The console in the avatar menu: it is a place, not an account setting.

## History

Written 30/09/2026 from the shell and layout foundations plan (`docs/plans/2026-09-30-1959-feat-shell-and-layout-foundations-plan.md`), the gap audit behind it (`docs/dogfood-reports/2026-09-30-docs-shell-people-dogfood-dogfood.md`) and the owner's decisions of that day. It has no archived record. It re-cut ADR 0017's six screens of Control Centre into eight groups and made ADR 0046's reader surface the Ask surface, and both were edited in the same change.
