import os
import subprocess
import sys
from collections.abc import Iterator, Mapping, Sequence
from inspect import signature
from pathlib import Path
from typing import get_args

import pytest

from better_answers_worker import pipeline
from better_answers_worker.pipeline import (
    BINDING_STORE,
    CONVERTER_PIN,
    DOCX_MEDIA_TYPE,
    FINDINGS_STORE,
    OCR_ANSWER,
    PDF_MEDIA_TYPE,
    SEAM_MS_PER_PAGE,
    THE_MEMOS_IDENTITY,
    TIMEOUT_MARGIN_MS,
    Chunk,
    Host,
    IndexRun,
    LandedDocument,
    LandedRun,
    Suppression,
    converted,
    converter_pin_of,
    detected,
    object_key_of,
    pages_of,
    raised_by_the_detector,
    redact_landed_copies,
    suppression_of,
    timeout_for,
)
from better_answers_worker.redaction import Restore
from better_answers_worker.redaction.pins import DETECTOR_PIN, RULE_VERSION
from test_pipeline_host import bootstrap_for

WORKSPACE = "01M2Q3R4S5T6V7W8X9YZAB0000"
BINDING = "01M2B1ND1NGAAAAAAAAAAAAAAA"


THE_SAFE_SET: Mapping[str, bool] = {"default_on": True, "default_off": False}


SEED = "b0f3a1d2c4e5"


AN_INVOICE_ID = "01M2Q3R4S5T6V7W8X9YZAB0001"
AN_INVOICE = (
    "Invoice 2026-041 is due on receipt.\n\n"
    "The sort code is 00-00-00 and the account number is 12345678.\n\n"
    "Delivery follows within ten working days of a signed order.\n"
)
AN_INVOICE_REDACTED = (
    "Invoice 2026-041 is due on receipt.\n\n"
    "The sort code is [withheld].\n\n"
    "Delivery follows within ten working days of a signed order.\n"
)
THE_ACCOUNT_NUMBER = "12345678"


A_DELIVERY_NOTE_ID = "01M2Q3R4S5T6V7W8X9YZAB0002"
A_DELIVERY_NOTE = (
    "Deliveries are booked by Priya Raman on 0161 496 0000.\n\n"
    "The depot opens at seven.\n"
)
A_DELIVERY_NOTE_SUPPRESSED = (
    "Deliveries are booked by [withheld] on 0161 496 0000.\n\n"
    "The depot opens at seven.\n"
)


HER_ERASURE_REQUEST = suppression_of(
    {
        "emails": ("priya.raman@meridianfenland.co.uk",),
        "names": ("Priya Raman",),
        "other": (),
    }
)


NOTHING_SWITCHABLE: Mapping[str, bool] = {"default_on": False, "default_off": False}


A_ROTA_ID = "01M2Q3R4S5T6V7W8X9YZAB0008"
A_ROTA = (
    "Rota changes go to priya.raman@meridianfenland.co.uk by Thursday, and are\n"
    "signed off by Priya\nRaman.\n"
)
A_ROTA_ERASED = (
    "Rota changes go to [withheld] by Thursday, and are\nsigned off by [withheld].\n"
)

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"


CONVERSION_FIXTURES = Path(__file__).resolve().parent / "fixtures" / "conversion"


A_POLICY_ID = "01M2Q3R4S5T6V7W8X9YZAB0003"
A_POLICY_CONVERTED = (
    "# Expenses policy\n\n"
    "Claims are paid monthly.\n\n"
    "The sort code is 00-00-00 and the account number is 12345678.\n\n"
    "- Keep receipts\n"
    "- Submit by the fifth\n\n"
    "| Item | Limit |\n"
    "| --- | --- |\n"
    "| Hotel | 120 |\n"
    "| Mileage | 45p |\n"
)
A_POLICY_REDACTED = (
    "# Expenses policy\n\n"
    "Claims are paid monthly.\n\n"
    "The sort code is [withheld].\n\n"
    "- Keep receipts\n"
    "- Submit by the fifth\n\n"
    "| Item | Limit |\n"
    "| --- | --- |\n"
    "| Hotel | 120 |\n"
    "| Mileage | 45p |\n"
)


