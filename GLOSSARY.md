# better-answers

A living company knowledge map for UK SMBs, built on the Open Knowledge Format (OKF). This glossary
settles the one word the product uses for each concept in its domain.

## Language

### Knowledge

**Knowledge layer**:
One of the three places company knowledge lives: sources, the knowledge base and the map. Records
are not a knowledge layer.

**Minting**:
The rule that decides where a unit of knowledge lives: a concept when a company with no platform
would keep it as knowledge, and a record when it exists only because the platform runs a use case.

**Concept**:
One unit of knowledge the company keeps, carried as one OKF concept document. It is sized by trust:
an entity or a fact that can be verified, go stale or change owner on its own.

**Knowledge base**:
A company's curated concepts and the links between them, held as one OKF bundle. It is the knowledge
a reader is told a concept belongs to, and where an accepted suggestion is written.

**Collection**:
A top-level division of a company's knowledge by ownership: the company itself, one product or
service, or one sector. Each collection has its owners.

**Kind**:
The type of a concept, in the word its producer chose rather than one drawn from a closed set.

**Company language**:
The kinds, names and links a company's concepts reveal. It is read off the knowledge base, never
kept as a file or a registry.

**Term**:
A concept that defines what a word means in this company, kept in a glossary collection.

**Q&A pair**:
A concept of kind Answer: a question as its title and the company's answer as its body. It is
knowledge the company reuses, such as an entry in a bid library.

**IRI**:
A concept's stable identity, minted by the platform when the concept is created. It survives every
rename and is never edited by hand.

**Link**:
What a page shows wherever it names a concept or a passage: its title, leading there.

**Relation**:
A link from one concept to another as the map holds it, whose kind is read from the sentence around
the link.

**Evidence**:
A locator into a source, a resource read live, or a record the platform generated, which backs a
concept. A concept resting on another concept is a link, except where a successor cites the concept
it supersedes.

**Evidence pane**:
What a reader sees of a concept's cited sources, and how many of them the reader's access includes.

**Owner**:
The person answerable for keeping a concept verified and current: the collection's owner unless the
concept names its own.

**Conflict**:
Two values for one claim found across sources, recorded with both values and their evidence until a
person resolves it.

**Producer**:
A person or an agent that makes knowledge, such as an extraction, a person writing a concept or an
Admin accepting suggestions.

**Consumer**:
A person or an agent that reads knowledge and must tolerate what it did not expect, such as an
unknown kind or a concept it may not see.

**Record**:
Something the platform keeps because it runs a use case, such as a guide, a write-up, usage or an
audit event. A record refers to the concepts it is about and never restates them.

**Export**:
The company taking its knowledge out of the platform: a snapshot of its knowledge base, its whole
repository with history, its records, or a guide's prose.

### Suggestions

**Suggestion**:
A proposed change to the company's knowledge or configuration, prepared by the platform or by a
person who may not make the change. It waits for the target's owner or an Admin to accept or decline
it.

**Returned**:
The state of a suggestion the platform refused while accepting it, because what it was written
against had moved. It goes back to its proposer with the reason.

**Promotion**:
A suggestion that an answer or a response become a Q&A pair.

**Promotion gate**:
Where a promotion is decided, one at a time, beside the closest existing Q&A pair.

### The map

**Map**:
The platform's derived, queryable picture of concepts and their relations, sources, people and
citations. It is built from sources, the knowledge base and the records, and is never a source of
truth.

**Source entity**:
A person, a meeting, a task or another node the map derives directly from a source document. It is
never a concept and never a record.

**Canonical entity**:
The one node an Admin's confirmed merge of aliases makes from several source entities. It is never a
concept.

### Sources

**Source**:
The thing knowledge is extracted from, such as a document, a system, a web page or a company wiki. A
source backs concepts and is never itself one.

**Origin**:
Whose knowledge a source carries: the company's own, an external third party's, or the platform's.

**Reach**:
Whether the platform holds a copy of a source: copied, or read live when asked and never stored.

