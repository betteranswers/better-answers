"""The bootstrap credential class, and the only place in the tier that reads the
environment.

The bootstrap class is what the deploy unit must give the process before it can reach
anything. Every other credential class — ingestion, acting, agent, LLM provider,
repository, object store — is a row under the envelope, decrypted by the app and
injected per run through the control plane, and never mixed into this scope (ADR 0005).
The object store and the embedding host join this module the day a step in this tier
reads them (B7).
"""

import socket
from collections.abc import Mapping
from dataclasses import dataclass
from os import environ

REQUIRED = ("DATABASE_URL", "GIT_STORE_DIR")


class BootstrapError(ValueError):
    """The worker was started without the environment the deploy unit owes it."""


@dataclass(frozen=True, slots=True)
class Bootstrap:
    database_url: str
    #: Where the bare repositories live, one per workspace (ADR 0024). Mounted
    #: read-only: the app is the only writer of a bundle, and this tier reads one at a
    #: commit.
    git_store_dir: str
    #: Which worker this is, on every claim and every lease it holds. The container's
    #: hostname unless the deploy unit says otherwise, which is what makes two replicas
    #: of one image tell themselves apart with nothing to configure.
    worker_id: str


def read_bootstrap(environment: Mapping[str, str] | None = None) -> Bootstrap:
    """Read and validate the bootstrap environment, or say exactly what is missing."""
    source = environ if environment is None else environment

    missing = [name for name in REQUIRED if not source.get(name)]
    if missing:
        raise BootstrapError(
            "bootstrap configuration is incomplete: " + ", ".join(missing)
        )

    return Bootstrap(
        database_url=source["DATABASE_URL"],
        git_store_dir=source["GIT_STORE_DIR"],
        worker_id=source.get("WORKER_ID") or socket.gethostname(),
    )