A_RATE_CARD_ID = "01M2Q3R4S5T6V7W8X9YZAB0004"
A_RATE_CARD_CONVERTED = (
    "# Rate card\n\n"
    "## Rates hold for the quarter.\n\n"
    "|Service|Day rate|\n"
    "|---|---|\n"
    "|Survey|450|\n"
    "|Report|300|\n"
)


A_TERMS_ID = "01M2Q3R4S5T6V7W8X9YZAB0007"
A_TERMS_REDACTED = (
    "Delivery terms for the Northgate depot.\n"
    "\n"
    "Orders received before eleven in the morning are picked the same working day.\n"
    "Anything later is picked the next. The depot does not pick on a Saturday and the\n"
    "gate is locked from noon.\n"
    "\n"
    "Pallets are counted in and counted out. A short delivery is raised on the day it\n"
    "is noticed and never at the end of the month, because a pallet nobody counted is\n"
    "a pallet nobody can find.\n"
    "\n"
    "Payment is thirty days from the end of the month in which the invoice falls. The\n"
    "sort code is [withheld]. Remittance advice goes\n"
    "to the accounts inbox and not to the depot.\n"
    "\n"
    "Returns are accepted within fourteen days on the original pallet. A pallet that\n"
    "arrives broken is photographed before it is unloaded, and the photograph is the\n"
    "record the claim rests on.\n"
    "\n"
    "Fuel is charged at cost and reviewed each quarter. A change to the rate is given\n"
    "in writing one full month before it takes effect, so that a quotation already\n"
    "given holds to the price it was given at.\n"
    "\n"
    "Pallets left on site beyond the fourteen days are collected on the next run to\n"
    "the depot and charged at the standing rate. A pallet the driver cannot reach is\n"
    "not a pallet the driver collected, and the note says so.\n"
    "\n"
    "These terms hold for the length of the agreement and are read with the schedule\n"
    "rather than instead of it.\n"
)


A_SCAN_ID = "01M2Q3R4S5T6V7W8X9YZAB0005"


A_TRUNCATED_ID = "01M2Q3R4S5T6V7W8X9YZAB0006"


def fixture_bytes(name: str) -> bytes:
    return (CONVERSION_FIXTURES / name).read_bytes()


