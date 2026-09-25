from typing import Protocol

import boto3

from ..config import ObjectStore

WORKSPACE_PREFIX = "workspaces"


def object_key_of(workspace_id: str, key: str) -> str:
    return f"{WORKSPACE_PREFIX}/{workspace_id}/{key}"


class LandedCopies(Protocol):
    """Objects by the catalogue's key, which is relative to one workspace's prefix."""

    def read(self, key: str) -> bytes: ...

    def write(self, key: str, body: bytes) -> None: ...


class Bucket:
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
