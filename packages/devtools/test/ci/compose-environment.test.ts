import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { assert, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";

import * as apiConfig from "../../../../apps/api/src/config.ts";

const COMPOSE = "deploy/platform.compose.yaml";

type Keys = { readonly required: readonly string[]; readonly optional: readonly string[] };

type Tier = Readonly<Record<string, Keys>>;

const keysOf = (schema: z.ZodObject<Record<string, z.ZodType>>): Keys => {
  const fields = Object.entries(schema.shape);
  const named = (optional: boolean): string[] =>
    fields
      .filter(([, field]) => field.safeParse(undefined).success === optional)
      .map(([name]) => name);
  return { required: named(false), optional: named(true) };
};

const WORKER_KEYS = `import json
from better_answers_worker.config import OPTIONAL, REQUIRED

print(json.dumps({"required": REQUIRED, "optional": OPTIONAL}))
`;

const workerKeys = (): Keys =>
  z.object({ required: z.array(z.string()), optional: z.array(z.string()) }).parse(
    JSON.parse(
      execFileSync("uv", ["run", "--frozen", "python", "-I", "-c", WORKER_KEYS], {
        cwd: path.join(repositoryRoot, "apps", "worker"),
        encoding: "utf8",
      }),
    ),
  );

const apiTier: Tier = Object.fromEntries(
  Object.entries(apiConfig.READER_SCHEMAS).map(([reader, schema]) => [reader, keysOf(schema)]),
);

const TIERS: Readonly<Record<string, Tier>> = {
  api: apiTier,
  worker: { read_bootstrap: workerKeys() },
};

type Service = { readonly tier: string; readonly starts: readonly string[] };

const SERVICES: Readonly<Record<string, Service>> = {
  migrate: { tier: "api", starts: ["readBootstrap"] },
  api: { tier: "api", starts: Object.keys(apiTier) },
  worker: { tier: "worker", starts: ["read_bootstrap"] },
};

type Excuse = { readonly services: readonly string[]; readonly reason: string };

const EXCUSED: Readonly<Record<string, Excuse>> = {
  EMBEDDINGS_URL: {
    services: ["api", "worker"],
    reason:
      "reserved for the model host that docs/operations/coolify.md documents. No code reads it yet",
  },
  NODE_ENV: {
    services: ["api"],
    reason: "the mode switch that Node dependencies read. The api's own code never does",
  },
  HF_HOME: { services: ["worker"], reason: "read by huggingface_hub" },
  HF_HUB_OFFLINE: { services: ["worker"], reason: "read by huggingface_hub" },
  TLDEXTRACT_CACHE: { services: ["worker"], reason: "read by tldextract" },
  COCOINDEX_DISABLE_USAGE_TRACKING: {
    services: ["worker"],
    reason: "read by the cocoindex engine",
  },
  RUST_LOG: { services: ["worker"], reason: "read by the cocoindex engine" },
};

type Finding = { readonly service: string; readonly key: string; readonly message: string };

const composeSchema = z.object({
  services: z.record(z.string(), z.object({ environment: z.record(z.string(), z.unknown()) })),
});

const environmentsIn = (source: string): Readonly<Record<string, readonly string[]>> =>
  Object.fromEntries(
    Object.entries(composeSchema.parse(parse(source, { merge: true })).services).map(
      ([name, service]) => [name, Object.keys(service.environment)],
    ),
  );

const finding = (service: string, key: string, message: string): Finding => ({
  service,
  key,
  message,
});

const findingsIn = (source: string, excused: Readonly<Record<string, Excuse>>): Finding[] => {
  const environments = environmentsIn(source);
  const unlisted = Object.keys(environments)
    .filter((name) => SERVICES[name] === undefined)
    .map((name) =>
      finding(
        name,
        "",
        `${name} is a service of ${COMPOSE} that SERVICES does not name. Add it, with its tier and the readers it starts`,
      ),
    );

  const perService = Object.entries(SERVICES).flatMap(([name, { tier, starts }]) => {
    const readers = TIERS[tier] ?? {};
    const set = environments[name] ?? [];
    const read = new Set(
      Object.values(readers).flatMap((keys) => [...keys.required, ...keys.optional]),
    );
    const excusedHere = Object.entries(excused)
      .filter(([, excuse]) => excuse.services.includes(name))
      .map(([key]) => key);

    const lacking = starts.flatMap((reader) =>
      (readers[reader]?.required ?? [])
        .filter((key) => !set.includes(key))
        .map((key) =>
          finding(
            name,
            key,
            `${name} lacks ${key}, which ${reader} requires. Set it in the service's environment, or in an anchor that the service merges`,
          ),
        ),
    );
    const unread = set
      .filter((key) => !read.has(key) && !excusedHere.includes(key))
      .map((key) =>
        finding(
          name,
          key,
          `${name} sets ${key}, which no reader of the ${tier} tier's config module reads. Delete it from ${COMPOSE}, or name it in EXCUSED with the library that reads it`,
        ),
      );
    const stale = excusedHere
      .filter((key) => !set.includes(key) || read.has(key))
      .map((key) =>
        finding(
          name,
          key,
          `EXCUSED names ${key} for ${name}, which ${read.has(key) ? "the config module reads now" : "does not set it"}. Delete the entry`,
        ),
      );
    return [...lacking, ...unread, ...stale];
  });

  return [...unlisted, ...perService];
};

const compose = readFileSync(path.join(repositoryRoot, COMPOSE), "utf8");

const flagged = (findings: readonly Finding[]): string[] =>
  findings.map(({ service, key }) => `${service} ${key}`.trim()).sort();

const edited = (find: string, replacement: string): string => {
  assert(compose.includes(find), `${COMPOSE} no longer contains ${find}`);
  return compose.replace(find, replacement);
};

describe(`${COMPOSE} gives each service the environment its tier's config module reads`, () => {
  it("sets every required key and no unread key", () => {
    expect(findingsIn(compose, EXCUSED).map(({ message }) => message)).toEqual([]);
  });

  it("names every service of the file", () => {
    expect(Object.keys(environmentsIn(compose)).sort()).toEqual(Object.keys(SERVICES).sort());
  });

  it("registers every reader the api's config module exports", () => {
    const exported = Object.keys(apiConfig).filter((name) => /^read[A-Z]/u.test(name));

    expect(Object.keys(apiTier).sort()).toEqual(exported.sort());
  });

  it("counts a default or an optional field as optional", () => {
    const schema = z.object({
      A: z.string(),
      B: z.string().optional(),
      C: z.string().default("c"),
    });

    expect(keysOf(schema)).toEqual({ required: ["A"], optional: ["B", "C"] });
  });

  it("reads the worker's lists from its config module", () => {
    const keys = TIERS["worker"]?.["read_bootstrap"];

    expect(keys?.required).toContain("DATABASE_URL");
    expect(keys?.optional).toContain("WORKER_ID");
  });
});

describe("the check fails on a planted file", () => {
  it("refuses an unread key planted in the anchor", () => {
    const planted = edited(
      "x-bootstrap: &bootstrap\n",
      "x-bootstrap: &bootstrap\n  PLANTED_KEY: x\n",
    );

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual([
      "api PLANTED_KEY",
      "worker PLANTED_KEY",
    ]);
  });

  it("refuses an unread key planted in one service", () => {
    const planted = edited(
      "      GIT_STORE_DIR: /data/git\n      KEK:",
      "      GIT_STORE_DIR: /data/git\n      PLANTED_KEY: x\n      KEK:",
    );

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual(["api PLANTED_KEY"]);
  });

  it("refuses a typo of an optional key", () => {
    const planted = edited("      UPLOAD_SWEEP:", "      UPLOAD_SWEEPS:");

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual(["api UPLOAD_SWEEPS"]);
  });

  it("refuses a removed key that a reader requires", () => {
    const removed = edited("      KEK: ${KEK:?}\n", "");

    expect(flagged(findingsIn(removed, EXCUSED))).toEqual(["api KEK"]);
  });

  it("asks only the services that start the reader", () => {
    const removed = edited("  S3_SECRET_KEY: ${OBJECTSTORE_ROOT_SECRET:?}\n", "");

    expect(flagged(findingsIn(removed, EXCUSED))).toEqual([
      "api S3_SECRET_KEY",
      "worker S3_SECRET_KEY",
    ]);
  });

  it("refuses a removed key that the worker requires", () => {
    const removed = edited("      LMDB_DIR: /data/worker/lmdb\n", "");

    expect(flagged(findingsIn(removed, EXCUSED))).toEqual(["worker LMDB_DIR"]);
  });

  it("accepts a removed optional key", () => {
    const removed = edited('      MAX_CONCURRENT_RUNS: "1"\n', "");

    expect(findingsIn(removed, EXCUSED)).toEqual([]);
  });

  it("refuses an excused key in another service", () => {
    const planted = edited(
      "      MAX_CONCURRENT_RUNS:",
      "      NODE_ENV: production\n      MAX_CONCURRENT_RUNS:",
    );

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual(["worker NODE_ENV"]);
  });

  it("refuses an excuse for a key no longer set", () => {
    const removed = edited("      HF_HOME: /data/worker/hf-cache\n", "");

    expect(flagged(findingsIn(removed, EXCUSED))).toEqual(["worker HF_HOME"]);
  });

  it("refuses an excuse for a key now read", () => {
    const excusedButRead = { ...EXCUSED, KEK: { services: ["api"], reason: "planted" } };

    expect(flagged(findingsIn(compose, excusedButRead))).toEqual(["api KEK"]);
  });

  it("refuses a service that SERVICES omits", () => {
    const planted = `${compose}  planted:\n    image: x\n    environment:\n      A: b\n`;

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual(["planted"]);
  });
});