class ABucket:
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
    restores: Sequence[Restore] = (),
) -> LandedDocument:
    return LandedDocument(
        source_document_id=document_id,
        media_type=media_type,
        original_key=f"documents/{document_id.lower()}/original",
        normalised_key=f"documents/{document_id.lower()}/normalised",
        suppressions=tuple(suppressions),
        restores=tuple(restores),
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
    with Host(bootstrap_for("postgresql://unreached/unreached", tmp_path)) as opened:
        yield opened


def a_run(reason: str = "bound") -> IndexRun:
    return IndexRun(workspace_id=WORKSPACE, binding_id=BINDING, reason=reason)


def read_the_copies(
    host: Host,
    bucket: ABucket,
    documents: Sequence[LandedDocument],
    *,
    rules_in_force: Mapping[str, bool] = THE_SAFE_SET,
    detection_key: str | None = None,
    ms_per_page: int = SEAM_MS_PER_PAGE,
    margin_ms: int = TIMEOUT_MARGIN_MS,
) -> LandedRun:
    return redact_landed_copies(
        host,
        a_run(),
        documents,
        bucket,
        rules_in_force,
        SEED,
        detection_key=detection_key,
        ms_per_page=ms_per_page,
        margin_ms=margin_ms,
    )


def quarantine_of(answer: LandedRun) -> dict[str, str]:
    return {
        document.source_document_id: document.error for document in answer.quarantined
    }


def text_of(answer: LandedRun, document_id: str) -> str:
    return next(
        document.redacted.text
        for document in answer.documents
        if document.source_document_id == document_id
    )


def test_a_landed_copy_comes_back_with_what_its_binding_withholds_written_out_of_it(
    host: Host,
) -> None:
    bucket = a_bucket_holding_both()

    answer = read_the_copies(host, bucket, (THE_INVOICE,))

    assert text_of(answer, AN_INVOICE_ID) == AN_INVOICE_REDACTED
    assert answer.documents[0].redacted.verdict is None
    assert dict(answer.documents[0].redacted.counts) == {"bank-details": 1}
    assert answer.documents[0].redacted.version == f"{RULE_VERSION}:{DETECTOR_PIN}"


def bytes_under(directory: Path) -> bytes:
    return b"".join(
        path.read_bytes() for path in sorted(directory.rglob("*")) if path.is_file()
    )


def bytes_of(host: Host, store: str) -> bytes:
    return bytes_under(host.store_directory(a_run(), store))


# In a process of its own because the tier may not import the engine.
A_MEMO_THAT_KEEPS_ITS_TEXT = """
import sys

import cocoindex as coco


@coco.fn(memo=True)
def kept(text: str) -> str:
    return text


@coco.fn
async def one_document(text: str, read: dict) -> None:
    read["it"] = await coco.use_mount(coco.component_subpath("the-seam"), kept, text)


@coco.fn
async def every_document(text: str, read: dict) -> int:
    await coco.mount_each(
        coco.component_subpath("a-document"), one_document, [("only", text)], read
    )
    return 1


store, sentence = sys.argv[1], sys.argv[2]
read = {}
coco.App(
    coco.AppConfig(
        name="landed",
        environment=coco.Environment(
            coco.Settings(db_path=store), name="the control"
        ),
    ),
    every_document,
    sentence,
    read,
).update_blocking()
"""


def a_control_memo_over(sentence: bytes, store: Path) -> None:
    store.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        (
            sys.executable,
            "-c",
            A_MEMO_THAT_KEEPS_ITS_TEXT,
            str(store),
            sentence.decode(),
        ),
        env={
            **os.environ,
            "COCOINDEX_DISABLE_USAGE_TRACKING": "1",
            "RUST_LOG": "warn",
        },
        capture_output=True,
        check=True,
    )


A_SENTENCE_OF_THE_INVOICE = b"Invoice 2026-041 is due on receipt."


A_PLACEHOLDER_WORD = b"[withheld]"


THE_RULE_THE_MEMO_STORES = b"UK_BANK_ACCOUNT"


HER_NAME = b"Priya Raman"


def test_neither_store_is_ever_found_holding_the_text_or_a_span_the_seam_withheld(
    host: Host, tmp_path: Path
) -> None:
    bucket = a_bucket_holding_both()
    control = tmp_path / "a-control" / FINDINGS_STORE

    read_the_copies(host, bucket, (THE_INVOICE,))
    a_control_memo_over(A_SENTENCE_OF_THE_INVOICE, control)

    findings, binding = bytes_of(host, FINDINGS_STORE), bytes_of(host, BINDING_STORE)

    # Both ways, so an absence below is the store's and never the scan's.
    assert THE_RULE_THE_MEMO_STORES in findings
    assert A_SENTENCE_OF_THE_INVOICE in bytes_under(control)
    for held in (findings, binding):
        assert THE_ACCOUNT_NUMBER.encode() not in held
        assert b"00-00-00" not in held
        assert A_PLACEHOLDER_WORD not in held
        assert A_SENTENCE_OF_THE_INVOICE not in held


