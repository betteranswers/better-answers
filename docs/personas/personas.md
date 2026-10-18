# Personas

**Date:** 30 September 2026

The people who use Better Answers in a UK SMB of about 10 to 50 staff. Each is a job someone does, not a job title. In a small firm one person often wears two or three of these hats: the founder may also be the finance lead, and the bid writer may also sell. Walk a screen as each hat in turn.

Role names are the product's three levels from `CONCEPTS.md`: **Admin**, **Editor** and **Viewer**. A persona's role is the level it most often holds. Being the *owner* of some concepts is separate from role, and several personas are owners.

## How to use this doc

When dogfooding and any other screen review:

- Pick the primary personas from the index by the screen's surface and the product stage the branch serves. For a Control Centre screen, walk as the Knowledge Curator and the Founder-Operator. For Ask, a question set or a guide, walk as the Bid Writer and the Occasional Expert. The first four are primary for v0.1. The last four matter from the *Next* and *Then* stages onwards; judge a v0.1 screen against them only where a job below is tagged v0.1.
- Walk the flow as the persona. Its *On a screen* section lists the paper cuts it feels most.
- Each job carries the stage from `VISION.md` that serves it: **v0.1**, **Next** (bids and proposals), **Then** (renewal packs, intelligence feeds, proposals and prospecting) or **Later** (marketing campaigns and broader sources).
- Any persona may work through an assistant connected on the MCP surface (`find`, `ask`, `open`, `give_feedback`) rather than the web app. Each persona says how likely that is. An agent working on a person's behalf reads what that person's role allows and may suggest changes. A person decides every suggestion.

## Index

