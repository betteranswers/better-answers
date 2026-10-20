# v0.1 user stories

This file holds the stories a finished v0.1 satisfies, numbered as plans cite them, each opened by the blocks that serve it. A session never opens it to pick a block, because the status table in [the route](v01-route.md) holds that.

## The Admin at the first customer

1. [S1] An Admin connects an uploaded document to the workspace, reviews what the pre-scan found in it by category and rule, and publishes it. The company's knowledge enters the platform only through a review the Admin ran and can explain.
2. [S1] Every connected source counts as Restricted until an Admin publishes it, publishing releases the sensitivity the Admin chose, and every widening is the Admin's recorded action. Doing nothing is the safe choice, and nothing reaches a reader the Admin did not admit.
3. [S0] A sort code, a date of birth or a home address in a document is withheld before the document is split, embedded, extracted or sent to any model. No derived store and no processor ever holds the value.
4. [S0, S1, C1] The platform emits the DPIA input for each connected source, naming its data types, its sensitivity, the redaction rules in force, the model choices with their processor and country, and the retention tail. The company writes its privacy assessment from what the platform does.
5. [S4] An Admin connects the company's public website by URL prefix and a SharePoint library, sees the enumeration and a cost estimate at review, and accepts the estimate once. Every sync then indexes and extracts on a cadence, within the scope the Admin priced.
6. [S4, S7] The platform refuses work at the spending limit, in one sentence naming who can raise it. A sync never narrows its work silently and never spends past the limit.
7. [S5, S7] Every suggestion of every kind waits on one page, *To decide*: suggested concepts from a sync, an Editor's edit, a promotion, an alias merge and an update to a platform bundle. A set's summary names the kinds it introduces, and nothing the platform prepared reaches the knowledge base without an Admin's decision.
8. [S5] A bulk acceptance writes one commit per suggestion and shows each item's outcome. The platform returns a set it refuses partway to its proposer with the reason, so partial success is always visible.
9. [S5] An Admin reverses a poisoned sync's suggestion set by sync, in one action. A bad extraction stays out of a history that is permanent.
10. [S3, S7] Knowledge › Kinds lists the kinds with counts per kind and per collection, and an Admin renames or merges a kind by one bulk commit. The company language is read off its concepts and corrected by an Admin, never declared in a file.
11. [S3, V1] Knowledge › All knowledge lists every concept and write-up, with Knowledge › Conflicts and Knowledge › Due for verification beside it. An Admin reads the state of the map in one area.
12. [P1] An Admin invites a person by email, changes their role, removes them, and ends every sign-in and token they hold in this workspace. Access follows the people the company has today.
13. [P1] Groups are flat, aligned to Entra, and the one thing an audience names. Who may see a connected source's content is one group lookup.
14. [S3] An Admin names a concept's owner per collection, with a per-concept override. *Edit* suggestions and verification requests reach the owner's Inbox, not only the Admin's.
15. [O1, S2b] Control Centre's System pages show signal cards over real rows, each line with an action. An alert at a threshold the Admin sets tells them of a missed backup, or of spend near the spending limit, before a customer notices.
16. [none] An Admin exports the knowledge base as a bundle snapshot at one commit, the whole repository, the records about its concepts, or a guide's prose. The company's knowledge is its own asset and leaves with it.
17. [S0] A valid erasure request rewrites every author and verifier id the platform wrote for the person, across history, the index, the evidence and the map. Its report says exactly what it did and what it did not do, so "beyond use" is an honest claim.

## The Editor, a bid writer

18. [S3] An Editor types a concept, or edits one from its own page or a guide page, and the platform writes it as one commit with the Editor as git author. The write is direct when the Editor owns the concept or is an Admin, and otherwise waits for the owner to accept the Editor's *edit* suggestion (ADR 0012).
19. [S3] An Editor seeds a guide from a template, such as a bid-library product guide or a sector guide, and its sections populate from concepts by expectation. The guide shows its coverage from the moment it is defined.
20. [S3] An Editor writes a section's Brief over the concepts it includes, and each claim cites its concept by a footnote labelled by the include. The prose never restates a concept, and every claim leads to its evidence.
21. [S3] The text editor never saves what the Editor did not change, and opens in source mode when the visual mode would lose a mark. A save with no change never rewrites a body, and a footnote never disappears.
22. [S3] An Editor copies a section into a tender with footnotes that resolve, and the platform records the copy as a usage. What left the platform is known.
23. [S2b] An Editor asks a question and gets an answer that asserts concepts only, cited passage by passage, with its verdict for the Editor's role first. The Editor can paste it knowing where every claim came from.
24. [S2b] The platform reuses an existing `Answer` as it stands when it answers the question as asked, and shows it with the question it answered and its own trust words. The bid library's verified answers are found before anything is drafted.
25. [S2b] When nothing on the map answers, the platform says "Not answered from the company's knowledge" and shows the closest unmapped passages, with one action to suggest a concept from a passage. A gap becomes knowledge, never fluent prose nobody owns.
26. [S5] An Editor saves an answer as an `Answer`, and the promotion gate decides it, one at a time, against the closest existing `Answer`. The bid library grows without duplicates.
27. [S6] An Editor pastes a bid document and confirms its extracted question set in a table, and the platform answers every question in the background, streaming each response as it is drafted. The questions it could not answer sort to the top.
28. [S6] The response-set document leaves through the one renderer, recorded as one usage per response. What the company submitted traces to the concepts it cited.
29. [V1] An Editor verifies a concept against its sources, and the concept shows *Verified by <person>* with the date. Nobody can verify a body they generated, so a verification means something.
30. [V1] A conflict, two values for one claim across sources, shows both values and their evidence. A person resolves it by superseding, deprecating, splitting by tier or dismissing, and the pipeline never picks a side.

