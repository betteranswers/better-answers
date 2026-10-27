---
title: "The platform is a rail of areas, each holding menu groups of pages"
date: 2026-09-30
module: apps/web
problem_type: architecture_pattern
component: web
severity: medium
applies_when:
  - "Adding an area, a menu group or a page, or deciding where a page belongs"
  - "Giving one of a page's rows a page of its own at an address beneath the page"
  - "Deciding who sees a page, by role or by owning a collection"
  - "Changing a role's home, or what an unbuilt, hidden or moved address shows"
  - "Naming a level of the navigation in code, tests or docs"
  - "Renaming a word the glossary changed, and deciding when the code follows"
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
  - concept-page
  - knowledge-base
  - rename-batch
---

# The platform is a rail of areas, each holding menu groups of pages

## The decision

The platform's navigation has four levels, and the code names them the same way:

- An **area** is an entry in the icon rail.
- A **menu group** is a heading in the menu over some of an area's pages. An area may have none.
- A **page** has an address of its own and an icon in the menu.
- A **tab** divides one page. It has no address.

A page may also declare a **detail address**, one segment beneath its own, naming one of its rows. Members declares the first: a **member page** at `/people/members/<person>`. Search declares the second: the **concept page** at `/knowledge/search/<ulid>`, opened by a match or a citation. A detail address is the page's place, not a fifth level:

- Nothing lists it. It is not in the rail, the menu, or jump-to's pages and actions. Jump-to's member results lead to it.
- It is seen exactly where its page is seen, so a role that may not see Members gets the not-found page at a member page.
- The frame draws it as it draws its page: the same first heading, the same keystroke scope, and the page's entry in the menu marked current. It draws no toolbar, because the page's tabs belong to the list.
- The breadcrumb's last part is the row's name, which the page gives from what it has read. It is never read from the address.
- Only one segment is declared. Anything deeper names no place and shows the not-found page. A segment that is not a valid id, or an id the page holds no row for, draws a state inside the page. That state names no one and leads back to the page. A malformed id is asked about nowhere.
- A detail page's sections have no address. They are regions of one page, reached by in-page links and keystrokes, so Back leaves the page and returns to the list as it was.

One navigation list in `apps/web/src/shared/` declares every area, menu group and page, with its address, its detail address if it has one, whether it is built, and who may see it. The rail, the menu, the router, the breadcrumb and jump-to all read it. The shell is the ReUI app-shell-14 block (`https://reui.io/blocks/application/app-shell/app-shell-14`): a full-width top band over the icon rail and a menu that swaps with the area.

**The rail**, in order:

- **Ask**: asking, and the cited answers a person got. Every role sees it. It is the home of an Editor and a Viewer.
- **Knowledge**: the curated map. Its Browse menu group is every role's. Its Curation menu group is for Admins and owners.
- **The work area**: work produced from the knowledge for someone outside, question sets first. Its name waits for S6, which builds its first page.
- **Inbox**: what waits on the person. It is for Admins, and for the owner of any collection or concept.
- **Control Centre**: the Admin's one area, in eight menu groups: Overview, Suggestions, Sources, Models, Questions, People, Personal data and System.
- **Briefings** joins at Then: what the platform tells a person unasked, such as sector and account signals, each cited.

The utilities sit at the rail's foot: Keyboard shortcuts today, and help and settings once they exist. The top band, not the rail, reaches the console from the workspace switcher and any visible page by jump-to (⌘K). The avatar menu reaches the Account page. Like the sign-in pages, its address stands outside the shell, so a person with no workspace and the operator reach it too. The no-workspace and choose-workspace pages link to it. A member with a workspace open sees it drawn in that workspace's frame. The pending pages (confirm, recovery and setup) stand outside the shell too. A session that must confirm its second factor reaches them from the shell, the console and every page outside the shell, and from any read or change refused while it waits. It then comes back to the address it left (ADR 0048).

**What v0.1 declares.** Page names are today's words. Pages built today are in bold.