| Persona | Role | Job to be done | Cares most about | Stage | Primary for v0.1 |
| --- | --- | --- | --- | --- | --- |
| [The Founder-Operator](#the-founder-operator) | Admin | Sees where the company's knowledge is weak and trusts what goes out in its name | Seeing where to focus without asking anyone | v0.1 | Yes |
| [The Bid Writer](#the-bid-writer) | Editor | Answers question sets fast from proven, current Answers | Speed, and knowing an answer is still true | v0.1 | Yes |
| [The Knowledge Curator](#the-knowledge-curator) | Admin (or Editor and owner) | Keeps the map accurate, checked and complete | Completeness, and proof that it was checked | v0.1 | Yes |
| [The Occasional Expert](#the-occasional-expert) | Viewer, owner of their specialism | Finds and checks one thing when a colleague asks | Finding it from a cold start in under a minute | v0.1 | Yes |
| [The Marketing Generalist](#the-marketing-generalist) | Viewer or Editor | Turns what the company knows into credible external content | Claims that are safe to publish, with sources | Then, Later | No |
| [The Seller](#the-seller) | Viewer or Editor | Spots openings in accounts and gets proposals out quickly | Timely hooks and fast, accurate proposals | Next, Then | No |
| [The Commercial Controller](#the-commercial-controller) | Editor, owner of rates and certifications | Makes sure every number and commercial claim is right and current | Tracing every figure to an approved source | v0.1, Next | No |
| [The Renewals Owner](#the-renewals-owner) | Editor | Keeps and grows existing clients with evidence of value | A renewal pack that is ready before it is needed | Then | No |

### At a glance

| | Founder-Operator | Bid Writer | Knowledge Curator | Occasional Expert | Marketing Generalist | Seller | Commercial Controller | Renewals Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **How often** | Weekly | Daily, intense near deadlines | Two or three times a week | Once or twice a month | Weekly, plus bursts when news breaks | When something comes up | Periodic, and at sign-off | On the renewal calendar |
| **Main act** | Review and decide | Search, reuse, draft | Check, classify, govern | Search and read | Source, draft, reuse | Spot, brief, propose | Verify and approve figures | Gather evidence, assemble, renew |
| **Assistant use** | Unlikely | Heavy | Moderate | Possible, prefers plain questions | Keen, low ceremony | Keen, wants to be told | Cautious, checks the checks | Moderate |
| **Measure** | Visibility | Speed | Completeness | Findability | Time to credible content | Time from trigger to contact | Traceable figures | Pack readiness |
| **If unhappy** | Cancels | Works around the product | Quality decays | Never adopts | Signal is wasted | Revenue is missed | Wrong figures go out | Clients drift away unnoticed |

## The Founder-Operator

**Who:** the managing director and founder of a 10 to 25 person professional services firm, such as an IT, engineering, sustainability or healthcare consultancy.

**Role in the product:** Admin. Owner of the company's most sensitive domains until someone else takes them.

**Technical comfort:** uses Word, email and a few web apps every day. Not a developer. Has heard a lot about AI but has not built it into how the firm works.

### Goals

- Win more public sector and framework tenders without hiring a full-time bid writer.
- Stop losing what the firm knows each time someone leaves.
- Cut a tender response from two or three days to under one.
- Keep quality and consistency across everything a client sees.

### Frustrations

- Company knowledge lives in email threads, shared drives and people's heads.
- Every tender starts from scratch because earlier responses cannot be found.
- No time to organise anything. Always firefighting.
- The tools competitors use cost more than the whole annual software budget.
- Worried that AI will make things up in documents that go to clients.

### Behaviours

- Delegates day-to-day content work but wants to see its quality.
- Reads tender responses before they go out and needs to trust the sources behind them.
- Looks in weekly, not daily.
- Wants things to just work and has little patience for settings.
- Cautious about spending on AI. Wants to hear from a few peers who use a tool before committing.

### Jobs in the product

- **v0.1** Set up the workspace: invite people, give each a role, connect the first sources and decide what to publish.
- **v0.1** See where to focus this week: the suggestions waiting, the concepts out of date, the gaps in a guide's coverage.
- **v0.1** Read a response before it goes out and follow any claim to its citation.
- **v0.1** Decide the suggestions and promotions that are an Admin's.
- **Next** Look back over outcomes: which tenders were won and which Answers they used.
- **Then** Read a monthly or quarterly summary of sector and competitor signals for planning.

### On a screen

Lands on People, the Admin's home, and moves to Sources and Suggestions. Feels a paper cut when:

- the screen shows counts but not what to do next;
- a setting uses a technical word with no plain explanation;
- a choice has no sensible default;
- trust is shown by colour alone, or it is unclear who checked something and when;
- a task needs more than one sitting to finish, with nothing saying where they left off.

Unlikely to use an assistant early. Prefers the web app.

### Success measure

"I can see what we know, what we are missing and whether our responses use current information, without asking anyone."

## The Bid Writer

**Who:** the business development manager or bid coordinator in a professional services, construction or facilities management firm. Often the person who holds the tender calendar.

**Role in the product:** Editor. Runs question sets, drafts responses and saves good answers as `Answer` concepts.

**Technical comfort:** a strong Microsoft 365 user, comfortable with web apps, and happy to learn a new way of working if it saves time.

### Goals

- Produce strong, evidenced tender responses quickly.
- Find earlier answers that fit new questions.
- Keep a library of proven answers.
- Know which content is current and which needs updating.

### Frustrations

- A large share of every tender goes on searching for existing answers.
- Copying from old tenders brings in out-of-date facts.
- No way to tell whether an earlier answer is still accurate.
- Standard questionnaires are filled in by hand, and mistakes creep in.
- Several tenders run at once, each with its own deadline.

### Behaviours

- Works in intense bursts near deadlines, often evenings and weekends.
- Copies and pastes a lot. Wants to reuse an answer in one step.
- Switches between tenders quickly.
- Values speed over polish in a first draft.
- Happy for AI to draft, but checks every citation.

### Jobs in the product

- **v0.1** Ask a question mid-task and get a cited answer with its trust word.
- **v0.1** For a new question, see whether the company has answered it before, and reuse the `Answer` with its citation.
- **v0.1** Run a question set: confirm the extracted questions, draft a response to each, and mark those that need an expert.
- **v0.1** Copy a response into the tender document with its footnotes.
- **v0.1** Save a good response as an `Answer` (*Save as an Answer*) for the promotion gate.
- **Next** Fill a recurring questionnaire, such as a security or framework questionnaire, from the map, then finish what is left by hand.
- **Next** After a tender closes, put forward its best responses as Answers and retire stale ones.
- **Next** Answer a tender on a partly built map, where the product says plainly how much it could answer.

### On a screen

Lands on Ask, the Editor's home, and works in the question set. Feels a paper cut when:

- reusing an answer takes more than one click, or copying loses the citations;
- an answer's trust word is missing, or it is unclear whether the answer is still current;
- switching between two question sets loses their place;
- a search needs the right words, not the words in the tender;
- the product is slow in the middle of a deadline.

A heavy assistant user who asks the map from inside the assistant.

### Success measure

"For 80% of tender questions I can find a relevant earlier answer in under 30 seconds, and I know it is current."

## The Knowledge Curator

**Who:** the quality manager or operations lead in any SMB with compliance, quality or governance duties. Often has a background in ISO or quality management.

**Role in the product:** Admin, or an Editor who owns most domains. Owner of the concepts they keep.

**Technical comfort:** at home with structured data, spreadsheets and process documents.

### Goals

- Keep the company's knowledge accurate, complete and current.
- Track how fresh content is, and catch what has gone stale.
- Hold governance standards across the whole map.
- Give bid writers well organised, checked content.

### Frustrations

- Quality decays quietly. Nothing says when something goes out of date.
- Several versions of one document exist, and none is clearly the right one.
- Quality audits are manual and slow.
- No sight of which content is actually used.

### Behaviours

- Reviews on a schedule, not only when something breaks.
- Puts completeness and accuracy ahead of speed.
- Follows governance workflows to keep standards.
- Watches coverage to find gaps.
- Maintains the company's kinds and how things are classified.

### Jobs in the product

- **v0.1** Work the inbox: accept or decline suggestions, including candidate concepts from a new source.
- **v0.1** Check concepts against their sources, and clear verification requests and the weekly digest.
- **v0.1** Resolve conflicts where two sources disagree.
- **v0.1** Seed a guide from a template, then refresh a section whose included concepts changed or whose expectation is unmet.
- **v0.1** Review a guide's coverage, find the gaps and assign them.
- **v0.1** Sweep what is out of date or near the end of its shelf life, and renew, replace or deprecate it.
- **v0.1** Read the answer audit, act on flagged answers and record corrections.
- **v0.1** Import an existing Q&A document and resolve duplicates.
- **Next** When a new product document supersedes old concepts, confirm which ones it replaces.
- **Then** Turn a finished project into a case study and publish it for others to use.

### On a screen

Lands on People and lives in Suggestions and Knowledge. Feels a paper cut when:

- items cannot be accepted or declined in bulk where it is safe;
- there is no way to see what changed between two versions;
- a filter or sort does not survive moving between views;
- it is unclear who owns a concept, or who checked it and when;
- a decision leaves no trace in the audit log.

Uses an assistant now and then, for questions such as "what needs review this week?"

### Success measure

"Everything on the map has been checked in the last six months, and I can prove it."

## The Occasional Expert

**Who:** a senior consultant or subject expert, such as a technical, legal or compliance specialist, who contributes to responses but does not run them.

**Role in the product:** Viewer. Often the owner of the concepts in their specialism, which lets them edit those concepts and decide edit suggestions on them. Checking a concept needs an Editor, so an expert who should check their own area is made one.

**Technical comfort:** uses company tools when they must. Not interested in learning a new system. Would rather be asked a specific question.

### Goals

- Find information quickly when a colleague asks.
- Add what they know without long data entry.
- Know what the company says about their specialism.

### Frustrations

- Told to "check the knowledge base" and finds it overwhelming.
- Does not know how things are classified or where they are kept.
- Wants to contribute but not to manage content.
- Forgets how the tool works between visits.

### Behaviours

- Uses the product once or twice a month at most.
- Searches for a specific topic. Does not browse.
- Reads far more than they write.
- Acts when a bid writer or curator asks them directly.
- May use an assistant rather than the web app.

### Jobs in the product

- **v0.1** Ask a plain question with no knowledge of how things are organised, get an answer, and check its source and when it was last checked.
- **v0.1** Read a guide for context on a subject.
- **v0.1** Flag an answer as wrong or out of date, or suggest an edit, without becoming a content manager.
- **v0.1** As owner, correct a concept in their specialism or decide an edit suggestion on it when asked.
- **v0.1** Review what the company claims about their specialism and flag corrections.
- **v0.1** After some weeks away, see what changed in their area since their last visit.

### On a screen

Lands on Ask. Feels a paper cut when:

- the first screen assumes they know the product;
- a search returns nothing useful for plain words;
- an empty state does not say what to do next;
- flagging or suggesting takes more than one short step;
- product words appear with no explanation.

Might ask through an assistant in plain language. The test case for "you do not need to remember the tools, just ask".

### Success measure

"When someone asks me to check something, I can find it and verify it in under a minute."

## The Marketing Generalist

**Who:** the marketing manager or communications lead. In an SMB this is often part-time, or a hat someone else wears.

**Role in the product:** Viewer, or Editor where they draft case studies.

**Technical comfort:** comfortable with web apps and content tools. Drafts in their own tools.

### Goals

- Publish content that reacts to sector news within days, not weeks.
- Reuse case studies and capability claims without checking them again each time.
- Keep a pipeline of topics fed by what is happening in the sector.

### Frustrations

- Sector news sits in someone else's inbox.
- Case studies go stale without anyone noticing.
- No way to know which claims are still safe to publish.

### Behaviours

- Plans weekly, with bursts when news breaks.
- Reads summaries and topics, not raw articles.
- Drafts in other tools and wants source material handed over with citations.

### Jobs in the product

- **v0.1** Check a claim before publishing it: its sources, its trust word and whether it is out of date.
- **Then** Read a digest of sector news, with citations and a note on why it matters.
- **Then** Pick a topic, gather a cited source pack and draft a post, email or blog for a person to edit.
- **Then** Find a current case study and reuse its facts.

### On a screen

Arrives through Ask or an assistant. Feels a paper cut when:

- a claim's sources cannot be copied out with it;
- it is unclear whether a fact is safe to publish;
- product words stand where plain words would do.

Keen on assistants for prompts such as "draft a post about this, cited". Unlikely to learn tool names.

### Success measure

"When something happens in our sector, I can ship a credible piece with sources within 48 hours, without chasing anyone for the facts."

## The Seller

**Who:** the sales lead or account manager. In many SMBs this is the founder or a senior consultant wearing the hat.

**Role in the product:** Viewer, or Editor when they author proposals.

**Technical comfort:** lives in email and the CRM, not in knowledge tools. Uses whatever produces the document fastest.

### Goals

- Open conversations with timely, specific reasons to call.
- Walk into any account meeting with a one-page brief.
- Turn a qualified opportunity into a sent proposal within days.

### Frustrations

- Buying signals arrive as noise or not at all.
- Account research means searching the web again each time.
- Building a proposal means digging through old documents.
- Competitors' claims go unanswered.

### Behaviours

- Works in response to interruptions, not to a plan.
- Rarely visits a knowledge tool unprompted.
- Wants to be told about an opening, not to go looking.

### Jobs in the product

- **v0.1** Ask what the company knows about a client, a partner or a competitor, with citations.
- **Next** Answer a proposal's question set from the map, as the Bid Writer does, with the Commercial Controller signing off the figures.
- **Then** Build a one-page brief on an account.
- **Then** Be told when an account shows a buying signal, such as a regulation change with a start date, or a merger or leadership change at a client organisation, with a cited draft note to send.
- **Then** Pull a record of a competitor's recent activity and a comparison for a proposal.

### On a screen

Arrives through an assistant or a link from a colleague. Feels a paper cut when:

- the path from question to usable text is longer than a few steps;
- the product asks them to organise anything;
- a draft cannot leave the product with its citations.

The strongest candidate for "just ask", and for agents that bring signals to them rather than waiting to be asked.

### Success measure

"I hear about a buying signal in my accounts before my competitors do, and I can send a relevant, accurate proposal or note the same week."

## The Commercial Controller

**Who:** the finance manager or commercial lead. In an SMB this is often the founder or an operations person with the commercial hat.

**Role in the product:** Editor, since keeping concepts checked needs that level. Owner of the Rate, Certification and Insurance concepts, the kinds that carry a review cadence.

**Technical comfort:** at home in spreadsheets and audit trails. Wants to see lineage and versions, not chat.

### Goals

- One source of truth for rates, pricing tiers and return-on-investment assumptions.
- No proposal goes out with figures they have not approved.
- Early warning of anything ending that revenue depends on, such as a certification that framework eligibility rests on.

### Frustrations

- Pricing lives in spreadsheets of spreadsheets.
- Return-on-investment claims in old proposals cannot be checked.
- Finds out a certification has lapsed when a tender fails.

### Behaviours

- Works periodically, and as a gate before things go out.
- Reviews rather than writes.
- Trusts AI that shows its checks. Distrusts AI that drafts figures.

### Jobs in the product

- **v0.1** Check a figure, rate or compliance claim against its current source.
- **v0.1** As owner, keep Rate, Certification and Insurance concepts checked, and act on those due a check or near the end of their shelf life.
- **v0.1** Decide edit suggestions on the concepts they own.
- **Next** Sign off the figures in a response or proposal before it is sent.

### On a screen

Arrives through a verification request or a link, and reads a concept or a response. Feels a paper cut when:

- a figure shows no source, no check date or no checker;
- versions of a figure cannot be compared;
- AI-drafted figures look the same as checked ones.

Uses an assistant to verify, not to drive.

### Success measure

"No client-facing document goes out with a figure, rate or compliance claim I cannot trace to a current, approved source."

## The Renewals Owner

**Who:** the account or delivery lead who owns retention and renewals, usually the consultant closest to the client.

**Role in the product:** Editor.

**Technical comfort:** comfortable with web apps. Organised around a renewal calendar.

### Goals

- Never start a renewal from a blank page.
- Show clients value that reflects their sector: what is changing for them and what the firm did about it.
- Turn finished work into case studies while it is fresh.

### Frustrations

- Evidence of value is scattered across delivery documents.
- Renewal packs are rebuilt by hand each time.
- Case studies never get written.

### Behaviours

- Works to the renewal calendar and to relationships.
- Reads about their clients' world, not the firm's.

### Jobs in the product

- **v0.1** Find what was delivered for a client, with its sources.
- **Then** Get a renewal pack assembled before the renewal date, with evidence gaps flagged, and review it before it goes.
- **Then** Draft a case study when a project ends and send it for review.
- **Then** Read a briefing on a client's sector to share with that client.

### On a screen

Arrives through Ask or an assistant. Feels a paper cut when:

- evidence for one client cannot be gathered in one place;
- a pack gives no sign of what is missing;
- dates and deadlines are hard to see.

Would welcome packs prepared on a schedule by an agent, ready for review.

### Success measure

"Sixty days before any renewal, I have an accurate pack of evidence, outcomes and sector context for that client, without assembling it myself."

## Scenario: answering a tender

A common UK SMB use case, and the one v0.1 is built around. Use it to string the primary personas into one journey.

1. A public sector tender arrives. The Bid Writer (Editor) uploads the tender document, and the product extracts its question set as a suggestion. The Bid Writer confirms the questions.
2. For each question, the product finds an existing `Answer` or drafts a response over the map's concepts, with citations and a trust word. Where nothing answers, it says so and shows any unmapped passages.
3. Questions that need an expert go to the Occasional Expert (Viewer, owner of that area), who corrects the concept or decides the edit suggestion on it.
4. The Commercial Controller checks the rates and certifications the responses cite.
5. The Founder-Operator (Admin) reads the responses, follows the citations and approves. The Bid Writer copies them into the tender document with their footnotes.
6. The Bid Writer saves the strongest responses as Answers. The Knowledge Curator or the Answer domain's owner decides each one at the promotion gate.
7. **Next:** when the tender is won or lost, its outcome is recorded against the Answers it used, and those Answers come up for review.
