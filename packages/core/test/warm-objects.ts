import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { GenericContainer, Wait } from "testcontainers";
import { expect, inject } from "vitest";
import type { TestProject } from "vitest/node";
import { z } from "zod";

import { GARAGE_IMAGE, type ObjectDoor, openObjects } from "../src/store/objects/index.ts";

export type WarmObjects = {
  readonly endpoint: string;

  readonly adminEndpoint: string;

  readonly adminToken: string;

  readonly region: string;
};

declare module "vitest" {
  interface ProvidedContext {
    warmObjects?: WarmObjects;
  }
}

export type ObjectStore = {
  readonly door: ObjectDoor;
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;

  readonly stop: () => Promise<void>;
};

const GARAGE_CONFIG = path.resolve(import.meta.dirname, "../../../deploy/garage.toml");

const S3_PORT = 3900;
const ADMIN_PORT = 3903;

const REGION = "garage";

const THE_HARNESS = "objectStoreForSuite";

export const asksForAStore = (testFile: string): boolean =>
  readFileSync(testFile, "utf8").includes(THE_HARNESS);

type StartedGarage = {
  readonly warm: WarmObjects;
  readonly stop: () => Promise<void>;
};

const startGarage = async (): Promise<StartedGarage> => {
  const adminToken = randomBytes(16).toString("hex");
  const container = await new GenericContainer(GARAGE_IMAGE)
    .withCommand(["/garage", "server", "--single-node"])
    .withCopyFilesToContainer([{ source: GARAGE_CONFIG, target: "/etc/garage.toml" }])
    .withEnvironment({
      GARAGE_CONFIG_FILE: "/etc/garage.toml",

      GARAGE_RPC_SECRET: randomBytes(32).toString("hex"),
      GARAGE_ADMIN_TOKEN: adminToken,
    })
    .withExposedPorts(S3_PORT, ADMIN_PORT)
    .withWaitStrategy(Wait.forHttp("/health", ADMIN_PORT))
    .start();
  const host = container.getHost();
  return {
    warm: {
      endpoint: `http://${host}:${String(container.getMappedPort(S3_PORT))}`,
      adminEndpoint: `http://${host}:${String(container.getMappedPort(ADMIN_PORT))}`,
      adminToken,
      region: REGION,
    },
    stop: async () => {
      await container.stop();
    },
  };
};

/** Vitest's global setup: starts one Garage, and only when a collected file names the harness. */
const startWarmObjects = async (
  project: TestProject,
): Promise<(() => Promise<void>) | undefined> => {
  if (!project.vitest.state.getPaths().some((file) => asksForAStore(file))) return undefined;
  const started = await startGarage();
  project.provide("warmObjects", started.warm);
  return started.stop;
};

export default startWarmObjects;

const providedWarmObjects = (): WarmObjects | undefined => {
  try {
    return inject("warmObjects");
  } catch {
    // `inject` throws outside a worker as well as where nothing was provided, and both answer
    // the only question here: this caller has no warm store.
    return undefined;
  }
};

const storeNameFor = (storeKey: string): string => {
  const stem = path
    .basename(storeKey)
    .replaceAll(/[^a-z0-9]+/giu, "-")
    .toLowerCase();
  const digest = createHash("sha256").update(storeKey).digest("hex").slice(0, 12);
  return `ba-${stem.slice(0, 40)}-${digest}`;
};

const runningTestFile = (): string => {
  const { testPath } = expect.getState();
  if (testPath === undefined) {
    throw new Error(
      "the warm object store was opened with no running test file to name a bucket after; pass a key",
    );
  }
  return testPath;
};

