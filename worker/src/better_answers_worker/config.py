"""The bootstrap credential class, and the only place in the tier that reads the
environment (`[SEC1]`).

The bootstrap class is what the deploy unit must give the process before it can reach
anything. Every other credential class — ingestion, acting, agent, LLM provider,
repository, object store — is a row under the envelope, decrypted by the app and
injected per run through the control plane, and never mixed into this scope
(`[SEC1]`, ADR 0005). The object store and the embedding host join this module the
day a step in this tier reads them (B7).
"""

from collections.abc import Mapping
from dataclasses import dataclass
from os import environ

REQUIRED = ("DATABASE_URL",)


class BootstrapError(ValueError):
    """The worker was started without the environment the deploy unit owes it."""


@dataclass(frozen=True, slots=True)
class Bootstrap:
    database_url: str


def read_bootstrap(environment: Mapping[str, str] | None = None) -> Bootstrap:
    """Read and validate the bootstrap environment, or say exactly what is missing."""
    source = environ if environment is None else environment

    missing = [name for name in REQUIRED if not source.get(name)]
    if missing:
        raise BootstrapError(
            "bootstrap configuration is incomplete: " + ", ".join(missing)
        )

    return Bootstrap(database_url=source["DATABASE_URL"])