def test_a_wipe_takes_the_bindings_store_leaves_the_memo_and_erases_the_named_person(
    host: Host,
) -> None:
    bucket = a_bucket_holding_both()
    both = (THE_INVOICE, THE_DELIVERY_NOTE)
    erased = (
        THE_INVOICE,
        a_landed_document(A_DELIVERY_NOTE_ID, suppressions=(HER_ERASURE_REQUEST,)),
    )

    read_the_copies(host, bucket, both)
    host.remove_binding_store(a_run())
    answer = read_the_copies(host, bucket, erased)

    assert answer.detected_afresh == ()
    assert text_of(answer, A_DELIVERY_NOTE_ID) == A_DELIVERY_NOTE_SUPPRESSED
    findings, binding = bytes_of(host, FINDINGS_STORE), bytes_of(host, BINDING_STORE)
    assert THE_RULE_THE_MEMO_STORES in findings
    for held in (findings, binding):
        assert HER_NAME not in held


def test_a_second_run_over_an_unchanged_document_detects_nothing_afresh(
    host: Host,
) -> None:
    bucket = a_bucket_holding_both()
    both = (THE_INVOICE, THE_DELIVERY_NOTE)

    first = read_the_copies(host, bucket, both)
    again = read_the_copies(host, bucket, both)

    assert sorted(first.detected_afresh) == [AN_INVOICE_ID, A_DELIVERY_NOTE_ID]
    assert again.detected_afresh == ()
    assert text_of(again, AN_INVOICE_ID) == AN_INVOICE_REDACTED
    assert text_of(again, A_DELIVERY_NOTE_ID) == A_DELIVERY_NOTE


def test_a_suppression_withholds_the_name_and_sends_the_detector_over_nothing(
    host: Host,
) -> None:
    bucket = a_bucket_holding_both()
    before = (THE_INVOICE, THE_DELIVERY_NOTE)
    after = (
        THE_INVOICE,
        a_landed_document(A_DELIVERY_NOTE_ID, suppressions=(HER_ERASURE_REQUEST,)),
    )

    read_the_copies(host, bucket, before)
    answer = read_the_copies(host, bucket, after)

    assert answer.detected_afresh == ()
    assert text_of(answer, A_DELIVERY_NOTE_ID) == A_DELIVERY_NOTE_SUPPRESSED
    assert text_of(answer, AN_INVOICE_ID) == AN_INVOICE_REDACTED


def test_an_erasure_after_the_first_run_withholds_her_work_address_on_the_next(
    host: Host,
) -> None:
    rota = a_landed_document(A_ROTA_ID)
    bucket = ABucket({rota.original_key: A_ROTA.encode()})
    erased = a_landed_document(A_ROTA_ID, suppressions=(HER_ERASURE_REQUEST,))

    first = read_the_copies(host, bucket, (rota,), rules_in_force=NOTHING_SWITCHABLE)
    answer = read_the_copies(host, bucket, (erased,), rules_in_force=NOTHING_SWITCHABLE)

    assert text_of(first, A_ROTA_ID) == A_ROTA
    assert answer.detected_afresh == ()
    assert text_of(answer, A_ROTA_ID) == A_ROTA_ERASED
    assert answer.documents[0].redacted.findings == first.documents[0].redacted.findings


def test_a_keep_puts_the_span_back_in_the_text_and_detects_nothing_afresh(
    host: Host,
) -> None:
    bucket = a_bucket_holding_both()
    before = (THE_INVOICE, THE_DELIVERY_NOTE)
    after = (
        a_landed_document(
            AN_INVOICE_ID,
            restores=(Restore(rule_id="UK_BANK_ACCOUNT", start=54, end=97),),
        ),
        THE_DELIVERY_NOTE,
    )

    read_the_copies(host, bucket, before)
    answer = read_the_copies(host, bucket, after)

    assert answer.detected_afresh == ()
    assert text_of(answer, AN_INVOICE_ID) == AN_INVOICE
    assert text_of(answer, A_DELIVERY_NOTE_ID) == A_DELIVERY_NOTE


AN_INVOICE_KEPT_BUT_ERASED = (
    "Invoice 2026-041 is due on receipt.\n\n"
    "The sort code is 00-00-00 and the account number is [withheld].\n\n"
    "Delivery follows within ten working days of a signed order.\n"
)


