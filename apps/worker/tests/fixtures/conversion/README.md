# Fixtures for the converter tests

There are four documents, one for each path through `pipeline/converter.py`. The three
that a converter changes are **committed files**, not files that a test writes. The tests
check what `anydoc` and `pdf-inspector` produce from a real `.docx` and a real PDF. A
document that the suite generated would only show what the suite's chosen writer
produces, and neither writer is a dependency of the worker.

Every value in these files is invented (ADR 0027). The text that each file converts to is
written out as a literal in `tests/pipeline/test_pipeline_landed.py`. The tests do not read
these files to work out the expected text, because a test that compared a converter's
output with itself would pass whatever the converter returned.

**Every committed fixture uses `00-00-00` as its synthetic sort code.** The first pair of
digits in a sort code identifies a bank, so any other value could be a real one. For
example, `20-00-00` belongs to Barclays, and these fixtures used it until 23 September
2026. No bank is issued `00-00-00`, which is why the planted page uses it. Both codes have
six digits, so swapping one for the other moves no span and changes no expected literal.
On 23 September 2026 the detector ran over `delivery-terms.txt` before and after the swap,
and both runs raised the same three findings at the same offsets with the same scores:

| Rule | Offsets | Score |
| --- | --- | --- |
| `UK_BANK_ACCOUNT` | 510 to 553 | 0.55 |
| `PERSON` | 1149 to 1155 | 0.935 |
| `PERSON` | 1189 to 1195 | 0.929 |

| File | Contents | What the tests check |
| --- | --- | --- |
| `delivery-terms.txt` | Seven paragraphs of a supplier's terms, 1,337 bytes in total, with no markup. One paragraph has a sort code next to an account number | Plain text is passed through unchanged: the uploaded bytes are the normalised text, so a locator's offsets are offsets into the file. It is the only fixture long enough to be split into two passages, so the tests check that the passage rows join back into the redacted text and that the second row's offsets continue from the first row's |
| `expenses-policy.docx` | A level-one heading, two paragraphs (one has a sort code next to an account number), a bulleted list and a two-by-three table | `anydoc` keeps the heading, the list and the table as Markdown, and the redaction step removes the bank details from inside them |
| `rate-card.pdf` | A heading, a sentence and a three-row table, all with a text layer | `pdf-inspector` converts the table to a Markdown table, not one cell per line. A full-text search sees the difference |
| `scanned-invoice.pdf` | One page drawn as a bitmap, with no text layer | `classify_pdf_bytes` reports that the page needs OCR, and the whole document is unreadable with `NeedsOcrError` |

The tests also need a truncated `.docx`. The test that uses it takes the first four hundred
bytes of `expenses-policy.docx` itself, because a second file on disk would hold the same
bytes under another name.

Markdown is the fourth media type that the allow-list accepts, and it has no fixture here.
It is passed through in the same way as plain text, so its bytes are the normalised text.
The test that covers it is the one before the `delivery-terms.txt` test, and it runs one
string through both pass-through types.

## How the fixtures were made

`delivery-terms.txt` was typed by hand. The other three were written by `reportlab` and
`python-docx` in a temporary environment on 20 September 2026. Neither library is a
dependency of the worker:

```
uv run --with reportlab --with python-docx --with pillow python <the generator>
```

Regenerate them only if their contents must change. A regeneration repeats the first step
of T-130: the converters' output defines the span offsets, so any change to the bytes moves
every expected literal that depends on them.
