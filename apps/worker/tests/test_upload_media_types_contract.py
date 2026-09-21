"""The upload-media-types agreement's Python half (ADR 0031).

The TypeScript half is ``packages/core/test/upload-media-types.contract.test.ts``, and
the two read the same file in ``contracts/upload-media-types/``: the media types an
upload is admitted under, and a few it is not.

**This tier is the one that converts what the app admitted.** The bind act refuses a
media type outside the list while the Admin still has the file; this tier dispatches on
the type the catalogue row carries and quarantines a document whose type has no
converter. A type the app admits and this tier cannot convert is a binding that will
never answer anything, and nothing fails until an Admin finds their document
quarantined — so the dispatch's keys are held to the file the app's allow-list is held
to.

Neither half holds the other's literals: the TypeScript half reads the constant the bind
act enforces, and this one reads ``CONVERTERS``, the mapping ``converted`` dispatches
through — its keys rather than a list written beside it, because a list beside a
dispatch is a second list. The row a type outside the list lands as is the seeded
half's, in ``test_pipeline_index.py``, beside the database a run writes to.
"""

import json
from pathlib import Path
from typing import Any, cast

import pytest

from better_answers_worker.pipeline import CONVERTERS, UnreadableError, converted

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"


def read_upload_media_types() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "upload-media-types" / "cases.json").read_text(
        encoding="utf-8"
    )
    return cast("dict[str, Any]", json.loads(raw))


def test_the_dispatch_converts_every_admitted_type_and_no_other() -> None:
    admitted = read_upload_media_types()["admitted"]

    assert sorted(CONVERTERS) == sorted(admitted)


def test_the_agreement_places_no_type_on_both_sides_of_the_list() -> None:
    # A type both admitted and outside would make the seeded half and this one disagree
    # about the same file, and whichever ran last would look like the broken one.
    fixture = read_upload_media_types()

    assert fixture["outside"]
    for outside in fixture["outside"]:
        assert outside["media_type"] not in fixture["admitted"], outside["why"]


@pytest.mark.parametrize(
    "media_type",
    [outside["media_type"] for outside in read_upload_media_types()["outside"]],
)
def test_a_type_outside_the_list_reaches_no_converter_whatever_its_bytes_resemble(
    media_type: str,
) -> None:
    """The dispatch's other arm, asked of the function and not of the mapping: a type
    with no converter is refused under this module's own word before a byte is looked
    at, so the bytes of a perfectly good markdown document convert under no name but
    their own.
    """
    with pytest.raises(UnreadableError) as refused:
        converted(b"# A heading\n", media_type)

    assert refused.value.name == "UnsupportedMediaType"