def test_a_kept_span_naming_an_erased_identifier_keeps_that_identifier_withheld(
    host: Host,
) -> None:
    bucket = a_bucket_holding_both()
    kept = Restore(rule_id="UK_BANK_ACCOUNT", start=54, end=97)
    her_account = suppression_of(
        {"emails": (), "names": (), "other": (THE_ACCOUNT_NUMBER,)}
    )

    read_the_copies(host, bucket, (a_landed_document(AN_INVOICE_ID, restores=(kept,)),))
    answer = read_the_copies(
        host,
        bucket,
        (
            a_landed_document(
                AN_INVOICE_ID, suppressions=(her_account,), restores=(kept,)
            ),
        ),
    )

    assert answer.detected_afresh == ()
    assert text_of(answer, AN_INVOICE_ID) == AN_INVOICE_KEPT_BUT_ERASED


def test_a_run_under_a_moved_detection_key_detects_every_document_afresh(
    host: Host,
) -> None:
    bucket = a_bucket_holding_both()
    both = (THE_INVOICE, THE_DELIVERY_NOTE)

    read_the_copies(host, bucket, both)
    answer = read_the_copies(
        host, bucket, both, detection_key="a-recogniser-nobody-shipped-yet"
    )

    assert sorted(answer.detected_afresh) == [AN_INVOICE_ID, A_DELIVERY_NOTE_ID]


def test_a_rule_switched_off_on_the_binding_detects_nothing_afresh(host: Host) -> None:
    bucket = a_bucket_holding_both()
    both = (THE_INVOICE, THE_DELIVERY_NOTE)

    read_the_copies(host, bucket, both)
    answer = read_the_copies(
        host, bucket, both, rules_in_force={"default_on": False, "default_off": False}
    )

    assert answer.detected_afresh == ()
    assert text_of(answer, AN_INVOICE_ID) == AN_INVOICE_REDACTED


def test_a_moved_normalised_text_detects_that_document_and_no_other(
    host: Host,
) -> None:
    bucket = a_bucket_holding_both()
    both = (THE_INVOICE, THE_DELIVERY_NOTE)

    read_the_copies(host, bucket, both)
    bucket.objects[THE_DELIVERY_NOTE.original_key] = A_DELIVERY_NOTE.replace(
        "The depot opens at seven.", "The depot opens at six."
    ).encode()
    answer = read_the_copies(host, bucket, both)

    assert answer.detected_afresh == (A_DELIVERY_NOTE_ID,)


def test_another_converter_over_the_same_normalised_text_detects_nothing_afresh(
    host: Host,
) -> None:
    # Two converters, one text: the text is the key, so the second run answers out of
    # the memo the first filled.
    bucket = a_bucket_holding_both()
    as_markdown = a_landed_document(AN_INVOICE_ID, media_type="text/markdown")
    as_plain_text = a_landed_document(AN_INVOICE_ID, media_type="text/plain")

    first = read_the_copies(host, bucket, (as_markdown,))
    answer = read_the_copies(host, bucket, (as_plain_text,))

    assert first.detected_afresh == (AN_INVOICE_ID,)
    assert answer.detected_afresh == ()
    assert text_of(answer, AN_INVOICE_ID) == AN_INVOICE_REDACTED


def test_the_memoised_functions_identity_is_six_facts_and_a_move_is_a_reprocess() -> (
    None
):
    assert dict(THE_MEMOS_IDENTITY) == {
        "app": "landed",
        "directory": "findings",
        "module": "better_answers_worker.pipeline.detected",
        "mount_path": "a-document/the-seam",
        "qualified_name": "detected",
        "version": "1",
    }
    assert getattr(pipeline, THE_MEMOS_IDENTITY["qualified_name"]) is detected


THE_TIERS_SOURCE = Path(__file__).resolve().parents[1] / "src"


