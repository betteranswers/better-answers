"""The object store, as the pipeline needs it: two keys and some bytes.

The worker reads a landed copy and writes the normalised one beside it, and that is the
whole of what this tier asks of the estate's bucket — the bytes are addressed by keys
the document's catalogue row already holds and nothing here walks a prefix. So the
interface below is two methods, and the engine's own S3 source is not composed: a source
that enumerated a bucket would be a second catalogue beside the one the app keeps.

**The workspace's prefix is added here and is not in the column.** The app reaches the
store through a door that puts every read and write under `workspaces/<workspace id>/`
and stores what is left of the key (`packages/core/src/store/objects/index.ts`), so
`original_key` and `normalised_key` are keys *inside* that prefix. A worker that asked
the bucket for the column's value alone would find nothing there — and would find it
silently, because a key that is not in a bucket is not an error until something reads
it.

**The client is built from the bootstrap and reads no environment**: the config module
is the only reader of the environment in this tier, and a client that reached for a
variable of its own would be a second one. Path-style addressing, because the estate
reaches Garage by service name on an internal network where a virtual-host style address
has no DNS — the same reason the app's door gives.
"""

from typing import Protocol

import boto3

from ..config import ObjectStore

#: Where a workspace's own objects sit. Spelled the way the app's door spells it, and
#: the two are held apart by nothing but this comment: the prefix is a convention over
#: the bucket rather than a value either tier stores, so a change to it is a change to
#: both.
WORKSPACE_PREFIX = "workspaces"


def object_key_of(workspace_id: str, key: str) -> str:
    """The key the bucket holds, from the key the catalogue row carries."""
    return f"{WORKSPACE_PREFIX}/{workspace_id}/{key}"


class LandedCopies(Protocol):
    """A document's two copies, read and written by the keys its catalogue row holds.

    Plain types on both sides, and the workspace is already decided: an implementation
    is one workspace's view of the store, so no caller can read across the boundary by
    passing the wrong id.
    """

    def read(self, key: str) -> bytes:
        """The bytes at this key, or an error from the client if it holds none."""
        ...

    def write(self, key: str, body: bytes) -> None:
        """Put these bytes at this key, replacing whatever was there."""
        ...


class Bucket:
    """The estate's object store, reached for one workspace's copies."""

    __slots__ = ("_bucket", "_client", "_workspace_id")

    def __init__(self, settings: ObjectStore, workspace_id: str) -> None:
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.endpoint,
            region_name=settings.region,
            aws_access_key_id=settings.access_key,
            aws_secret_access_key=settings.secret_key,
        )
        self._bucket = settings.bucket
        self._workspace_id = workspace_id

    def read(self, key: str) -> bytes:
        answer = self._client.get_object(
            Bucket=self._bucket, Key=object_key_of(self._workspace_id, key)
        )
        body: bytes = answer["Body"].read()
        return body

    def write(self, key: str, body: bytes) -> None:
        self._client.put_object(
            Bucket=self._bucket,
            Key=object_key_of(self._workspace_id, key),
            Body=body,
        )
