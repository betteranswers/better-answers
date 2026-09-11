"""The one memoised function: a landed copy converted, redacted and cut into chunks
(`[TEST1]`, `[TEST3]`, `[TEST7]`, `[TEST9]`).

Driven through `better_answers_worker.pipeline`'s own interface, over a real engine and
a real detector, because everything these cases are about is what the memo does between
two runs — and a memo nobody ran is a decoration.

**No database.** Nothing here writes a row: the memo lives in the binding's store on
disk and the chunk rows are the wave after this one. The pool a run would use is built
lazily and never asked for, which is why the bootstrap below names an address that does
not answer — a case that quietly opened a connection would fail there rather than pass
here.

**The object store is the one external service, and it is replaced behind its adapter**
with the dictionary below (`[TEST3]`). The bytes of a landed copy are what the estate's
bucket would hand back; what the cases are about is which key they were asked for and
which key the normalised copy went under, and a bucket cannot say that more clearly than
a dictionary can.

**What is written down here, and why it is not derived.** The redacted text of both
documents, the categories the seam raises, the version string and every chunk boundary
are literals (`[TEST9]`). They were read out of the seam on 11 September 2026 at
`rule_version` 1 and the detector pin this tier ships; a case that asked the seam what
it answered would agree with a seam that answered anything.
"""

from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path

import pytest

from better_answers_worker.pipeline import (
    MEMO_VERSION,
    Chunk,
    Host,
    IndexRun,
    LandedDocument,
    LandedRun,
    Suppression,
    object_key_of,
    redact_landed_copies,
    suppression_of,
)
from better_answers_worker.redaction.pins import DETECTOR_PIN, RULE_VERSION
from test_pipeline_host import bootstrap_for

WORKSPACE = "01M2Q3R4S5T6V7W8X9YZAB0000"
BINDING = "01M2B1ND1NGAAAAAAAAAAAAAAA"

#: A binding nobody configured — the shape the `source_binding` column takes by default,
#: under which the always tier is written out of the text and a name is left in it.
THE_SAFE_SET: Mapping[str, bool] = {"default_on": True, "default_off": False}

#: One binding's own seed, from which a name's letter is drawn. Spelled rather than
#: generated: a seed that moved between two runs would re-read every document, which is
#: the very thing the second case says must not happen.
SEED = "b0f3a1d2c4e5"

#: An invoice carrying a sort code beside an account number, which the seam raises as
#: one `bank-details` span at the tier no binding can switch off (ADR 0027: every value
#: invented). Its account number is the string the memo must never be found holding.
AN_INVOICE_ID = "01M2Q3R4S5T6V7W8X9YZAB0001"
AN_INVOICE = (
    "Invoice 2026-041 is due on receipt.\n\n"
    "The sort code is 20-00-00 and the account number is 12345678.\n\n"
    "Delivery follows within ten working days of a signed order.\n"
)
AN_INVOICE_REDACTED = (
    "Invoice 2026-041 is due on receipt.\n\n"
    "The sort code is [withheld].\n\n"
    "Delivery follows within ten working days of a signed order.\n"
)
THE_ACCOUNT_NUMBER = "12345678"

#: A delivery note naming one person. Under the safe set a name is a **finding** and not
#: a withholding, so this document's redacted text is its own text — until an erasure
#: request names her, which raises her span to the always tier and writes her out. That
#: is what makes this the document the suppression case moves, and the invoice the one
#: it must leave alone.
A_DELIVERY_NOTE_ID = "01M2Q3R4S5T6V7W8X9YZAB0002"
A_DELIVERY_NOTE = (
    "Deliveries are booked by Priya Raman on 0161 496 0000.\n\n"
    "The depot opens at seven.\n"
)
A_DELIVERY_NOTE_SUPPRESSED = (
    "Deliveries are booked by [withheld] on 0161 496 0000.\n\n"
    "The depot opens at seven.\n"
)

#: The erasure request that reaches the delivery note, as the `subject_request` row
#: holds its identifier set: identifiers by the kind each was given under.
HER_ERASURE_REQUEST = suppression_of(
    {"name": ("Priya Raman",), "email": ("priya.raman@example.test",)}
)

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"