def test_the_detector_is_the_only_function_the_estate_memoises() -> None:
    memoised = sorted(
        (str(path.relative_to(THE_TIERS_SOURCE)), line.strip())
        for path in THE_TIERS_SOURCE.rglob("*.py")
        for line in path.read_text(encoding="utf-8").splitlines()
        if "memo=True" in line
    )

    assert memoised == [
        (
            "better_answers_worker/pipeline/detected.py",
            "@coco.fn(memo=True, version=THE_MEMOS_VERSION)",
        )
    ]


def test_nothing_but_the_text_and_the_detection_key_reaches_the_memos_key() -> None:
    assert list(signature(raised_by_the_detector).parameters) == [
        "normalised_text",
        "detection_key",
    ]


def test_the_normalised_redacted_text_lands_under_the_documents_normalised_key(
    host: Host,
) -> None:
    bucket = a_bucket_holding_both()

    read_the_copies(host, bucket, (THE_INVOICE,))

    assert bucket.writes == [THE_INVOICE.normalised_key]
    assert bucket.objects[THE_INVOICE.normalised_key] == AN_INVOICE_REDACTED.encode()


def test_the_original_landed_copy_is_read_and_never_written(host: Host) -> None:
    bucket = a_bucket_holding_both()

    read_the_copies(host, bucket, (THE_INVOICE,))

    assert bucket.reads == [THE_INVOICE.original_key]
    assert THE_INVOICE.original_key not in bucket.writes
    assert bucket.objects[THE_INVOICE.original_key] == AN_INVOICE.encode()


def test_a_landed_copy_is_reached_under_the_workspaces_own_prefix() -> None:
    assert (
        object_key_of(WORKSPACE, "documents/01m2q3r4s5t6v7w8x9yzab0001/original")
        == "workspaces/01M2Q3R4S5T6V7W8X9YZAB0000"
        "/documents/01m2q3r4s5t6v7w8x9yzab0001/original"
    )


@pytest.mark.parametrize("media_type", ["text/markdown", "text/plain"])
def test_markdown_and_plain_text_pass_through_as_the_normalised_text(
    host: Host, media_type: str
) -> None:
    document = a_landed_document(AN_INVOICE_ID, media_type=media_type)
    bucket = ABucket({document.original_key: AN_INVOICE.encode()})

    answer = read_the_copies(host, bucket, (document,))

    assert text_of(answer, AN_INVOICE_ID) == AN_INVOICE_REDACTED


def test_plain_text_lands_as_its_own_bytes_redacted_and_cut_into_more_than_one_chunk(
    host: Host,
) -> None:
    terms = a_landed_document(A_TERMS_ID, media_type="text/plain")
    bucket = ABucket({terms.original_key: fixture_bytes("delivery-terms.txt")})

    answer = read_the_copies(host, bucket, (terms,))
    chunks = answer.documents[0].chunks

    assert text_of(answer, A_TERMS_ID) == A_TERMS_REDACTED
    assert THE_ACCOUNT_NUMBER not in text_of(answer, A_TERMS_ID)
    assert bucket.objects[terms.normalised_key] == A_TERMS_REDACTED.encode()
    assert len(chunks) == 2
    assert "".join(chunk.content for chunk in chunks) == A_TERMS_REDACTED
    assert [chunk.id for chunk in chunks] == [
        f"{A_TERMS_ID}#000000",
        f"{A_TERMS_ID}#000001",
    ]
    assert chunks[1].char_start == chunks[0].char_end


def test_a_docx_converts_to_markdown_with_its_table_and_the_seam_reads_what_it_wrote(
    host: Host,
) -> None:
    policy = a_landed_document(A_POLICY_ID, media_type=DOCX_MEDIA_TYPE)
    bucket = ABucket({policy.original_key: fixture_bytes("expenses-policy.docx")})

    answer = read_the_copies(host, bucket, (policy,))

    assert text_of(answer, A_POLICY_ID) == A_POLICY_REDACTED
    assert "| Hotel | 120 |" in text_of(answer, A_POLICY_ID)
    assert THE_ACCOUNT_NUMBER not in text_of(answer, A_POLICY_ID)
    assert bucket.objects[policy.normalised_key] == A_POLICY_REDACTED.encode()

    assert "".join(chunk.content for chunk in answer.documents[0].chunks) == (
        A_POLICY_REDACTED
    )
    assert answer.documents[0].chunks[0].id == f"{A_POLICY_ID}#000000"


