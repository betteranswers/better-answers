---
title: "A write-up cites its concept by a footnote labelled by the include"
date: 2026-08-30
module: packages/core
problem_type: architecture_pattern
component: records
severity: medium
applies_when:
  - "Storing, rendering or copying a guide section's Brief or a response"
  - "Building the write-up editor or its markdown round trip"
  - "Minting an `Answer` concept from a response at the promotion gate"
tags:
  - adr-0015
  - write-up
  - include
  - footnote
  - markdown
  - renderer
---

# A write-up cites its concept by a footnote labelled by the include

## The decision

A write-up's prose (a guide section's Brief, a response) is stored as markdown. Every claim in it that rests on a concept carries a footnote: a markdown footnote reference labelled by the include's id (`…within 30 days[^i7].`).

- The include row carries the concept's IRI, the context wording chosen (its heading and the hash of that section's text), the concept's content hash at generation and the cited span. A renamed wording reads as *wording renamed* and a vanished one as *no longer exists*. When the heading is gone, the include finds its wording by the hash.
- Footnote definitions are never stored. They are rendered from the include rows every time the prose is shown, exported or copied.
- Rows own what is included and markers own placement. A save reconciles the two. A marker whose label has no include row is refused before a version is written. An include with no marker is allowed and shown "not placed". Deleting a marker never deletes its row.
- Two footnote kinds share one syntax, and the page always says which. An OKF source footnote in a concept body is a citation mark. Its label is the `id` of an entry in the file's `sources`, matched ignoring case and surrounding whitespace. It resolves to the first such entry, whether or not the file defines it. A citation mark is never a link and never a map edge. A concept-body footnote whose label is no source id is a link when the file defines it, as OKF allows. An include marker in a write-up has no definition.
- At the promotion gate, the include markers of a response become `sources[]` entries with body footnotes labelled by those ids when it mints an `Answer` concept. An include id never enters the bundle.

There is one stored form, markdown, for write-ups and concept bodies alike. There is one renderer: a pure function in `packages/` from prose, include rows and trust state to markdown. It has two profiles, one with trust words as text tags for the labelled export and one with none for the clipboard.

The copy carries the citations with it.

- The copied text is rich text with superscript numbers and a trailing *Sources* list, plus plain text with bracketed numbers. Each line of *Sources* gives the concept's title, the source and locator, and the wording used. It carries no platform link and no trust words. The way back is the `usage` row.
- A copied Detail atom carries its body's OKF source footnotes as well as the include's citation.
- Footnote numbers restart with every copy, and the copy preview says so.
- An HTML paste cannot make real word-processor footnotes. The build's acceptance includes a paste into Word on the desktop, Word on the web, Google Docs, and "keep text only".

The editor is a view over that form.

- It is visual by default. The marker is a chip that can be moved or deleted but not typed into. The chip covers the whole cited span. Before anyone changes the words inside it, the editor asks: "This rests on <concept>. Change the concept, or keep your wording as uncited."
- Source mode is one keystroke away for a concept body. A body opens in source mode when its markdown holds anything the visual mode would lose. Markdown the visual mode does not know is kept in a raw block, or the body is refused visual mode.
- The visual editor is Tiptap 3 with its official markdown extension, and the chip is a custom inline atom with its own tokenizer, parser and renderer. Source mode is CodeMirror 6 with its markdown language. The build reads their versions from Context7.
- The editor is a named `textbox`, and its outcomes go to a `status` region. Arrow keys reach the chip, and cut and paste move it. The source editor's Tab capture has a listed escape.
- Nothing is saved that did not change. A round trip equal to the stored text writes no version and no commit, so a no-op save never moves a content hash or flags a citing section.
- An explicit save writes one version per save. The browser keeps a draft and asks for confirmation when the person leaves.

A write-up's history has three views: a word-level diff of the prose, a diff of the include list over IRI, wording heading and section hash, and a diff of the section tree. A concept's history is its commits.

The gate that treats uncited text as below threshold is the Editor's. On a Brief, a paragraph shows "rests on N concepts". The *no citation* tag appears only where the gate acts: the Detail layer and the copy preview.

None of this is in the tree yet beyond the read-only rendering of a concept body. The include row holds only its IRI and its order, and no editor, copy or write-up history exists.

## Why

- The guide page promises three things: the passage beside the claim, the contradiction check at the sentence, and a copied text that keeps its citations. All three need a mark in the stored prose that survives editing.
- Stored footnote text would be a second home for the concept's title and source, drifting the moment either changes.
- A rich-text editor storing its own format gives one text two forms, puts a conversion on every read, and stops the concept file being the thing edited.
- An editor that normalises on save would mark every include *changed since checked* on the day someone opens a body and touches nothing.

## Rejected

- A markdown link on the claim pointing at the concept's IRI: every cited phrase becomes a hyperlink, with nowhere to say which wording and which version.
- No marker, citations only as the include list beside the paragraph: the passage cannot sit beside its claim, and copy can number nothing.
- Footnote definitions stored in the prose: a stale title and source on every rename.
- A rich-text editor storing JSON or HTML: two formats for one text.
- Markdown source only: every Viewer becomes a markdown author, which fails the UX bar.
- Autosave of write-ups: a version per pause in an append-only table. An explicit save instead.

## History

The full record, with its one amendment (ticket 79, applied by T-001, making roles levels): `docs/archive/adr/0015-compositions-cite-concepts-by-footnote.md`. S2a's plan made a concept body's source footnote a citation mark (`docs/plans/2026-10-09-1344-feat-s2a-search-and-concept-page-plan.md`, KTD5).

The promotion-gate line, a consequence in the archived record, was missing from this doc until 20/10/2026, when the route's rewrite found S5 resting on it.

The record's renderer also served the MCP *read guide* tool. ADR 0018 rejected that tool, and the MCP surface has no guide entry. The copy's rules, the editor's libraries and behaviour, the wording's rename states, the three history views and the Brief's "rests on N concepts" were missing from this doc until 20/10/2026 (BA-215).
