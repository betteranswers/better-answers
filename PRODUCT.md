# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staff of UK small and medium-sized businesses, typically 10 to 50 people, where one person often wears two or three hats. `docs/personas/personas.md` holds the full set. The four primary for v0.1:

- **Founder-Operator** (Admin, weekly): sees where the company's knowledge is weak and trusts what goes out in its name. Not a developer; uses Word, email and a few web apps.
- **Bid Writer** (Editor, daily, intense near deadlines): answers question sets fast from proven, current Answers. Cares about speed and knowing an answer is still true. Heavy assistant user.
- **Knowledge Curator** (Admin, or Editor and owner, two or three times a week): keeps the map accurate, checked and complete, with proof that it was checked.
- **Occasional Expert** (Viewer and owner of a specialism, once or twice a month): finds and checks one thing when a colleague asks, from a cold start, in under a minute.

Agents are users too. Platform agents (producer and consumer) work through the MCP server, plugins and skills. External agents, such as a person's Claude Desktop, read through the remote MCP surface (`find`, `ask`, `open`, `give_feedback`). An agent reads what its person's role allows and may suggest changes; a person decides every suggestion.

## Product Purpose

better-answers is a living map of a company's own knowledge. People and agents rely on it to run business activities, and every answer it gives is cited, permission-aware and explainable.

A company's knowledge is scattered across systems, documents and heads; it is duplicated, contradictory and stale. AI pointed at it answers confidently, wrongly and without a trail. The map is an asset that grows with the business, so each new AI use case costs less and carries less risk than the last. Where a company has no formal governance, the map is the practical way to get some.

Success means a person or agent can use the company's knowledge with confidence: find it, see where it came from, judge how far to trust it, and fix a fault where it starts.

## Positioning

The knowledge is held in the Open Knowledge Format (OKF v0.2): one portable file per concept that a person can read without the platform and that belongs to the company. Every concept shows a consumer its provenance, trust, freshness and lifecycle, and an attested computation also shows its attestation. Every answer cites its sources, enforced by the platform rather than optional. Neighbouring products (Guru, Glean, Dust, Onyx, Consilience) index and answer; better-answers curates an explicit, portable, trust-carrying map and closes the loop from use-case outcomes back into the knowledge.

## Operating Context