def test_a_pdf_converts_to_markdown_with_its_table(host: Host) -> None:
    rate_card = a_landed_document(A_RATE_CARD_ID, media_type=PDF_MEDIA_TYPE)
    bucket = ABucket({rate_card.original_key: fixture_bytes("rate-card.pdf")})

    answer = read_the_copies(host, bucket, (rate_card,))

    assert text_of(answer, A_RATE_CARD_ID) == A_RATE_CARD_CONVERTED
    assert "|Survey|450|" in text_of(answer, A_RATE_CARD_ID)
    assert "".join(chunk.content for chunk in answer.documents[0].chunks) == (
        A_RATE_CARD_CONVERTED
    )


def test_a_pdf_with_a_page_that_has_no_text_layer_is_quarantined_whole(
    host: Host,
) -> None:
    scan = a_landed_document(A_SCAN_ID, media_type=PDF_MEDIA_TYPE)
    bucket = ABucket(
        {
            scan.original_key: fixture_bytes("scanned-invoice.pdf"),
            THE_DELIVERY_NOTE.original_key: A_DELIVERY_NOTE.encode(),
        }
    )

    answer = read_the_copies(host, bucket, (scan, THE_DELIVERY_NOTE))

    assert quarantine_of(answer) == {A_SCAN_ID: "NeedsOcrError"}
    assert [document.source_document_id for document in answer.documents] == [
        A_DELIVERY_NOTE_ID
    ]
    assert bucket.writes == [THE_DELIVERY_NOTE.normalised_key]


def test_a_document_the_converter_cannot_read_takes_no_neighbour_with_it(
    host: Host,
) -> None:
    truncated = a_landed_document(A_TRUNCATED_ID, media_type=DOCX_MEDIA_TYPE)
    bucket = ABucket(
        {
            truncated.original_key: fixture_bytes("expenses-policy.docx")[:400],
            THE_DELIVERY_NOTE.original_key: A_DELIVERY_NOTE.encode(),
        }
    )

    answer = read_the_copies(host, bucket, (truncated, THE_DELIVERY_NOTE))

    assert list(quarantine_of(answer)) == [A_TRUNCATED_ID]
    assert quarantine_of(answer)[A_TRUNCATED_ID] != ""
    assert text_of(answer, A_DELIVERY_NOTE_ID) == A_DELIVERY_NOTE
    assert bucket.writes == [THE_DELIVERY_NOTE.normalised_key]


def test_a_media_type_outside_the_allow_list_is_quarantined_and_never_guessed_at(
    host: Host,
) -> None:
    spreadsheet = a_landed_document(A_TRUNCATED_ID, media_type="application/zip")
    bucket = ABucket({spreadsheet.original_key: fixture_bytes("expenses-policy.docx")})

    answer = read_the_copies(host, bucket, (spreadsheet,))

    assert quarantine_of(answer) == {A_TRUNCATED_ID: "UnsupportedMediaType"}
    assert answer.documents == ()


def test_anydoc_is_told_to_reject_ocr_so_no_unredacted_byte_leaves_the_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import anydoc

    assert OCR_ANSWER == "reject"
    assert set(get_args(anydoc.Ocr)) == {"reject", "hosted"}
    assert signature(anydoc.to_markdown_bytes).parameters["ocr"].default == OCR_ANSWER

    asked: list[tuple[object, object, dict[str, object]]] = []

    def record(data: bytes, as_format: object = None, **rest: object) -> str:
        asked.append((as_format, rest.pop("ocr", None), rest))
        return "# Recorded"

    monkeypatch.setattr(anydoc, "to_markdown_bytes", record)

    assert converted(b"a zip nothing reads", DOCX_MEDIA_TYPE) == "# Recorded"
    assert asked == [("docx", "reject", {})]


