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

- The include row carries the concept's IRI, the context wording chosen (its heading and the hash of that section's text), the concept's content hash at generation and the cited span.
- Footnote definitions are never stored. They are rendered from the include rows every time the prose is shown, exported or copied.
- Rows own what is included and markers own placement, reconciled at save. A marker whose label has no include row is refused before a version is written. An include with no marker is allowed and shown "not placed". Deleting a marker never deletes its row.
- Two footnote kinds share one syntax, and the page always says which. An OKF source footnote in a concept body has its definition in the file. An include marker in a write-up has none.

There is one stored form, markdown, for write-ups and concept bodies alike. There is one renderer: a pure function in `packages/` from prose, include rows and trust state to markdown. It has two profiles, one with trust words as text tags for the labelled export and one with none for the clipboard.

The editor is a view over that form.

- It is visual by default. The marker is a chip that can be moved or deleted but not typed into.
- Source mode is one keystroke away for a concept body.
- Nothing is saved that did not change. A round trip equal to the stored text writes no version and no commit, so a no-op save never moves a content hash or flags a citing section.

The gate that treats uncited text as below threshold is the Editor's.

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

The full record, with its one amendment (ticket 79, applied by T-001, making roles levels): `docs/archive/adr/0015-write-ups-cite-concepts-by-footnote.md`.
