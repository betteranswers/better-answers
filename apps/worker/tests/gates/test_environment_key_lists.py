from collections.abc import Iterator, Mapping

from better_answers_worker.config import OPTIONAL, REQUIRED, read_bootstrap


class Recorded(Mapping[str, str]):
    def __init__(self, held: Mapping[str, str]) -> None:
        self.held = held
        self.asked: set[str] = set()

    def __getitem__(self, name: str) -> str:
        self.asked.add(name)
        return self.held[name]

    def __iter__(self) -> Iterator[str]:
        return iter(self.held)

    def __len__(self) -> int:
        return len(self.held)


def test_the_key_lists_name_every_variable_read_bootstrap_reads() -> None:
    source = Recorded(dict.fromkeys(REQUIRED, "x"))

    read_bootstrap(source)

    assert source.asked == set(REQUIRED) | set(OPTIONAL)


def test_the_required_and_optional_lists_do_not_overlap() -> None:
    assert set(REQUIRED) & set(OPTIONAL) == set()