**Connected source**:
An Admin's connection of one source to the workspace, with its connector, collection,
sensitivity, audience and schedule. It is the unit the platform syncs and an Admin publishes.

**Connector**:
The means of reaching one kind of source system, such as an upload, a website, SharePoint or
HubSpot, and of taking its documents.

**Share agent**:
The platform's small on-site program that watches a company's file share and sends changed
documents to the platform.

**Source document**:
One item a connected source yields, as the platform catalogues it.

**Passage**:
One unit of a source document's redacted text. It is what a locator opens, and never the original
text.

**Locator**:
The address of a passage within its source document. A citation and the passage it cites carry the
same locator.

**Sync**:
One run of a connected source that brings its documents and passages up to date.

**Destination**:
What a connected source's documents feed: searchable passages, suggestions for the knowledge base,
source entities on the map, or more than one of these.

**Retention class**:
What the platform keeps of a connected source's documents and for how long: mirror, keep or
transient. In every class, evidence a concept cites outlives its source.

**Extraction template**:
The instruction for extracting concepts from one kind of document: which kinds such a document
evidences, and how a claim and its evidence are written.

### Visibility

**Sensitivity**:
How confidential a connected source or a document is, which decides who may view what it yields:
Restricted, Internal or Public. Sensitivity gates viewing and trust never does.

**Audience**:
Who a connected source's content is for: everyone in the workspace, or named groups.

**Effective class**:
The sensitivity a source document is actually read at: the narrower of its connected source's and
its own.

**Publish**:
The recorded Admin action that lets a connected source's content reach anyone beyond Control Centre.
It is separate from sensitivity, from audience and from accepting suggestions.

**Widen**:
An Admin's recorded action that moves a connected source to a wider sensitivity, a wider audience or
both.

**Narrowing**:
A source document taking a sensitivity of its own, narrower than its connected source's, by an
Admin's action or because redaction found special category in it.

**Cascade**:
The carrying of a visibility change to every concept citing the evidence that moved, and then to
every write-up that includes one of those concepts. It is why a guide never reaches a reader its
concepts would not.

### Personal data

**Redaction**:
The withholding of personal data from a document's text before anything is derived from it or any
model reads it.

**Redaction rule**:
One rule redaction applies, at one of three tiers: always, default on or default off for each
connected source.

**Finding**:
What redaction found in one source document that may be personal data: a category and a place in the
text, never the value.

**Group of findings**:
One document's findings of one category, raised by one rule, which is the unit an Admin reviews.

**Special category**:
Personal data such as health data, which redaction withholds sentence by sentence. A document that
holds it takes a narrowing.

**Cue**:
A word that marks a sentence as special category, so that redaction withholds the sentence whole.

**Dismissal**:
An Admin's review of a special-category finding as not special category. It is the only way a
document's own sensitivity widens.

**Placeholder**:
The word written in place of withheld text, usually naming the category of data taken. Text
withheld at the always tier gets one neutral word, so a reader never learns what it held.

**Subject request**:
A person's request to access or erase their personal data, made by a member or recorded for someone
the company's files name.

**Erasure request**:
A subject request that a person's personal data leave the platform, with a record of what was done
in every store and when.

**Suppression**:
A workspace's standing entry that keeps one person's identifiers out of everything the platform
derives, on every sync from then on.

**DPIA input**:
What one connected source contributes to a data protection impact assessment: the personal data it
can raise, its scope, sensitivity, models, retention class and audience.

### Trust

**Trust tier**:
How far a concept has been confirmed: human-reviewed, machine-confirmed or unverified. A reader sees
these as Verified by, Verified automatically and Unverified.

**Verify**:
A person or an agent confirming a concept against its sources. A person earns it human-reviewed, and
an agent earns it machine-confirmed.

**Changed since verified**:
The state of a verified concept whose content has changed since it was confirmed.

**Rider**:
A note that may follow Verified by without changing the trust tier: imported, or source moved on.

**Actor alias**:
An Admin's mapping of a verifier named in imported knowledge to a member, so that Verified by can
name them.

### Guides

**Guide**:
A set of pages that gives the company's people, by role, its knowledge about one subject: a product,
a service, a sector or the company itself. Every fact a guide shows is a concept.

