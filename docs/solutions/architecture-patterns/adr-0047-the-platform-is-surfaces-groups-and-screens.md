---
title: "The platform is a rail of areas, each holding groups of pages"
date: 2026-09-30
module: apps/web
problem_type: architecture_pattern
component: web
severity: medium
applies_when:
  - "Adding an area, a group or a page, or deciding where a page belongs"
  - "Giving one of a page's rows a page of its own at an address beneath the page"
  - "Deciding who sees a page, by role or by owning a domain"
  - "Changing a role's home, or what an unbuilt, hidden or moved address shows"
  - "Naming a level of the navigation in code, tests or docs"
tags:
  - adr-0047
  - area
  - page
  - rail
  - control-centre
  - inbox
  - visibility
  - home
  - detail-address
  - member-page
---

# The platform is a rail of areas, each holding groups of pages

## The decision

The platform's navigation has four levels, and the code names them the same way:

- A **area** is an entry in the icon rail.
- A **group** is a heading in the menu over some of an area's pages. An area may have none.
- A **page** has an address of its own and an icon in the menu.
- A **tab** divides one page. It has no address.

A page may also declare a **detail address**, one segment beneath its own, naming one of its rows. Members declares the first: a **member page** at `/people/members/<person>`. A detail address is the page's place, not a fifth level:

- Nothing lists it. It is not in the rail, the menu, or jump-to's pages and acts. Jump-to's member results lead to it.
- It is seen exactly where its page is seen, so a role that may not see Members gets the not-found page at a member page.
- The frame draws it as its page: the same first heading, the same keystroke scope, and the page's entry in the menu marked current. It draws no toolbar, because the page's tabs and acts belong to the list.
- The breadcrumb's last part is the row's name, which the page gives from what it has read. It is never read from the address.
- Only one segment is declared. Anything deeper names no place and shows the not-found page. A segment that is not a valid id, or an id the page holds no row for, draws a state inside the page that names no one and leads back to the page. A malformed id is asked about nowhere.
- A detail page's sections have no address. They are regions of one page, reached by in-page links and keystrokes, so Back leaves the page and returns to the list as it was.

One navigation list in `apps/web/src/shared/` declares every area, group and page, with its address, its detail address if it has one, whether it is built, and who may see it. The rail, the menu, the router, the breadcrumb and jump-to all read it. The shell is the ReUI app-shell-14 block (`https://reui.io/blocks/application/app-shell/app-shell-14`): a full-width top band over the icon rail and a menu that swaps with the area.

**The rail**, in order:

- **Ask**: asking, and the cited answers a person got. Every role sees it. It is the home of an Editor and a Viewer.
- **Knowledge**: the curated map. Its Browse group is every role's. Its Curation group is for Admins and owners.
- **The work area**: work produced from the knowledge for someone outside, question sets first. Its name waits for S6, which builds its first page.
- **Inbox**: what waits on the person. It is for Admins, and for the owner of any domain.
- **Control Centre**: the Admin's one area, in eight groups: Overview, Suggestions, Sources, Models, Questions, People, Personal data and System.
- **Briefings** joins at Then: what the platform tells a person unasked, such as sector and account signals, each cited.

The utilities sit at the rail's foot: Keyboard shortcuts today, and help and settings once they exist. The top band, not the rail, reaches the console from the workspace switcher and any visible page by jump-to (⌘K). The avatar menu reaches the Account page. Like the sign-in pages, it stands outside the shell, so a person with no workspace and the operator reach it too, and the no-workspace and choose-workspace pages link to it. The pending pages, confirm, recovery and setup, stand outside it too: a session that must confirm its second factor reaches them from the shell, the console and every page outside the shell, and from any read or change refused while it waits, and comes back to the address it left (ADR 0048).

**What v0.1 declares.** Page names are today's words. Pages built today are in bold.

| Area | Group | Pages (built today in bold) | Seen by |
|---|---|---|---|
| Ask | (none) | New question · Your questions | every role (home of Editor and Viewer) |
| Knowledge | Browse · Curation | Search · Guides · All knowledge · Due for verification · Conflicts · Kinds · Domains and owners · Exports | Browse: every role. Curation: Admins and owners |
| Inbox | (none) | Waiting on you | Admins and owners |
| Control Centre | Overview | Overview | Admin |
| | Suggestions | Queue | Admin |
| | Sources | **Connected sources** · Publishing rules · Priced plan · Backlogs · Removed at source · Share agents | Admin |
| | Models | **Models and spend** · Spending limit | Admin |
| | Questions | Answer audit · Answer tests | Admin |
| | People | **Members** · **Groups** · Personal tokens | Admin |
| | Personal data | Erasure and suppression | Admin |
| | System | **Audit log** · Signals · Health · Backups | Admin |
| Console (switcher) | People · Workspaces | **Everyone** · **Names waiting** · **Every workspace** | operator |

In Knowledge, Browse holds Search and Guides, and Curation holds the other six. The work area and Briefings are not declared yet.

Today's pages that the table does not list moved:

