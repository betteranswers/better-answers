# Fixtures for the redaction tests

There are two documents. Every name, number and address in them is invented (ADR 0027).
The telephone numbers come from Ofcom's drama range, and the patient identifier comes from
the range published for test data. The sort codes and account numbers are not issued to any
bank.

| File | Contents | What the tests use it for |
| --- | --- | --- |
| `supplier-information-pack.md` | Ten headings and the eight spans that a real supplier pack was flagged for: an officers block, a home address around a signatory's name, two email addresses on different domains, a date of birth in context, a health sentence, an NHS number, a sort code with its account number, and a fenced block that looks like one | To check what the redaction step finds, at which tier, and what each connected source removes. The expected counts are in `planted_page.py`, and the image suite checks the same page against the same expected results |
| `depot-delivery-terms.txt` | Six paragraphs of a depot's terms with **no heading**. One paragraph is 661 characters, which is longer than the limit for reading a run whole | To check that a page's length does not change the result on a document with no heading. T-130's converter passes plain text through byte for byte, so this is how a real plain-text document arrives. Its long paragraph is the only input that reaches the stepping branch of `AnchoredWindows`, where the word-boundary rule is still incomplete (T-177) |

The planted page is a Markdown file, not a Python string, so that the worker image's own
test can run the same page through the same conversion that the pipeline uses. The page
with no heading is a `.txt` file for the opposite reason: plain text is passed through
unchanged, so the bytes in this file are exactly the normalised text that a locator's
offsets count into.

**The tests do not read either file to work out its expected results.** The expected
results are written out by hand: in `planted_page.py` for the first file, and as literals
in `tests/redaction/test_redaction_windows.py` for the second. A test that compared the redaction step's
output with itself would pass whatever the step returned.

**The detection model is sensitive to these pages, so treat any edit as a change to the
measurements.** One sentence added to the planted page's preamble moved GLiNER's findings
three sections away and raised a `person-name` finding over half a word (T-168). Before you
commit an edit to either file, dump the findings by offset before and after the edit, and
read the diff.
