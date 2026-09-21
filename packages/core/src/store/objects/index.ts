import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

import {
  err,
  isPortablePath,
  ok,
  type PlatformPrincipal,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";

export { GARAGE_IMAGE } from "./garage-image.ts";

export type ObjectStoreSettings = {
  readonly endpoint: string;

  readonly region: string;

  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
};

export type ObjectDoor = {
  readonly client: S3Client;
  readonly bucket: string;
};

export type ObjectStoreRefusal = "endpoint-not-a-url" | "no-bucket";

export const openObjects = (
  settings: ObjectStoreSettings,
): Result<ObjectDoor, ObjectStoreRefusal> => {
  if (settings.bucket === "") return err("no-bucket");
  try {
    new URL(settings.endpoint);
  } catch {
    return err("endpoint-not-a-url");
  }
  return ok({
    client: new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,

      forcePathStyle: true,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    }),
    bucket: settings.bucket,
  });
};

export const closeObjects = (door: ObjectDoor): void => {
  door.client.destroy();
};

const PLATFORM_PREFIX = "platform/";

const prefixOf = (principal: UserPrincipal): string => `workspaces/${principal.workspaceId}/`;

export type KeyRefusal = "malformed-key";

export type ReadRefusal = KeyRefusal | "no-such-object";

const isListingPrefix = (candidate: string): boolean =>
  candidate === "" || isPortablePath(candidate.endsWith("/") ? candidate.slice(0, -1) : candidate);

const isMissing = (cause: unknown): boolean => cause instanceof Error && cause.name === "NoSuchKey";

const putInside = async (
  door: ObjectDoor,
  prefix: string,
  key: string,
  body: ReadableStream<Uint8Array>,
): Promise<Result<void, KeyRefusal>> => {
  if (!isPortablePath(key)) return err("malformed-key");

  // SAFETY: the DOM library and Node both declare `ReadableStream` over one runtime object,
  // so the assertion is about declarations.
  const stream = body as NodeReadableStream<Uint8Array>;
  await new Upload({
    client: door.client,
    params: { Bucket: door.bucket, Key: `${prefix}${key}`, Body: Readable.fromWeb(stream) },
  }).done();
  return ok(undefined);
};

const getInside = async (
  door: ObjectDoor,
  prefix: string,
  key: string,
): Promise<Result<ReadableStream<Uint8Array>, ReadRefusal>> => {
  if (!isPortablePath(key)) return err("malformed-key");
  try {
    const answer = await door.client.send(
      new GetObjectCommand({ Bucket: door.bucket, Key: `${prefix}${key}` }),
    );

    if (answer.Body === undefined) return err("no-such-object");
    return ok(answer.Body.transformToWebStream());
  } catch (cause) {
    if (isMissing(cause)) return err("no-such-object");
    throw cause;
  }
};

const listInside = async (
  door: ObjectDoor,
  prefix: string,
  under: string,
): Promise<Result<readonly string[], KeyRefusal>> => {
  if (!isListingPrefix(under)) return err("malformed-key");
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
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

export const putObject = (
  principal: UserPrincipal,
  door: ObjectDoor,
  key: string,
  body: ReadableStream<Uint8Array>,
): Promise<Result<void, KeyRefusal>> => putInside(door, prefixOf(principal), key, body);

export const getObject = (
  principal: UserPrincipal,
  door: ObjectDoor,
  key: string,
): Promise<Result<ReadableStream<Uint8Array>, ReadRefusal>> =>
  getInside(door, prefixOf(principal), key);

export const listObjects = (
  principal: UserPrincipal,
  door: ObjectDoor,
  under: string,
): Promise<Result<readonly string[], KeyRefusal>> => listInside(door, prefixOf(principal), under);

export const putPlatformObject = (
  platform: PlatformPrincipal,
  door: ObjectDoor,
  key: string,
  body: ReadableStream<Uint8Array>,
): Promise<Result<void, KeyRefusal>> => putInside(door, PLATFORM_PREFIX, key, body);

export const getPlatformObject = (
  platform: PlatformPrincipal,
  door: ObjectDoor,
  key: string,
): Promise<Result<ReadableStream<Uint8Array>, ReadRefusal>> =>
  getInside(door, PLATFORM_PREFIX, key);

export const listPlatformObjects = (
  platform: PlatformPrincipal,
  door: ObjectDoor,
  under: string,
): Promise<Result<readonly string[], KeyRefusal>> => listInside(door, PLATFORM_PREFIX, under);
