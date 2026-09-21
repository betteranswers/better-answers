# The redaction seam's fixtures

Two documents. Every name, number and address in both is invented (ADR 0027): the
telephone numbers are from Ofcom's drama range, the patient identifier from the range
published for test data, and the sort codes and account numbers are issued to no bank.

| File | What it holds | What it proves |
| --- | --- | --- |
| `supplier-information-pack.md` | Ten headings and the eight spans a real supplier pack was flagged for — an officers block, a home address around a signatory's name, two email addresses on different domains, a date of birth in context, a health sentence, an NHS number, a sort code with its account number and a fenced one that looks like it | What the seam finds, at which tier, and what each binding writes out. The counts are `planted_page.py`'s and the image suite holds the same page to the same answers |
| `depot-delivery-terms.txt` | Six paragraphs of a depot's terms and **no heading at all**, one of them 661 characters — longer than the ceiling a run is read whole to | That a page's length decides nothing on a document with no heading either. Plain text is what T-130's converter lands byte for byte, so this is the shape a real one arrives in; its long paragraph is the only road to the stepping branch of `AnchoredWindows`, which is where the word-boundary rule still has work to do (T-177) |

The planted page is Markdown rather than a Python string so that the worker image's own
test can put the same page through the same conversion the pipeline will use. The
heading-less page is `.txt` for the same reason read the other way: plain text takes the
pass-through road, so the bytes here *are* the normalised text a locator's offsets are
counted into.

**Neither file is read back to grade itself.** What each should yield is written down —
in `planted_page.py` for the first, as literals in `test_redaction_windows.py` for the
second — because a case that asked the seam what the seam found would agree with a seam
that answered anything.

**A page here is model-sensitive, and an edit to one is a measurement.** One sentence
added to the planted page's preamble moved GLiNER's answers three sections away and
raised a `person-name` over half a word (T-168). Dump the findings before and after any
edit to either file, by offset, and read the diff before committing it.
