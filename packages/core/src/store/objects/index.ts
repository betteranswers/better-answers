import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

import {
  err,
  ok,
  type PlatformPrincipal,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";

/**
 * The object-store door. Per-workspace prefix discipline lives here alone, so there is
 * one place to read to know a tenant's bytes cannot be addressed from another tenant.
 *
 * RLS does not reach here — this is a bucket, not a table — so **Principal-first-argument
 * is load-bearing rather than decorative**, exactly as it is in the git door: the prefix a
 * call reaches is derived from the Principal it was made with and never from a caller's
 * string. A `UserPrincipal` reaches `workspaces/<workspace id>/` and nothing else
 * (`CONTEXT.md`, *workspace*: every object-store prefix carries its workspace id); the
 * platform's own entries take a `PlatformPrincipal` and reach `platform/`, where the
 * erasure routine's replay copy lives. No entry takes a prefix, so no call site can name
 * one workspace's bytes while acting as another's member, and the key a caller passes is
 * always a key *within* a prefix.
 *
 * One bucket for the estate, prefixes inside it: Garage has no per-tenant credential scheme
 * the platform could lean on, and a bucket per workspace would be a provisioning step that
 * can fail halfway. What isolates a tenant is this module's arithmetic, which is why it is
 * this short and why the suite that proves it checks both directions.
 *
 * S3 is a protocol we consume, never code we write (ADR 0005), so the AWS client is
 * imported here and in no other file in the package — `better-answers/import-direction`
 * is what keeps that true. Garage is path-style addressed in its own region
 * (`deploy/garage.toml`).
 *
 * ADR 0029 rule 2 — `store` imports only `kernel`. No store file imports another store file.
 */

export { GARAGE_IMAGE } from "./garage-image.ts";

/** What the deploy unit hands the door: where the store is, and the credential for it. */
export type ObjectStoreSettings = {
  /** The S3 endpoint, absolute — `http://objectstore:3900` in the estate. */
  readonly endpoint: string;
  /** Garage's own region name, which is configuration and not a place (`deploy/garage.toml`). */
  readonly region: string;
  /** The one bucket every prefix lives in. */
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
};

/** The handle: one client, and the bucket every key below is resolved inside. */
export type ObjectDoor = {
  readonly client: S3Client;
  readonly bucket: string;
};

/** Why `openObjects` refuses the settings it was given — checked once, before a door exists. */
export type ObjectStoreRefusal = "endpoint-not-a-url" | "no-bucket";

/**
 * The door's one constructor, and the one place the settings are ever checked — the git
 * door's `openGit` shape, for its reason: an endpoint or a bucket that arrived empty would
 * otherwise be joined into every key below and the first sign of it would be an S3 error
 * a long way from here. Every entry below trusts the handle rather than checking again.
 */
export const openObjects = (
  settings: ObjectStoreSettings,
): Result<ObjectDoor, ObjectStoreRefusal> => {
  if (settings.bucket === "") return err("no-bucket");
  try {
    // Parsed and thrown away: what is wanted is the refusal for a value that is not a URL
    // at all, which is the one thing the client cannot recover from.
    new URL(settings.endpoint);
  } catch {
    return err("endpoint-not-a-url");
  }
  return ok({
    client: new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      // Garage addresses a bucket by path, not by a host prefix: the estate reaches it by
      // service name on an internal network, where a virtual-host style address has no DNS.
      forcePathStyle: true,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    }),
    bucket: settings.bucket,
  });
};

/** Give the door's sockets back — the composition root's, at shutdown, and a suite's after it. */
export const closeObjects = (door: ObjectDoor): void => {
  door.client.destroy();
};

/**
 * The platform's own prefix: where the replay copy that step 10 of the erasure routine
 * writes lives, which belongs to no workspace because it is what a restore reads *before*
 * it knows which workspaces exist (`CONTEXT.md`, *replay copy*).
 */
const PLATFORM_PREFIX = "platform/";

/** A workspace's prefix. Every tenant object in the estate is under one of these and no other. */
const prefixOf = (principal: UserPrincipal): string => `workspaces/${principal.workspaceId}/`;

/** Why a call was refused before any byte moved. */
export type KeyRefusal = "malformed-key";

/** The same, plus the one thing a read can find instead of bytes. */
export type ReadRefusal = KeyRefusal | "no-such-object";

/**
 * The shape every key inside a prefix has. An S3 key is an opaque string, so `..` cannot
 * escape a prefix the way it escapes a directory — but a key with a dot segment, an empty
 * segment or a leading separator names bytes nothing can list back sensibly, and the nightly
 * mirror that copies this bucket off-host writes it to a filesystem where those segments do
 * mean something. So the door refuses them here rather than storing a name it cannot hand
 * back. The rule is the git door's `isBundlePath`, for the same reasons and in its shape.
 */
const isKeyShaped = (candidate: string): boolean =>
  !candidate.startsWith("/") &&
  !candidate.split("").some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  }) &&
  !candidate.split("/").some((segment) => segment === "." || segment === "..");

/** A key names one object, so it is non-empty and has no empty segment. */
const isObjectKey = (candidate: string): boolean =>
  candidate !== "" && isKeyShaped(candidate) && !candidate.split("/").includes("");