- Three knowledge layers: **sources** (the company's systems and documents, copied or read live) → **bundles** (curated OKF concepts) → the **map** (derived). **Records** are what the platform keeps because it runs use cases (guides, write-ups, usage, opportunities, audit), citing concepts by IRI.
- One deployment holds many **workspaces**; a workspace is one company.
- The web app's areas: **Ask** (a question, a cited answer, and what it could not answer), **Knowledge** (search, guides, concepts), **Inbox** (what waits on a person), and the **Control Centre** (the Admin area: Overview, Suggestions, Sources, Models, Questions, People, Personal data, System).
- Bid work happens against UK public procurement: question sets such as the Common Assessment Standard and PPN 03/24 SSQ, G-Cloud, and portals such as Proactis, Jaggaer, Atamis and In-tend, with per-question character and word limits. Detail content is copied into tender documents.
- Work also reaches people where it happens: Claude Desktop, Asana, Notion or Teams through the MCP surface.

## Capabilities and Constraints

- v0.1 (single source of truth): product, service and sector guides; bid libraries as `Answer` concepts; search and cited Q&A; answers to a question set drawn from the knowledge with citations; an MCP server whose entries read the knowledge, plus `give_feedback`, which records feedback; the Control Centre; sensitivity, roles and coverage.
- Next: opportunities, versioned packs, extracted question sets, responses, submissions, outcomes, and the outcome loop. Then: renewal packs, intelligence feeds, proposals and prospecting. Later: marketing campaigns and broader sources.
- Concepts are not one shape. OKF `type` is a free string and concept types appear as producers write concepts; the bid-library `Answer` concepts in the first deployment are one collection among many that OKF producers will create (sectors, products, policies, certifications, people, systems, datasets and more). Design for any kind, never for one content shape. `docs/okf-v02.md` sets out what OKF gives the platform.
- Delivery follows the v0.1 route in `docs/specs/v01-route.md` (blocks S0–S8, V1, P1–P2, O1, C1). It is context for what is planned, not a fixed order for design work.
- Roles are **Admin**, **Editor** and **Viewer**. Concept ownership is separate from role.
- Trust never controls who can view a concept; sensitivity does. Role and its threshold control which actions a reader can take.
- The outcome loop favours a pointer to where to focus, grounded in the company's data, and a pack ready for review over a dashboard of counts.
- Terminology follows `GLOSSARY.md`. "Tender" is the statutory word; "bid" is colloquial.
- The platform is not built for one client. The first client's requirements (`.planning/draft-docs/draft-requirements.md`, local only and gitignored) are the worked example: sector guides and product/service guides with a Brief/Detail layered view, a sales playbook zone and a bid reference zone, controlled corporate data, tag-based intelligence feeds, and a coverage view.
- Stack: Vite + React SPA in `apps/web`, talking to `apps/api` only over tRPC; TanStack Router/Query/Table; Tiptap and CodeMirror for editing; Phosphor icons. Components were intended to come from shadcn, Kibo UI, Vercel AI Elements, Streamdown and similar registries; adopt them where they earn their place, from first principles.
- The repository is shedding complexity: prefer the simplest design and implementation that serves the user.
- Undecided: the shape of later-stage surfaces (renewal packs, intelligence feeds, proposals) beyond the drafts in `.planning/draft-docs/`.

## Brand Commitments

- Name: **better-answers**, always lower case and hyphenated (never "Better Answers"); hosted at `app.better-answers.com`.
- British spelling and UK conventions throughout. Dates in UK long form (3 March 2026; with time, 09:41 · 30 August 2026). Money as £1,240.00. Relative time only under a minute.
- Trust words are a closed set, written verbatim and always as text: Verified by <person> · Verified automatically · Unverified · Changed since verified · Out of date · Draft · Deprecated.
- Impeccable is the design authority. `packages/design-system` and its `better-answers-design` skill are gone. The tokens are in `apps/web/src/styles/`, and DESIGN.md is to record them.
- The incumbent look (a quiet, dense "blueprint": hairlines, square corners, one ink-blue accent) is the baseline to improve on, not a ceiling. The shipped app does not yet match the original intent; the cards in `docs/design/intent/` show that intent, including where colour is used. Treat them as evidence of intent, not as a spec to copy.
- The bar is a polished, finished product: brand and trust are what set it apart, alongside genuine usefulness to people and agents.
- Copy is plain, short and direct. The product's UI copy still carries a long-standing over-written prose style; removing it everywhere is open work.

## Evidence on Hand

- Product truth: `VISION.md`, `GLOSSARY.md`, `docs/specs/`, `docs/personas/personas.md`, `docs/okf-v02.md`.
- First-client context and future direction: `.planning/draft-docs/` (local only and gitignored) (requirements, vision, context glossary, mapping). The first client works in safeguarding: sectors such as Safeguarding Children Partnerships, Safeguarding Adults Boards and Multi-Academy Trusts; products such as an LMS, safeguarding websites, and audits. Use it as example content, not as the product's audience definition.
- No customer testimonials, case studies, published metrics, pricing or logos exist. Do not fabricate them.

## Product Principles

1. **Every answer shows its working.** Citations, trust and provenance are part of the answer, not a detail behind a click.
2. **Fix a fault where it starts.** Wrong concept: edit the concept. Wrong source: fix the source. Wrong retrieval: fix the evals.
3. **People decide; agents suggest.** Agents propose changes; a person approves every one.
4. **Point to where to focus.** Prefer grounded recommendations and ready-to-review packs over counts.
5. **The knowledge belongs to the company.** Portable OKF files, readable without the platform.

## Accessibility & Inclusion

- WCAG 2.2 AA, enforced by an axe gate in the browser suite (`apps/web/e2e/accessibility-gate.spec.ts`), in light and dark themes.
- v0.1 supports desktop Chromium and iPhone WebKit. C1 adds the iPhone run to the browser suite (`docs/specs/route/c1.md`).
- Users are mostly non-technical; never use colour as the only signal, and write trust states as text.