class ABucket:
    """The estate's object store, as a dictionary of the bytes under each key.

    It is the adapter's own interface and not boto3's: what the cases need to see is
    which key was read, which key was written and how many times — and a real bucket
    would answer those questions no better and a great deal more slowly (`[TEST3]`).
    """

    def __init__(self, objects: Mapping[str, bytes]) -> None:
        self.objects = dict(objects)
        self.reads: list[str] = []
        self.writes: list[str] = []

    def read(self, key: str) -> bytes:
        self.reads.append(key)
        return self.objects[key]

    def write(self, key: str, body: bytes) -> None:
        self.writes.append(key)
        self.objects[key] = body


def a_landed_document(
    document_id: str,
    *,
    media_type: str = "text/markdown",
    suppressions: Sequence[Suppression] = (),
) -> LandedDocument:
    """One document as its catalogue row addresses it, with the bind act's two keys."""
    return LandedDocument(
        source_document_id=document_id,
        media_type=media_type,
        original_key=f"documents/{document_id.lower()}/original",
        normalised_key=f"documents/{document_id.lower()}/normalised",
        suppressions=tuple(suppressions),
    )


THE_INVOICE = a_landed_document(AN_INVOICE_ID)
THE_DELIVERY_NOTE = a_landed_document(A_DELIVERY_NOTE_ID)


def a_bucket_holding_both() -> ABucket:
    return ABucket(
        {
            THE_INVOICE.original_key: AN_INVOICE.encode(),
            THE_DELIVERY_NOTE.original_key: A_DELIVERY_NOTE.encode(),
        }
    )


@pytest.fixture(name="host")
def a_host(tmp_path: Path) -> Iterator[Host]:
    """A host over a store of its own, and an address no connection is ever made to."""
    with Host(bootstrap_for("postgresql://unreached/unreached", tmp_path)) as opened:
        yield opened


def a_run(reason: str = "bound") -> IndexRun:
    return IndexRun(workspace_id=WORKSPACE, binding_id=BINDING, reason=reason)


def read_the_copies(
    host: Host,
    bucket: ABucket,
    documents: Sequence[LandedDocument],
    *,
    memo_version: str = MEMO_VERSION,
) -> LandedRun:
    return redact_landed_copies(
        host,
        a_run(),
        documents,
        bucket,
        THE_SAFE_SET,
        SEED,
        memo_version=memo_version,
    )


def text_of(answer: LandedRun, document_id: str) -> str:
    """The redacted text this run read for one document."""
    return next(
        document.redacted.text
        for document in answer.documents
        if document.source_document_id == document_id
    )


# -- the memoised function -------------------------------------------------------------


def test_a_landed_copy_comes_back_with_what_its_binding_withholds_written_out_of_it(
    host: Host,
) -> None:
    """The memoised body is the conversion and then the seam, in that order and in
    one function, so the only text the memo is ever handed to hold is the redacted
    one.
    """
    bucket = a_bucket_holding_both()

    answer = read_the_copies(host, bucket, (THE_INVOICE,))

    assert text_of(answer, AN_INVOICE_ID) == AN_INVOICE_REDACTED
    assert answer.documents[0].redacted.verdict is None
    assert dict(answer.documents[0].redacted.counts) == {"bank-details": 1}
    assert answer.documents[0].redacted.version == f"{RULE_VERSION}:{DETECTOR_PIN}"


def test_the_bindings_store_is_never_found_holding_a_span_the_seam_withheld(
    host: Host,
) -> None:
    """ADR 0020's line, read off the disk it is about. Conversion sits inside the
    memoised function precisely so that no entry can hold the text as it arrived; a
    design that memoised the conversion separately would leave the account number below
    on a volume that is never backed up and never reviewed.
    """
    bucket = a_bucket_holding_both()

    read_the_copies(host, bucket, (THE_INVOICE,))

    held = b"".join(
        path.read_bytes()
        for path in sorted(host.binding_directory(a_run()).rglob("*"))
        if path.is_file()
    )
    assert b"[withheld]" in held, "the redacted text is what the memo is for"
    assert THE_ACCOUNT_NUMBER.encode() not in held
    assert b"20-00-00" not in held