- Knowledge left Control Centre and became an area. Its review table is now All knowledge. Its conflicts and verification requests are now Conflicts and Due for verification.
- Promotions left Questions. A promotion is a suggestion, so it waits in Suggestions' queue, and the owner of the `Answer` domain reaches it through their Inbox.
- Owners left People for Knowledge's Domains and owners. Erasure and suppression moved to Personal data, and the audit log to System. Thresholds is not declared.
- The ceiling left Sources, and routes and spend left System, both for Agent Operations.

Control Centre's groups keep root addresses, `/<group>/<page>`, so today's addresses under `/people` and `/sources` still work. Two pages move: the audit log to `/system/audit-log`, and routes and spend to `/agent-operations/routes-and-spend`. For a person who may see a moved page, its old address leads to the new one. A page or group keeps every address it has had, so a page moved twice leads from both (glossary plan, KTD11).

**Who sees what.**

- A person sees a page by their role, or by owning a domain the page serves. A group or an area with no page the person may see is hidden whole.
- Owning a domain grants acts, so a Viewer may own one. Ownership lands with S3. Until then, visibility reads roles alone.
- The suggestion queue lives in Control Centre › Suggestions. A person's Inbox holds their own items and points into the queue.
- Control Centre is for Admins alone, so an Editor sees no Questions page there. An Editor who owns the `Answer` domain reaches its promotions through their Inbox. An Editor who owns nothing sees neither.
- An area, group or page that is not built appears nowhere: not in the rail, the menu or jump-to.
- A role's home always shows. Until it is built, it says plainly that it is on its way. Today that is Ask, for Editors and Viewers. An Admin's home is People › Members until Control Centre › Overview is built.
- An address that is not built, or that the person may not see, shows the same not-found page as an address that never existed, and offers the person's home.
- Whether a page is hidden is decided when the person arrives at it. A role that changes while they are on it takes effect at their next move, so an Admin who demotes themself still sees the act confirmed. While the role cannot be read, a page draws its own loading or failed state. A page reached in that state is decided when the role arrives, as though the person arrived then. From that point it keeps its verdict until their next move, like any other.
- Hiding is navigation only. The api still refuses every act by role.

**The console** stays the operator's separate area. It is reached from the workspace switcher, which lists it to the operator alone. It is a place, not an account setting.

**Agent Operations against Flux AgentOps.** The owner's reference for the group is the ReUI Flux AgentOps template (`https://flux-agentops.reui.io/`). Its ten pages land here:

- **Overview**: Control Centre › Overview. The idea is taken, not the form: one line for each thing that needs attention, with its action, and no cards of counts.
- **Runs**: a later Runs page in Agent Operations, for the producer's runs and the by-run revert.
- **Approvals**: Control Centre › Suggestions in v0.1, because nothing platform-prepared lands without acceptance (ADR 0012). At Then, an Approvals page in Agent Operations holds the acts an agent asks to take in a connected system.
- **Evals**: Questions › Answer tests. *Eval* is never a page word.
- **Flags**: no counterpart. A *flag* is a reader's feedback on an answer (ADR 0017).
- **Memory**: no counterpart. The agents' only memory is the map, read and curated in Knowledge (ADR 0016).
- **Tools**: a later Connected clients page in Agent Operations: the MCP surface's four entries and each client's scopes.
- **Providers**: Models › Models and spend, a model choice per purpose.
- **Costs**: Models › Models and spend, and Spending limit.
- **Settings**: a later Settings page in System, an index in which each setting stays with its object.

**The whole structure, beyond v0.1's list.** A block is named where the route names the page. The later stages are VISION's.

| Area | Built | v0.1 | Next, Then and Later |
|---|---|---|---|
| Ask | none; the home says it is on its way | New question, Your questions, and the concept page a hit or a citation opens (S2) | none yet |
| Knowledge | none | Search (S2). Guides, All knowledge, Kinds, Domains and owners (S3; S7 renames kinds). Due for verification, Conflicts (V1). Exports | What changed in your domains since your last visit. A map explorer. Imported bundles |
| The work area | none | Question sets (S6) | Next: opportunities, submissions, outcomes, recurring questionnaires. Then: renewal packs, account briefs, case studies. Later: content drafts |
| Briefings | none | none | Then: sector news, account signals, competitor activity |
| Inbox | none | Waiting on you, which S5 and V1 need and no block names | Then: approvals of acts an agent takes as the person |
| Control Centre | Connected sources. Models and spend. Members, Groups. Audit log | Overview, which no block names. Queue (S5). Priced plan (S4). Publishing rules, Backlogs, Removed at source. Spending limit (S7). Answer audit, Answer tests (S2). Personal tokens (P1). Erasure and suppression. Signals, Health, Backups (O1) | Share agents, with the share agent. Runs, Connected clients, Settings. Then: feeds and systems read live in Sources, Approvals in Agent Operations |
| Console | Everyone, Names waiting, Every workspace | none | The identity-set audit log |

Two things stay open:

- **The work area's name.** It waits for S6, which builds its first page.
- **Which area Search sits on**: Ask or Knowledge. v0.1's list declares it in Knowledge's Browse group.

## Why

