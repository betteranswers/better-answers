import { randomBytes } from "node:crypto";
import path from "node:path";

import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll } from "vitest";

import {
  closeObjects,
  GARAGE_IMAGE,
  openObjects,
  type ObjectDoor,
} from "../src/store/objects/index.ts";

export const textOf = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
};

export type ObjectStore = {
  readonly door: ObjectDoor;
  readonly endpoint: string;
  readonly bucket: string;
};

const GARAGE_CONFIG = path.resolve(import.meta.dirname, "../../../deploy/garage.toml");

const BUCKET = "better-answers";

const S3_PORT = 3900;
const ADMIN_PORT = 3903;

const REGION = "garage";

const exec = async (
  container: StartedTestContainer,
  command: readonly string[],
): Promise<string> => {
  const answer = await container.exec([...command]);
  if (answer.exitCode !== 0) {
    throw new Error(`garage: \`${command.join(" ")}\` exited ${answer.exitCode}\n${answer.output}`);
  }
  return answer.output;
};

const fieldOf = (output: string, label: string): string => {
  const found = new RegExp(`^${label}:\\s*(\\S+)`, "m").exec(output);
  if (found?.[1] === undefined) throw new Error(`garage: no ${label} in\n${output}`);
  return found[1];
};

const provisionCluster = async (container: StartedTestContainer): Promise<ObjectStore> => {
  const created = await exec(container, ["/garage", "key", "create", BUCKET]);
  const accessKeyId = fieldOf(created, "Key ID");
  const secretAccessKey = fieldOf(created, "Secret key");

  await exec(container, ["/garage", "bucket", "create", BUCKET]);
  await exec(container, [
    "/garage",
    "bucket",
    "allow",
    "--read",
    "--write",
    "--owner",
    BUCKET,
    "--key",
    accessKeyId,
  ]);

  const endpoint = `http://${container.getHost()}:${String(container.getMappedPort(S3_PORT))}`;
  const opened = openObjects({
    endpoint,
    region: REGION,
    bucket: BUCKET,
    accessKeyId,
    secretAccessKey,
  });
  if (!opened.ok) throw new Error(`the object door refused its settings: ${opened.error}`);
  return { door: opened.value, endpoint, bucket: BUCKET };
};

export const objectStoreForSuite = (): (() => ObjectStore) => {
  let container: StartedTestContainer | undefined;
  let store: ObjectStore | undefined;

  beforeAll(async () => {
    container = await new GenericContainer(GARAGE_IMAGE)
      .withCommand(["/garage", "server", "--single-node"])
      .withCopyFilesToContainer([{ source: GARAGE_CONFIG, target: "/etc/garage.toml" }])
      .withEnvironment({
        GARAGE_CONFIG_FILE: "/etc/garage.toml",

        GARAGE_RPC_SECRET: randomBytes(32).toString("hex"),
        GARAGE_ADMIN_TOKEN: randomBytes(16).toString("hex"),
      })
      .withExposedPorts(S3_PORT, ADMIN_PORT)
      .withWaitStrategy(Wait.forHttp("/health", ADMIN_PORT))
      .start();
    store = await provisionCluster(container);
  });

  afterAll(async () => {
    if (store !== undefined) closeObjects(store.door);
    await container?.stop();
  });

  return () => {
    if (store === undefined) throw new Error("the suite's object store was read before it started");
    return store;
  };
};
