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


def test_no_type_sits_on_both_sides_of_the_list() -> None:

    fixture = read_upload_media_types()

    assert fixture["outside"]
    for outside in fixture["outside"]:
        assert outside["media_type"] not in fixture["admitted"], outside["why"]


@pytest.mark.parametrize(
    "media_type",
    [outside["media_type"] for outside in read_upload_media_types()["outside"]],
)
def test_a_type_outside_the_list_reaches_no_converter(
    media_type: str,
) -> None:
    with pytest.raises(UnreadableError) as refused:
        converted(b"# A heading\n", media_type)

    assert refused.value.name == "UnsupportedMediaType"