def test_a_second_run_over_an_unchanged_document_reads_nothing_afresh(
    host: Host,
) -> None:
    """The whole point of the memo: the detector is the expensive thing in this tier,
    and a binding re-indexed for a reason that touched no document must not run it
    again.
    """
    bucket = a_bucket_holding_both()
    both = (THE_INVOICE, THE_DELIVERY_NOTE)

    first = read_the_copies(host, bucket, both)
    again = read_the_copies(host, bucket, both)

    assert first.read_afresh == 2
    assert again.read_afresh == 0
    assert text_of(again, AN_INVOICE_ID) == AN_INVOICE_REDACTED
    assert text_of(again, A_DELIVERY_NOTE_ID) == A_DELIVERY_NOTE


def test_a_suppression_on_one_document_re_reads_that_document_and_no_other(
    host: Host,
) -> None:
    """The reason the suppressions are an argument and never a change key: a key would
    put the whole binding's memo out of date the day one person asked to be erased, and
    the next run would re-read every document in it to answer for one.
    """
    bucket = a_bucket_holding_both()
    before = (THE_INVOICE, THE_DELIVERY_NOTE)
    after = (
        THE_INVOICE,
        a_landed_document(A_DELIVERY_NOTE_ID, suppressions=(HER_ERASURE_REQUEST,)),
    )

    read_the_copies(host, bucket, before)
    answer = read_the_copies(host, bucket, after)

    assert answer.read_afresh == 1
    assert text_of(answer, A_DELIVERY_NOTE_ID) == A_DELIVERY_NOTE_SUPPRESSED
    assert text_of(answer, AN_INVOICE_ID) == AN_INVOICE_REDACTED


def test_a_run_under_a_moved_detector_pin_reads_every_document_afresh(
    host: Host,
) -> None:
    """The other half of the pair (`[TEST7]`): the suppression moves one document's key
    and the version moves all of them, because a span the detector would read
    differently today is a span every offset in the binding rests on.
    """
    bucket = a_bucket_holding_both()
    both = (THE_INVOICE, THE_DELIVERY_NOTE)

    read_the_copies(host, bucket, both)
    answer = read_the_copies(host, bucket, both, memo_version="2:a-later-detector")

    assert answer.read_afresh == 2


def test_the_memo_is_versioned_by_the_seams_own_rule_version_and_detector_pin() -> None:
    """Written down rather than read off the pins (`[TEST9]`): the two halves joined
    by a colon is the string the finding rows and the document's own column carry, and a
    memo versioned by anything else would survive a detector the evidence no longer
    rests on.
    """
    assert f"{RULE_VERSION}:{DETECTOR_PIN}" == MEMO_VERSION
    assert MEMO_VERSION.startswith("1:presidio-2.2.364+gliner-0.2.29+torch-2.14.0+")


# -- the two copies --------------------------------------------------------------------


def test_the_normalised_redacted_text_lands_under_the_documents_normalised_key(
    host: Host,
) -> None:
    bucket = a_bucket_holding_both()

    read_the_copies(host, bucket, (THE_INVOICE,))

    assert bucket.writes == [THE_INVOICE.normalised_key]
    assert bucket.objects[THE_INVOICE.normalised_key] == AN_INVOICE_REDACTED.encode()


def test_the_original_landed_copy_is_read_and_never_written(host: Host) -> None:
    """The original is the evidence an erasure map is read from and a re-detection is
    re-run over, so a run that wrote over it would destroy the only thing that could
    answer what a document said before the seam saw it.
    """
    bucket = a_bucket_holding_both()

    read_the_copies(host, bucket, (THE_INVOICE,))

    assert bucket.reads == [THE_INVOICE.original_key]
    assert THE_INVOICE.original_key not in bucket.writes
    assert bucket.objects[THE_INVOICE.original_key] == AN_INVOICE.encode()


def test_a_landed_copy_is_reached_under_the_workspaces_own_prefix() -> None:
    """The catalogue's key is a key *inside* the workspace's prefix — the app's object
    door puts every one of its reads and writes under `workspaces/<id>/` and stores what
    is left. A worker that asked the bucket for the column's value alone would find
    nothing there, and would find it silently.
    """
    assert (
        object_key_of(WORKSPACE, "documents/01m2q3r4s5t6v7w8x9yzab0001/original")
        == "workspaces/01M2Q3R4S5T6V7W8X9YZAB0000"
        "/documents/01m2q3r4s5t6v7w8x9yzab0001/original"
    )


