import os

os.environ["COCOINDEX_DISABLE_USAGE_TRACKING"] = "1"
os.environ["RUST_LOG"] = os.environ.get("RUST_LOG") or "warn"

from .converter import (
    CONVERTER_PIN,
    CONVERTERS,
    DOCX_MEDIA_TYPE,
    OCR_ANSWER,
    PASSED_THROUGH,
    PDF_MEDIA_TYPE,
    UnreadableError,
    converted,
    converter_pin_of,
    pages_of,
)
from .detected import detected, raised_by_the_detector
from .host import (
    CONNECTED_SOURCE_STORE,
    ENVIRONMENTS_HELD,
    FINDINGS_STORE,
    LANDED_APP,
    PASSAGES_APP,
    STORES_A_CONNECTED_SOURCE_HOLDS,
    Host,
    Sync,
    open_pool,
)
from .landed import (
    SEAM_MS_PER_PAGE,
    THE_MEMOS_IDENTITY,
    TIMEOUT_MARGIN_MS,
    LandedDocument,
    LandedSync,
    ReadDocument,
    RedactedDocument,
    Suppression,
    UnreadableDocument,
    redact_landed_copies,
    suppression_of,
    timeout_for,
)
from .objects import Bucket, LandedCopies, object_key_of
from .passages import (
    PASSAGE_SIZE_BYTES,
    Passage,
    locator_of,
    passage_id_of,
    split_into_passages,
)
from .rows import PASSAGE_TABLE, passage_rows, rows_of
from .run import (
    REASONS_EMPTYING_THE_CONNECTED_SOURCE,
    WIPED_REASON,
    IndexOutcome,
    index_connected_source,
)
from .tables import Column, Table

__all__ = [
    "CONNECTED_SOURCE_STORE",
    "CONVERTERS",
    "CONVERTER_PIN",
    "DOCX_MEDIA_TYPE",
    "ENVIRONMENTS_HELD",
    "FINDINGS_STORE",
    "LANDED_APP",
    "OCR_ANSWER",
    "PASSAGES_APP",
    "PASSAGE_SIZE_BYTES",
    "PASSAGE_TABLE",
    "PASSED_THROUGH",
    "PDF_MEDIA_TYPE",
    "REASONS_EMPTYING_THE_CONNECTED_SOURCE",
    "SEAM_MS_PER_PAGE",
    "STORES_A_CONNECTED_SOURCE_HOLDS",
    "THE_MEMOS_IDENTITY",
    "TIMEOUT_MARGIN_MS",
    "WIPED_REASON",
    "Bucket",
    "Column",
    "Host",
    "IndexOutcome",
    "LandedCopies",
    "LandedDocument",
    "LandedSync",
    "Passage",
    "ReadDocument",
    "RedactedDocument",
    "Suppression",
    "Sync",
    "Table",
    "UnreadableDocument",
    "UnreadableError",
    "converted",
    "converter_pin_of",
    "detected",
    "index_connected_source",
    "locator_of",
    "object_key_of",
    "open_pool",
    "pages_of",
    "passage_id_of",
    "passage_rows",
    "raised_by_the_detector",
    "redact_landed_copies",
    "rows_of",
    "split_into_passages",
    "suppression_of",
    "timeout_for",
]