/**
 * What a listing may be asked for: a key, nothing at all — which names everything under the
 * prefix — or a key with the separator left on, which is how a caller asks for one folder's
 * worth and not the keys whose names merely start the same way.
 */
const isListingPrefix = (candidate: string): boolean =>
  candidate === "" || isObjectKey(candidate.endsWith("/") ? candidate.slice(0, -1) : candidate);

/**
 * What the SDK throws for a key the bucket does not hold. Read off the error's name rather
 * than its class, because the same answer arrives as a modelled `NoSuchKey` from one command
 * and as a plain service exception carrying that name from another.
 */
const isMissing = (cause: unknown): boolean => cause instanceof Error && cause.name === "NoSuchKey";

/**
 * The put, inside a prefix. `Upload` rather than `PutObjectCommand` because the body is a
 * stream whose length nobody knows — a connector's download, a report being written — and
 * S3 refuses a body with neither a content length nor a multipart upload behind it.
 */
const putInside = async (
  door: ObjectDoor,
  prefix: string,
  key: string,
  body: ReadableStream<Uint8Array>,
): Promise<Result<void, KeyRefusal>> => {
  if (!isObjectKey(key)) return err("malformed-key");
  // SAFETY: the two `ReadableStream` types are the same runtime object — Node's global is
  // the one `node:stream/web` declares — and they are declared twice only because the DOM
  // library and Node's own both name it. The assertion is about the declaration, not a
  // claim about the value.
  const stream = body as NodeReadableStream<Uint8Array>;
  await new Upload({
    client: door.client,
    params: { Bucket: door.bucket, Key: `${prefix}${key}`, Body: Readable.fromWeb(stream) },
  }).done();
  return ok(undefined);
};

/** The get, inside a prefix. A key the prefix does not hold is an answer, not a failure. */
const getInside = async (
  door: ObjectDoor,
  prefix: string,
  key: string,
): Promise<Result<ReadableStream<Uint8Array>, ReadRefusal>> => {
  if (!isObjectKey(key)) return err("malformed-key");
  try {
    const answer = await door.client.send(
      new GetObjectCommand({ Bucket: door.bucket, Key: `${prefix}${key}` }),
    );
    // The body is optional on the modelled response and never absent on a 200; a read that
    // found nothing to hand back is the same answer as a key that is not there.
    if (answer.Body === undefined) return err("no-such-object");
    return ok(answer.Body.transformToWebStream());
  } catch (cause) {
    if (isMissing(cause)) return err("no-such-object");
    throw cause;
  }
};

/**
 * The list, inside a prefix, with the prefix itself taken back off — a caller names keys the
 * way it wrote them and never sees a bucket key, which is the whole of the discipline this
 * module holds. Paged to the end, because a thousand keys is one page and a workspace's
 * documents are not a thousand for long.
 */
const listInside = async (
  door: ObjectDoor,
  prefix: string,
  under: string,
): Promise<Result<readonly string[], KeyRefusal>> => {
  if (!isListingPrefix(under)) return err("malformed-key");
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    // Sequential by necessity: the next page's token is on the page before it.
    const page = await door.client.send(
      new ListObjectsV2Command({
        Bucket: door.bucket,
        Prefix: `${prefix}${under}`,
        ContinuationToken: continuationToken,
      }),
    );
    for (const entry of page.Contents ?? []) {
      if (entry.Key !== undefined) keys.push(entry.Key.slice(prefix.length));
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken !== undefined);
  return ok(keys);
};

/** Put bytes under this workspace's prefix, at `key` within it, and under no other's. */
export const putObject = (
  principal: UserPrincipal,
  door: ObjectDoor,
  key: string,
  body: ReadableStream<Uint8Array>,
): Promise<Result<void, KeyRefusal>> => putInside(door, prefixOf(principal), key, body);

/** The bytes at `key` under this workspace's prefix, or the word for nothing being there. */
export const getObject = (
  principal: UserPrincipal,
  door: ObjectDoor,
  key: string,
): Promise<Result<ReadableStream<Uint8Array>, ReadRefusal>> =>
  getInside(door, prefixOf(principal), key);

/** The keys under `under` in this workspace's prefix; `""` for the whole of it. */
export const listObjects = (
  principal: UserPrincipal,
  door: ObjectDoor,
  under: string,
): Promise<Result<readonly string[], KeyRefusal>> => listInside(door, prefixOf(principal), under);

/** Put bytes under the platform's own prefix — the erasure routine's replay copy, step 10. */
export const putPlatformObject = (
  platform: PlatformPrincipal,
  door: ObjectDoor,
  key: string,
  body: ReadableStream<Uint8Array>,
): Promise<Result<void, KeyRefusal>> => putInside(door, PLATFORM_PREFIX, key, body);

/** The bytes at `key` under the platform's own prefix — what `replay-erasures` reads back. */
export const getPlatformObject = (
  platform: PlatformPrincipal,
  door: ObjectDoor,
  key: string,
): Promise<Result<ReadableStream<Uint8Array>, ReadRefusal>> =>
  getInside(door, PLATFORM_PREFIX, key);

/** The keys under `under` in the platform's own prefix — the replay's scan for copies. */
export const listPlatformObjects = (
  platform: PlatformPrincipal,
  door: ObjectDoor,
  under: string,
): Promise<Result<readonly string[], KeyRefusal>> => listInside(door, PLATFORM_PREFIX, under);