def test_the_converter_pin_reads_its_two_libraries_and_is_in_no_memos_key() -> None:
    assert converter_pin_of("0.2.4", "1.22.0") == "anydoc-0.2.4+pdf-inspector-1.22.0"
    assert converter_pin_of("0.2.5", "1.22.0") != converter_pin_of("0.2.4", "1.22.0")
    assert converter_pin_of("0.2.4", "1.23.0") != converter_pin_of("0.2.4", "1.22.0")
    assert CONVERTER_PIN not in THE_MEMOS_IDENTITY.values()


def test_the_document_row_keeps_the_seams_version_and_not_the_converters(
    host: Host,
) -> None:
    bucket = a_bucket_holding_both()

    answer = read_the_copies(host, bucket, (THE_INVOICE,))

    assert answer.documents[0].redacted.version == f"{RULE_VERSION}:{DETECTOR_PIN}"
    assert CONVERTER_PIN not in answer.documents[0].redacted.version


def test_the_timeout_is_the_seams_ms_per_page_times_the_pages_and_a_margin() -> None:
    assert SEAM_MS_PER_PAGE == 6453
    assert TIMEOUT_MARGIN_MS == 93_000
    assert timeout_for(1).total_seconds() == pytest.approx(99.453)
    assert timeout_for(12).total_seconds() == pytest.approx(170.436)
    assert timeout_for(12) - timeout_for(11) == timeout_for(1) - timeout_for(0)


def test_a_pdfs_pages_are_read_and_the_other_types_measured_against_s0s_page() -> None:
    assert pages_of(fixture_bytes("rate-card.pdf"), PDF_MEDIA_TYPE) == 1
    assert pages_of(b"", "text/markdown") == 1
    assert pages_of(b"a" * 3107, "text/markdown") == 1
    assert pages_of(b"a" * 3108, "text/markdown") == 2

    assert pages_of(fixture_bytes("expenses-policy.docx"), DOCX_MEDIA_TYPE) == 12


def test_a_document_that_runs_past_its_ceiling_is_quarantined_and_the_run_finishes(
    host: Host,
) -> None:
    bucket = a_bucket_holding_both()

    answer = read_the_copies(host, bucket, (THE_INVOICE,), ms_per_page=0, margin_ms=0)

    assert quarantine_of(answer) == {AN_INVOICE_ID: "DeadlineExceededError"}
    assert answer.documents == ()
    assert bucket.writes == []


def test_the_same_document_under_the_shipped_ceiling_lands(host: Host) -> None:
    bucket = a_bucket_holding_both()

    answer = read_the_copies(host, bucket, (THE_INVOICE,))

    assert answer.quarantined == ()
    assert text_of(answer, AN_INVOICE_ID) == AN_INVOICE_REDACTED


def test_a_documents_chunks_are_cut_out_of_the_redacted_text_and_never_the_original(
    host: Host,
) -> None:
    bucket = a_bucket_holding_both()

    answer = read_the_copies(host, bucket, (THE_INVOICE,))
    chunks: tuple[Chunk, ...] = answer.documents[0].chunks

    assert "".join(chunk.content for chunk in chunks) == AN_INVOICE_REDACTED
    assert all(THE_ACCOUNT_NUMBER not in chunk.content for chunk in chunks)
    assert chunks[0].id == f"{AN_INVOICE_ID}#000000"
    assert chunks[0].locator.startswith(f"{AN_INVOICE_ID}/chars:0-")


def test_a_suppression_is_held_as_sorted_pairs_so_one_set_has_one_key() -> None:
    one = suppression_of({"name": ("Priya Raman",), "email": ("p@example.test",)})
    other = suppression_of({"email": ("p@example.test",), "name": ("Priya Raman",)})

    assert one == other
    assert one.identifiers == (
        ("email", ("p@example.test",)),
        ("name", ("Priya Raman",)),
    )
