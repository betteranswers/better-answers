import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { closeObjects, type ObjectDoor, openObjects } from "../../../src/store/objects/index.ts";
import { workspaceRoot } from "../../support/roots/roots.ts";
import { objectStoreForSuite } from "../../support/suite-objects.ts";
import {
  asksForAStore,
  keysIn,
  type ObjectStore,
  openObjectStore,
} from "../../support/warm-objects.ts";

const run = promisify(execFile);
const warmObjectsModule = fileURLToPath(new URL("../../support/warm-objects.ts", import.meta.url));

const store = objectStoreForSuite();

const putPage = (held: ObjectStore, key: string): Promise<unknown> =>
  held.door.client.send(
    new PutObjectCommand({ Bucket: held.bucket, Key: key, Body: "a page of evidence" }),
  );

const doorForBucket = (credentials: ObjectStore, bucket: string): ObjectDoor => {
  const opened = openObjects({
    endpoint: credentials.endpoint,
    region: credentials.region,
    bucket,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
  });
  if (!opened.ok) throw new Error(`the door refused its settings: ${opened.error}`);
  return opened.value;
};

const listingError = async (door: ObjectDoor): Promise<string> => {
  try {
    await keysIn(door);
    return "the read was allowed";
  } catch (error) {
    return error instanceof Error ? error.name : String(error);
  }
};

const suiteFileWith = (source: string): string => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "warm-objects-")), "a-suite.test.ts");
  writeFileSync(file, source, "utf8");
  return file;
};

describe("the warm object store", () => {
  it("gives a suite a bucket named after its file", () => {
    expect(store().bucket).toMatch(/^ba-warm-objects-test-ts-[0-9a-f]{12}$/u);
  });

  it("gives each file its own bucket, denying other files access", async () => {
    const one = await openObjectStore("one-file");
    const another = await openObjectStore("another-file");
    const trespass = doorForBucket(one, another.bucket);
    try {
      await putPage(another, "landed/page.txt");

      expect({
        buckets: one.bucket === another.bucket,
        itsOwner: await keysIn(another.door),
        theNeighbour: await listingError(trespass),
      }).toEqual({
        buckets: false,
        itsOwner: ["landed/page.txt"],
        theNeighbour: "AccessDenied",
      });
    } finally {
      closeObjects(trespass);
      closeObjects(one.door);
      closeObjects(another.door);
    }
  });

  it("empties the bucket when a key is opened again", async () => {
    const bailed = await openObjectStore("re-run");
    await putPage(bailed, "landed/page.txt");
    closeObjects(bailed.door);

    const reopened = await openObjectStore("re-run");
    try {
      expect({ bucket: reopened.bucket, held: await keysIn(reopened.door) }).toEqual({
        bucket: bailed.bucket,
        held: [],
      });
    } finally {
      closeObjects(reopened.door);
    }
  });

  it("treats only a file importing objectStoreForSuite as wanting a store", () => {
    const wants = suiteFileWith(
      'import { objectStoreForSuite } from "../../support/suite-objects.ts";\n',
    );
    const wantsNot = suiteFileWith(
      'import { postgresForSuite } from "../../support/suite-postgres.ts";\n',
    );

    expect({ wants: asksForAStore(wants), wantsNot: asksForAStore(wantsNot) }).toEqual({
      wants: true,
      wantsNot: false,
    });
  });

  it("starts and stops its own Garage when none is running", async () => {
    const script = [
      `import { keysIn, openObjectStore } from ${JSON.stringify(warmObjectsModule)};`,
      'const store = await openObjectStore("cold");',
      "const answer = { bucket: store.bucket, held: await keysIn(store.door) };",
      "store.door.client.destroy();",
      "await store.stop();",
      "process.stdout.write(JSON.stringify(answer));",
    ].join("\n");

    const cold = await run(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: workspaceRoot,
    });

    expect(JSON.parse(cold.stdout)).toEqual({ bucket: "ba-cold-e272deecde72", held: [] });
  }, 300_000);
});