| Area | Menu group | Pages (built today in bold) | Seen by |
|---|---|---|---|
| Ask | (none) | **New question** · **Your questions** · **Connect Claude** | every role (New question is the home of Editor and Viewer) |
| Knowledge | Browse · Curation | **Search** · Guides · **Knowledge base** · All knowledge · Due for verification · Conflicts · Kinds · **Collections and owners** · Exports | Browse: every role. Curation: Admins and owners of a collection |
| Inbox | (none) | Waiting on you | Admins and owners of any collection or concept |
| Control Centre | Overview | Overview | Admin |
| | Suggestions | To decide | Admin |
| | Sources | **Connected sources** · Publishing rules · Cost estimates · Backlogs · Removed at source · Share agents | Admin |
| | Models | **Models and spend** · Spending limit | Admin |
| | Questions | **Questions asked** · **Answer tests** | Admin |
| | People | **Members** · **Groups** · Personal tokens | Admin |
| | Personal data | Erasure and suppression | Admin |
| | System | **Audit log** · Signals · Health · Backups | Admin |
| Console (switcher) | People · Workspaces | **Everyone** · **Names waiting** · **Every workspace** | operator |

In Knowledge, Browse holds Search, Guides and Knowledge base, and Curation holds the other six. Knowledge base lists the concept index under the read predicate, by collection and kind. It is not the map explorer under Next, because it lists the index and walks no links. The work area and Briefings are not declared yet.

Today's pages that the table does not list moved:

- Knowledge left Control Centre and became an area. Its review table is now All knowledge. Its conflicts and verification requests are now Conflicts and Due for verification.
- Promotions left Questions. A promotion is a suggestion, so it waits in Suggestions › To decide, and the owner of the `Answer` collection reaches it through their Inbox.
- Owners left People for Knowledge's Collections and owners. Erasure and suppression moved to Personal data, and the audit log to System. Thresholds is not declared.
- The ceiling left Sources as Spending limit, and routes and spend left System as Models and spend, both for Models.

Control Centre's menu groups keep root addresses, `/<group>/<page>`, so today's addresses under `/people` and `/sources` still work. Two pages move: the audit log to `/system/audit-log`, and routes and spend to `/models/models-and-spend` by way of `/agent-operations/routes-and-spend`. For a person who may see a moved page, its old address leads to the new one. A page or menu group keeps every address it has had, so a page moved twice leads from both (glossary plan, KTD11).

**Who sees what.**

- A person sees a page by their role, by owning a collection the page serves, or, for Inbox › Waiting on you, by owning any concept they may read, through its collection or its own override. A menu group or an area with no page the person may see is hidden whole.
- Owning grants actions, so a Viewer may own a collection or a concept. The member read carries what the person owns beside their role, so ownership is decided from the same answer as the role, with no second read to wait on.
- An owner decides an *edit* suggestion in Inbox › Waiting on you, on the item's own address. Every other kind waits in Control Centre › Suggestions › To decide, and a person's Inbox points into it for those. An Admin's Waiting on you lists every *edit*, each owned one naming its owner, so an Admin reaches an owned concept's edit from a page.
- Control Centre is for Admins alone, so an Editor sees no Questions page there. An Editor who owns the `Answer` collection reaches its promotions through their Inbox. An Editor who owns nothing sees neither.
- An area, menu group or page that is not built appears nowhere: not in the rail, the menu or jump-to.
- A role's home always shows. Until it is built, it says plainly that it is on its way. An Editor's and a Viewer's home is Ask › New question. An Admin's home is People › Members until Control Centre › Overview is built.
- An address that is not built, or that the person may not see, shows the same not-found page as an address that never existed, and offers the person's home. A member sees it inside the frame, named in the breadcrumb. Anyone else sees it in the sign-in pages' layout, and a signed-out visitor is offered sign-in instead.
- Whether a page is hidden is decided when the person arrives at it. A role that changes while they are on it takes effect at their next move, so an Admin who demotes themself still sees the action confirmed. While the role cannot be read, a page draws its own loading or failed state. A page reached in that state is decided when the role arrives, as though the person arrived then. From that point it keeps its verdict until their next move, like any other. An ownership change takes effect the same way, at the person's next move. A page whose own read the api refuses by ownership reads the member again and is decided again, as though the person arrived then.
- Hiding is navigation only. The api still refuses every action, by role or by ownership.

**The console** stays the operator's separate area. It is reached from the workspace switcher, which lists it to the operator alone. It is a place, not an account setting.

**Agent Operations against Flux AgentOps.** The owner's reference for the menu group is the ReUI Flux AgentOps template (`https://flux-agentops.reui.io/`). Its ten pages land here:

- **Overview**: Control Centre › Overview. The idea is taken, not the form: one line for each thing that needs attention, with its action, and no cards of counts.
- **Runs**: a later Runs page in Agent Operations, for the producer's runs and the by-run revert.
- **Approvals**: Control Centre › Suggestions in v0.1, because nothing platform-prepared lands without acceptance (ADR 0012). At Then, an Approvals page in Agent Operations holds the actions an agent asks to take in a connected system.
- **Evals**: Questions › Answer tests. *Eval* is never a page word.
- **Flags**: no counterpart. A *flag* is a reader's feedback on an answer (ADR 0017).
- **Memory**: no counterpart. The agents' only memory is the map, read and curated in Knowledge (ADR 0016).
- **Tools**: a later Connected assistants page in Agent Operations: the MCP surface's four entries and each assistant's scopes.
- **Providers**: Models › Models and spend, a model choice per purpose.
- **Costs**: Models › Models and spend, and Spending limit.
- **Settings**: a later Settings page in System, an index in which each setting stays with its object.

**The whole structure, beyond v0.1's list.** A block is named where the route names the page. The later stages are VISION's.

| Area | Built | v0.1 | Next, Then and Later |
|---|---|---|---|
| Ask | New question, Your questions, Connect Claude | none | none yet |
| Knowledge | Search, and the concept page, its detail. Knowledge base. Collections and owners | Guides, All knowledge, Kinds (S3; S7 renames kinds). Due for verification, Conflicts (V1). Exports | What changed in your collections since your last visit. A map explorer. Imported bundles |
| The work area | none | Question sets (S6) | Next: opportunities, submissions, outcomes, recurring questionnaires. Then: renewal packs, account briefs, case studies. Later: content drafts |
| Briefings | none | none | Then: sector news, account signals, competitor activity |
| Inbox | none | Waiting on you, which S3 builds and S5 and V1 add their queues to | Then: approvals of actions an agent takes as the person |
| Control Centre | Connected sources. Models and spend. Questions asked, Answer tests. Members, Groups. Audit log | Overview, which no block names. To decide (S5). Cost estimates (S4). Publishing rules, Backlogs, Removed at source. Spending limit (S7). Personal tokens (P1). Erasure and suppression, Signals, Health, Backups (O1) | Share agents, with the share agent. Runs, Connected assistants, Settings. Then: feeds and systems read live in Sources, Approvals in Agent Operations |
| Console | Everyone, Names waiting, Every workspace | none | The identity-set audit log |

One thing stays open: **the work area's name**. It waits for S6, which builds its first page.

## Why

- People come to do one of a few things: ask, read the map, produce work, decide what waits on them, or run the workspace. One person often does several. A rail of areas lets each reach the job they came for in one move. A rail of Control Centre's parts showed every role pages it could not use.
- Deciding is not only an Admin's job. An owner of any role decides edit suggestions and checks on their collection, and one of the personas is a Viewer who owns a specialism. So curation sits on Knowledge, what waits on a person sits in their Inbox, and ownership, not role alone, decides what they see.
- Unpublished content is shown to Admins alone, in Control Centre. A suggestion's payload can come from an unpublished connected source, so To decide stays in Control Centre, and each Inbox points into it.
- A withheld concept must be indistinguishable from one that does not exist. An address that says "not for you" or "not built yet" tells a person what exists. Nobody should learn what exists by guessing addresses.
- The infrequent reader forgets the tool between visits. Such a reader holds a few plainly named areas, with nothing listed that cannot be opened.
- Control Centre's menu groups each hold their own pages, as Flux AgentOps' do. One noun per thing an Admin answers for is what a person holds without reading (ADR 0017). Questions stays apart from Models: what the platform answered is a matter of content, and what its agents did is a matter of operations and spend. Personal data stays apart from People: a subject request runs on its own one-month clock.
- The v0.1 route planned only what v0.1 builds, so nothing recorded the wider structure. Declaring it now means the shell built for v0.1 needs no restructuring after it.

## Rejected

- One flat rail of Control Centre's six parts, filtered by role: the rail holds areas, and Control Centre's menu groups each hold their own pages.
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
- The concept page on Ask, or as a new kind of navigation entry: Ask's home is not built, so an Admin would not see a detail beneath it, and a new kind for one page waits for a second page that needs it.