- People come to do one of a few things: ask, read the map, produce work, decide what waits on them, or run the workspace. One person often does several. A rail of areas lets each reach the job they came for in one move. A rail of Control Centre's parts showed every role pages it could not use.
- Deciding is not only an Admin's job. An owner of any role decides edit suggestions and checks on their domain, and one of the personas is a Viewer who owns a specialism. So curation sits on Knowledge, what waits on a person sits in their Inbox, and ownership, not role alone, decides what they see.
- Unpublished content is shown to Admins alone, in Control Centre. A suggestion's payload can come from an unpublished connected source, so the queue stays in Control Centre, and each Inbox points into it.
- A withheld concept must be indistinguishable from one that does not exist. An address that says "not for you" or "not built yet" tells a person what exists. Nobody should learn what exists by guessing addresses.
- The infrequent reader forgets the tool between visits. A few plainly named areas, with nothing listed that cannot be opened, are what such a reader holds.
- Control Centre's groups each hold their own pages, as Flux AgentOps' do. One noun per thing an Admin answers for is what a person holds without reading (ADR 0017). Questions stays apart from Agent Operations: what the platform answered is a matter of content, and what its agents did is a matter of operations and spend. Personal data stays apart from People: a subject request runs on its own one-month clock.
- The v0.1 route planned only what v0.1 builds, so nothing recorded the wider structure. Declaring it now means the shell built for v0.1 needs no restructuring after it.

## Rejected

- One flat rail of Control Centre's six parts, filtered by role: the rail holds areas, and Control Centre's groups each hold their own pages.
- No Inbox: an owner's checks and edit suggestions would have no page.
- Every suggestion kind in the Inbox: unpublished content is shown to Admins only in Control Centre.
- Curation staying in Control Centre: an owner who is not an Admin could not reach it.
- Owners required to be Editors: a Viewer may own a specialism.
- Filtering whole rail entries only, rather than each page.
- Unbuilt entries marked "Soon", or kept as destinations that say they are not built, as T-225 had them: nobody learns what exists by guessing addresses.
- Personal data kept in People, or Questions folded into Agent Operations.
- The console in the avatar menu: it is a place, not an account setting.
- A member page as a route written beside the generated ones, outside the list: the visibility gate, the frame and the breadcrumb would each need a second source. The list declares it instead.
- An address for each section of a member page: a section is part of one page, and only a page has an address.

## History

Written 30/09/2026 from the shell and layout foundations plan (`docs/plans/2026-09-30-1959-feat-shell-and-layout-foundations-plan.md`), the gap audit behind it (`docs/dogfood-reports/2026-09-30-docs-shell-people-dogfood-dogfood.md`) and the owner's decisions of that day. It has no archived record. It re-cut ADR 0017's six pages of Control Centre into eight groups and made ADR 0046's reader area the Ask area, and both were edited in the same change.

Amended 02/10/2026 by the people layout rework plan (`docs/plans/2026-10-01-1807-feat-people-layout-rework-plan.md`, KTD3). A member now opens as a page, not a sheet over Members, so the list gained detail addresses and Members declared the member page. The four levels and every rule above stand.

Amended 02/10/2026 by the sign-in and security plan (`docs/plans/2026-10-01-2241-feat-people-sign-in-and-security-plan.md`, KTD11). The Account page now exists, outside the shell beside the display-name page, with its Sign-in section. Every frame, a workspace's and the console's, offers a person holding no passkey one above its toolbar, once, until they dismiss it; the offer links to the Account page's add. The four levels and every rule above stand.

Amended 03/10/2026 by the glossary plan (`docs/plans/2026-10-02-2325-docs-glossary-in-the-readers-words-plan.md`, KTD1 and KTD5). The glossary rewrite settled the trust words, the third thing this record left open, and ADR 0019 now lists them. It also set the direction for every name. One word holds everywhere: the reader's word heads the glossary entry, and code, types, database tables and columns, contracts and live docs are renamed to it, one noun at a time. Names the platform does not own keep theirs: OKF's vocabulary and the keys the platform writes into concept files (`iri`, `sources[].locator`); names on the wire, which are MCP entry names, MCP tool schema keys and values, token scopes and refusal words; names a library or protocol owns, such as OAuth's and Better Auth's; and stored history, which is audit action names and detail keys, migrations, old page addresses, `docs/archive/` and completed plans in `docs/plans/`. An old word leaves the glossary for `apps/api/tests/old-words.ts`, which only the words test reads. The navigation's levels have reader words now, *area* for an entry in the rail and *page* for a place with an address of its own, and this record takes them when the pages sweep renames the code. The four levels and every rule above stand.

Amended 05/10/2026 by the glossary plan (`docs/plans/2026-10-02-2325-docs-glossary-in-the-readers-words-plan.md`, U9 and KTD11). Control Centre's Agent Operations group is now **Models**: Routes and spend is *Models and spend* at `/models/models-and-spend`, and Ceiling is *Spending limit*. Both older addresses of the page lead to it. The Flux AgentOps comparison above keeps the group's old name, because where its later pages (Runs, Approvals, Connected clients) land is open until one is built. The four levels and every rule above stand.
