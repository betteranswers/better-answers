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

/**
 * One real Garage for a suite, started once and stopped once — `postgresForSuite`'s shape
 * and for its reason: the helper registers the lifecycle and hands back an accessor, so a
 * suite says what it needs on its first line and reads the store from a call.
 *
 * It is deliberately **not** in the shared `globalSetup`. The migrated-Postgres setup is
 * registered by three workspaces, and one or two suites in one of them need an object
 * store; a container there would make every suite in every workspace pay for it.
 *
 * Two facts about this image shape everything below, both established against it on
 * 11/09/2026 rather than assumed:
 *
 * 1. **It carries no shell** — `deploy/stores.compose.yaml`'s healthcheck says so and runs
 *    the binary in exec form for that reason. So the default wait strategy cannot be used:
 *    it proves a port is listening by running a command *inside* the container, which here
 *    can only fail, and the failure reads as "Port 3900/tcp not bound" sixty seconds later.
 *    The wait is the admin API's `/health`, checked from the host, which answers 200 with
 *    no token once the cluster is operational.
 * 2. **`server --single-node` assigns and applies its own layout.** A multi-node Garage
 *    serves no S3 until `layout assign` and `layout apply` have run; this one does that for
 *    itself at first boot ("Created initial layout for single-node configuration"), so the
 *    bring-up here is the credential and the bucket alone. The compose service runs the same
 *    flag, so the estate and this harness come up the same way.
 *
 * Every `exec` still reads its exit code: a silent failure here surfaces as an S3 403 in a
 * test a long way away.
 */

/**
 * What a get answered, as text — the reading half of every assertion about the door, which
 * hands bytes back over a stream and so cannot be compared to a string without one.
 *
 * It is here rather than in each suite because it is the door's own shape read back, not a
 * test's expectation: the decoder is stateful across chunks on purpose, so a multi-byte
 * character split across two of them still reads as one character, and a copy per suite is a
 * copy of that decision. What a suite asserts is still the suite's — this only turns the
 * stream into something to assert on.
 */
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

/** What a suite receives: the door, and the facts a failure message needs. */
export type ObjectStore = {
  readonly door: ObjectDoor;
  readonly endpoint: string;
  readonly bucket: string;
};

/** Garage's configuration, copied to the path the service's environment names. */
const GARAGE_CONFIG = path.resolve(import.meta.dirname, "../../../deploy/garage.toml");

/** The bucket every prefix lives in; one cluster per suite, so a fixed name cannot collide. */
const BUCKET = "better-answers";

/** The S3 port and the admin port `deploy/garage.toml` binds. */
const S3_PORT = 3900;
const ADMIN_PORT = 3903;

/**
 * Garage's own region name, out of `deploy/garage.toml`. The client must agree with it or
 * every request is signed for a region the store will not answer for.
 */
const REGION = "garage";

/** Run a command in the container and answer its output, or throw with what it printed. */
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

/** One labelled field off a `garage` command's output, or a throw naming what it printed. */
const fieldOf = (output: string, label: string): string => {
  const found = new RegExp(`^${label}:\\s*(\\S+)`, "m").exec(output);
  if (found?.[1] === undefined) throw new Error(`garage: no ${label} in\n${output}`);
  return found[1];
};

/**
 * Mint one access key, make the bucket and give the key the run of it — the whole bring-up,
 * because the layout is the server's own. The credential handed back is the one this
 * created: Garage ships with none, and the estate's own key is made the same way
 * (`deploy/stores.compose.yaml` § objectstore).
 */
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

/**
 * Register a Garage for this suite and hand back the accessor. The throw is what a caller
 * gets instead of `undefined` if the accessor is ever read before `beforeAll` has run.
 */
export const objectStoreForSuite = (): (() => ObjectStore) => {
  let container: StartedTestContainer | undefined;
  let store: ObjectStore | undefined;

  beforeAll(async () => {
    container = await new GenericContainer(GARAGE_IMAGE)
      .withCommand(["/garage", "server", "--single-node"])
      .withCopyFilesToContainer([{ source: GARAGE_CONFIG, target: "/etc/garage.toml" }])
      .withEnvironment({
        GARAGE_CONFIG_FILE: "/etc/garage.toml",
        // Both secrets are the environment form of the configuration keys the compose file
        // leaves out; the RPC secret is 32 bytes of hex and nothing else will do.
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