## The Viewer

31. [S2a, S3] Every concept, section and match wears its trust in fixed words, *Verified by <person>*, *Verified automatically*, *Unverified*, *Changed since verified* or *Out of date*, and its sensitivity where it limits the reader. What a Viewer reads carries who verified it, when, and on what evidence.
32. [S2a, S3] A search match is the concept, with the guide sections it appears in and the documents it rests on nested under it, and a document nothing rests on reads *Not company knowledge*. A match and a citation open the same page, the concept's own, with its trust words and evidence pane and nothing about guides.
33. [S2a] The evidence passage sits beside the claim, and the Viewer reaches it without leaving the page. Checking a claim takes one glance.
34. [S2b, S5, V1] A Viewer flags an answer as *wrong*, *out of date*, *incomplete* or *should not have shown*. The flag becomes an item in the right person's Inbox.
35. [S2a] A concept withheld from a Viewer is indistinguishable from one that does not exist, wherever they look, with no match, no count and no hint. Probing reveals nothing.
36. [S3] A guide page's citation to a concept the Viewer may not see is withheld the same way. A write-up is never a side door.
37. [S2b] The map's state reads *map as of <time>* or *map unavailable since <time>*, and nothing else. A Viewer knows what an answer was reasoned over.

## A person working from Claude

38. [S2b] A person connects better-answers to Claude once, by OAuth, and then calls `find`, `ask`, `open` and `give_feedback` from any conversation as themselves, in their workspace. The company's knowledge is where they already work.
39. [S2b] `ask` answers only what the person could see on the web, under the same visibility rules and the same audit. An assistant is never a wider door than the web app.
40. [S2a] `open` returns the verbatim passage a citation rests on, by locator. The person checks a claim inside the conversation.
41. [P1] A person using Claude Code or a script mints a personal token once on their Account page, with the same principal and scopes as an OAuth token. Automation runs as that person and no wider.
42. [P1] A person on Microsoft 365 signs in with Microsoft when the account's email exactly matches the email they were invited on, and is never offered a password. The company's IT decides who they are.

## The person whose data the company holds

43. [S0] A person's contact details, date of birth and home address in a document are withheld by default. A bid writer indexing a proposal does not put that person's data into four stores.
44. [S0] The `Person` concept of a person who has left reads *Left*. On a valid erasure request, every author and verifier id the platform wrote for them becomes a pseudonym, so their history stays without their name.
45. [S0, O1] A subject request, for access or erasure, is answered from the platform's own per-store finder on the one-month clock. The answer is complete and on time.

## The operator and the owner

46. [P2] The operator provisions a workspace and its first member with one command under the platform principal. A customer exists before anyone signs in, and the product can be dogfooded.
47. [P2] From the console, the operator ends every sign-in and token a person holds everywhere, lists people across workspaces and sees their sessions. Better Auth's admin plugin is refused (ADR 0009), and the identity-set audit log records every operator write, so the one cross-workspace area stays small and audited.
48. [S0, O1] `pnpm ops replay-erasures` and `pnpm ops erasure-rehearsal` answer *done*, and the monthly restore drill goes fully green with a `backup` row written to production. The drill proves what it exists to prove.

<!-- The numbering skips story 49, as the note at the end says. -->

50. [S2b] The owner sets a workspace's model choice, local or hosted, for each of extraction, enrichment, answering, judging and embedding. The embedding model choice is fixed once vectors exist, and every model call is a row, so spend, residency and the spending limit are facts.
51. [none] Every reader-facing page meets its latency budget, with lists under a second, actions applied under 100 milliseconds and answers streamed, and the browser suite asserts it as the page lands (ADR 0037). A missed budget is a bug, never a sweep.
52. [C1] The first customer's four bid libraries become `Answer` concepts through one normalising pass, their cross-file contradictions become conflicts, and its website is enumerated before any cost estimate is priced. Onboarding runs on the product's own path, not a migration script.

Story 49 and stories 53 to 58 are left out. Story 49 was withdrawn, and stories 53 to 58 described how the route itself is run, which its session rules now say, so the heading for the builder and the reviewer went with them.
