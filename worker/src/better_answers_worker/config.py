"""The bootstrap credential class, and the only place in the tier that reads the
environment (`[SEC1]`).

Every tenant credential is a row under the envelope, decrypted by the app and handed
to a run through the control plane; the worker never holds the master key (ADR 0005).
"""

from collections.abc import Mapping
from dataclasses import dataclass
from os import environ

REQUIRED = ("DATABASE_URL", "S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY")


class BootstrapError(ValueError):
    """The worker was started without the environment the deploy unit owes it."""


@dataclass(frozen=True, slots=True)
class Bootstrap:
    database_url: str
    object_store_endpoint: str
    object_store_access_key: str
    object_store_secret_key: str
    embeddings_url: str | None


def read_bootstrap(environment: Mapping[str, str] | None = None) -> Bootstrap:
    """Read and validate the bootstrap environment, or say exactly what is missing."""
    source = environ if environment is None else environment

    missing = [name for name in REQUIRED if not source.get(name)]
    if missing:
        raise BootstrapError(
            "bootstrap configuration is incomplete: " + ", ".join(missing)
        )

    # Unset in the first estate: no embedding host runs there, and the first client
    # is on the hosted route (deploy/platform.compose.yaml, ADR 0024).
    embeddings_url = source.get("EMBEDDINGS_URL") or None

    return Bootstrap(
        database_url=source["DATABASE_URL"],
        object_store_endpoint=source["S3_ENDPOINT"],
        object_store_access_key=source["S3_ACCESS_KEY"],
        object_store_secret_key=source["S3_SECRET_KEY"],
        embeddings_url=embeddings_url,
    )