# -- the converter ---------------------------------------------------------------------


@pytest.mark.parametrize("media_type", ["text/markdown", "text/plain"])
def test_markdown_and_plain_text_pass_through_as_the_normalised_text(
    host: Host, media_type: str
) -> None:
    """Conversion in v0.1 is pure Python and these two are the whole of it: the bytes
    are the normalised text already, so the offsets a locator carries are offsets into
    what the reader uploaded. The `.docx` and PDF paths are the ticket after this one.
    """
    document = a_landed_document(AN_INVOICE_ID, media_type=media_type)
    bucket = ABucket({document.original_key: AN_INVOICE.encode()})

    answer = read_the_copies(host, bucket, (document,))

    assert text_of(answer, AN_INVOICE_ID) == AN_INVOICE_REDACTED


def test_a_document_this_tier_cannot_convert_is_left_out_and_takes_no_neighbour_with_it(
    host: Host,
) -> None:
    """Per-document isolation, which is the whole reason the documents are fanned one
    component each. `.docx` and PDF arrive with the next ticket, and until they do a
    document carrying one is refused by name inside its own component — the run goes on,
    its neighbour is read, and the document is simply not among the ones the run read.

    That absence is what the next ticket hangs the *quarantine* on: it is the run saying
    which documents it could not read, and it is deliberately not an exception, because
    an exception here would make one unreadable upload the whole binding's failure.
    """
    unreadable = a_landed_document(AN_INVOICE_ID, media_type="application/pdf")
    bucket = ABucket(
        {
            unreadable.original_key: b"%PDF-1.7\n",
            THE_DELIVERY_NOTE.original_key: A_DELIVERY_NOTE.encode(),
        }
    )

    answer = read_the_copies(host, bucket, (unreadable, THE_DELIVERY_NOTE))

    assert [document.source_document_id for document in answer.documents] == [
        A_DELIVERY_NOTE_ID
    ]
    assert text_of(answer, A_DELIVERY_NOTE_ID) == A_DELIVERY_NOTE
    assert bucket.writes == [THE_DELIVERY_NOTE.normalised_key]


# -- the chunks, where the run cuts them ----------------------------------------------
#
# The splitter's own arithmetic — the boundaries, the offsets, the derived id and the
# wire locator — is held against the `document-chunk` agreement in
# `tests/test_document_chunk_contract.py`, which is where both tiers' halves of that
# agreement live. What is held here is the one thing that file cannot see: that the text
# the run hands the splitter is the text the seam left behind and never the one it read.


def test_a_documents_chunks_are_cut_out_of_the_redacted_text_and_never_the_original(
    host: Host,
) -> None:
    """The order the whole design rests on (ADR 0020): the seam runs before the
    splitter, so an offset a citation carries is an offset into text a reader may see.
    """
    bucket = a_bucket_holding_both()

    answer = read_the_copies(host, bucket, (THE_INVOICE,))
    chunks: tuple[Chunk, ...] = answer.documents[0].chunks

    assert "".join(chunk.content for chunk in chunks) == AN_INVOICE_REDACTED
    assert all(THE_ACCOUNT_NUMBER not in chunk.content for chunk in chunks)
    assert chunks[0].id == f"{AN_INVOICE_ID}#000000"
    assert chunks[0].locator.startswith(f"{AN_INVOICE_ID}/chars:0-")


def test_a_suppression_is_held_as_sorted_pairs_so_one_set_has_one_key() -> None:
    """A memo key is what this value is for, so two requests naming the same identifiers
    must fingerprint alike however the rows came back. A mapping's order is the reader's
    and not the set's, which is why this is pairs and why they are sorted.
    """
    one = suppression_of({"name": ("Priya Raman",), "email": ("p@example.test",)})
    other = suppression_of({"email": ("p@example.test",), "name": ("Priya Raman",)})

    assert one == other
    assert one.identifiers == (
        ("email", ("p@example.test",)),
        ("name", ("Priya Raman",)),
    )