**Guide definition**:
The company-owned description of a guide: its subject, the roles it serves, its layers and its tree
of sections.

**Template**:
A guide definition the platform ships for a company to start from, such as a product guide, a sales
play or a battlecard.

**Section**:
One node of a guide definition's tree, with its prompt and the concepts expected to fill it.

**Layer**:
One of the ways a section shows its knowledge: assembled, as prose written over its concepts, or
quoted, in the concepts' own words.

**Expectation**:
A section's statement of which concepts should fill it.

**Write-up**:
Prose the platform keeps as a record, written over the concepts it includes, such as a guide
section's assembled layer or a response.

**Include**:
One concept a write-up rests on.

**Footnote**:
The mark in a write-up's prose that ties one claim to one include.

### Search and answers

**Answer**:
What the platform returns for a question: every Q&A pair that fits, or else the concepts that bear
on the question, and what it could not answer. It is not a Q&A pair, though it may reuse one.

**Judge**:
The yes-or-no judgement of whether a candidate Q&A pair answers the question as asked. It never
ranks one candidate against another.

**Related knowledge**:
The concepts an answer returns as bearing on a question when no Q&A pair is a judged fit.

**Match**:
One result of a search: a concept with the sections it appears in and the documents it rests on, or
a section or a document that no concept covers.

**Not company knowledge**:
The label on a match that is a document no concept rests on.

**Question set**:
The ordered questions a document put to the company, which responses answer. It is an input to a
use case, never a source and never company knowledge.

**Response**:
A write-up that answers one question put to the company.

**Usage**:
One recorded action that takes a concept or a write-up out of the platform, such as copying it into
a document.

**Questions asked**:
The record of every answer the platform gave, with what it cited, how trusted that was at the time
and the feedback it received.

**Correction**:
An Admin's or an owner's record of the level at which one answer went wrong: concept, source or
retrieval.

**Answer test**:
A retrieval correction kept as a test: a question, a role, and the concepts its answer must and must
not reach.

### People and accountability

**Workspace**:
The boundary a company occupies: its people, connected sources, knowledge base, map and records. A
person may belong to more than one workspace.

**Member**:
A person's place in one workspace: the role they hold there and the groups they belong to.

**Role**:
What a member may do in a workspace: Admin, Editor or Viewer. A role is a level, never a job title.

**Group**:
A named set of members of one workspace, which an audience names when a connected source is not for
everyone. A group changes what a person may see, never what they may do.

**Invitation**:
An Admin's offer of a place as a member, with one role, to one email address.

**Operator**:
The person who administers the platform across every workspace. The operator is never a workspace
role, and a page names them better-answers support.

**Assistant**:
An AI host, such as Claude or ChatGPT, through which a person reaches the company's knowledge.

**Access**:
What a person's consent gives an assistant: the company's knowledge in one workspace, until it
lapses or is ended.

**Principal**:
Who the platform acts as: a member in one workspace, the platform itself, or the operator.

**Deferred principal**:
A member's authority carried into work that outlives their session. It expires with the authority it
borrowed.

**Audit event**:
The record of one action by an Admin, the platform or a person: what was done, to what, by whom and
when.

**Audit log**:
The append-only record of every audit event a workspace keeps.

**Identity-set audit log**:
The append-only record of actions that belong to no workspace because they act on a person's
identity itself, such as a sign-in. Only the operator reads it.

### The platform

**Area**:
The top level of the platform's navigation: Ask, Knowledge, Inbox or Control Centre.

**Page**:
One place in an area where a person reads or acts.

**Home**:
The page a member lands on after signing in, which depends on their role.

**Control Centre**:
The area for Admins alone, where a workspace's sources, suggestions, models, answers, people,
personal data and system are seen and acted on.

**Console**:
The operator's area over every workspace, outside any one of them.

**Model choice**:
A workspace's choice of model for one purpose: extraction, enrichment, answering, judging or
embedding.

**Model provider**:
The company that hosts the model a model choice names, such as Anthropic or Mistral.