const askAdmin = (
  warm: WarmObjects,
  method: string,
  operation: string,
  body?: unknown,
): Promise<Response> =>
  fetch(`${warm.adminEndpoint}/v2/${operation}`, {
    method,
    headers: {
      authorization: `Bearer ${warm.adminToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const refusalOf = async (operation: string, answer: Response): Promise<string> =>
  `garage admin: ${operation} answered ${String(answer.status)}\n${await answer.text()}`;

const answerOf = async <T>(
  operation: string,
  answer: Response,
  shape: z.ZodType<T>,
): Promise<T> => {
  if (!answer.ok) throw new Error(await refusalOf(operation, answer));
  return shape.parse(await answer.json());
};

const bucketShape = z.object({ id: z.string() });

const keyShape = z.object({ accessKeyId: z.string(), secretAccessKey: z.string() });

const bucketIdFor = async (warm: WarmObjects, name: string): Promise<string> => {
  const created = await askAdmin(warm, "POST", "CreateBucket", { globalAlias: name });
  if (created.ok) return (await answerOf("CreateBucket", created, bucketShape)).id;
  const refused = await refusalOf("CreateBucket", created);

  /**
   * A mutation run re-enters a file's `beforeAll` against the Garage the run before it left, so
   * the alias it wants is already standing.
   */
  const found = await askAdmin(
    warm,
    "GET",
    `GetBucketInfo?globalAlias=${encodeURIComponent(name)}`,
  );
  if (!found.ok) throw new Error(`${refused}\n${await refusalOf("GetBucketInfo", found)}`);
  return (await answerOf("GetBucketInfo", found, bucketShape)).id;
};

/** The first listing page alone: up to 1,000 keys. */
export const keysIn = async (door: ObjectDoor): Promise<readonly string[]> => {
  const listed = await door.client.send(new ListObjectsV2Command({ Bucket: door.bucket }));
  return (listed.Contents ?? []).flatMap((held) => (held.Key === undefined ? [] : [held.Key]));
};

const emptied = async (door: ObjectDoor): Promise<void> => {
  for (;;) {
    const keys = await keysIn(door);
    if (keys.length === 0) return;
    for (const key of keys) {
      await door.client.send(new DeleteObjectCommand({ Bucket: door.bucket, Key: key }));
    }
  }
};

const storeOver = async (
  warm: WarmObjects,
  name: string,
  stop: () => Promise<void>,
): Promise<ObjectStore> => {
  const key = await answerOf(
    "CreateKey",
    await askAdmin(warm, "POST", "CreateKey", { name }),
    keyShape,
  );
  const bucketId = await bucketIdFor(warm, name);
  await answerOf(
    "AllowBucketKey",
    await askAdmin(warm, "POST", "AllowBucketKey", {
      bucketId,
      accessKeyId: key.accessKeyId,
      permissions: { read: true, write: true, owner: true },
    }),
    z.unknown(),
  );

  const opened = openObjects({
    endpoint: warm.endpoint,
    region: warm.region,
    bucket: name,
    accessKeyId: key.accessKeyId,
    secretAccessKey: key.secretAccessKey,
  });
  if (!opened.ok) throw new Error(`the object door refused its settings: ${opened.error}`);
  await emptied(opened.value);
  return {
    door: opened.value,
    endpoint: warm.endpoint,
    bucket: name,
    region: warm.region,
    accessKeyId: key.accessKeyId,
    secretAccessKey: key.secretAccessKey,
    stop,
  };
};

const NOTHING_TO_STOP = async (): Promise<void> => {};

/**
 * An emptied bucket named for `storeKey`, else the running test file; with no warm Garage, it
 * starts its own, which `stop` ends.
 */
export const openObjectStore = async (storeKey?: string): Promise<ObjectStore> => {
  const name = storeNameFor(storeKey ?? runningTestFile());
  const warm = providedWarmObjects();
  if (warm !== undefined) return storeOver(warm, name, NOTHING_TO_STOP);

  /**
   * Vitest takes its `globalSetup` once a process, so a watch or mutation session that opened
   * on other files has none to hand out.
   */
  const started = await startGarage();
  try {
    return await storeOver(started.warm, name, started.stop);
  } catch (error) {
    await started.stop();
    throw error;
  }
};
