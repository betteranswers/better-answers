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

type Tier = {
  readonly image: string;
  readonly dockerfile: string;
  readonly gate: readonly string[];
  readonly processes: Readonly<Record<string, Keys>>;
};

const keysOf = (schema: z.ZodObject<Record<string, z.ZodType>>): Keys => {
  const fields = Object.entries(schema.shape);
  const named = (optional: boolean): string[] =>
    fields
      .filter(([, field]) => field.safeParse(undefined).success === optional)
      .map(([name]) => name);
  return { required: named(false), optional: named(true) };
};

const WORKER_KEYS = `import json
from better_answers_worker.config import LIBRARY_KEYS, OPTIONAL, REQUIRED
from better_answers_worker.environment_gate import PROCESSES

print(json.dumps({
    "required": REQUIRED,
    "optional": OPTIONAL,
    "library": LIBRARY_KEYS,
    "processes": list(PROCESSES),
}))
`;

const workerListsSchema = z.object({
  required: z.array(z.string()),
  optional: z.array(z.string()),
  library: z.array(z.string()),
  processes: z.array(z.string()),
});

const workerLists = workerListsSchema.parse(
  JSON.parse(
    execFileSync("uv", ["run", "--frozen", "python", "-I", "-c", WORKER_KEYS], {
      cwd: path.join(repositoryRoot, "apps", "worker"),
      encoding: "utf8",
    }),
  ),
);

const workerKeys: Keys = {
  required: workerLists.required,
  optional: [...workerLists.optional, ...workerLists.library],
};

const apiKeys = (readers: readonly (keyof typeof apiConfig.READER_SCHEMAS)[]): Keys => {
  const read = readers.map((reader) => keysOf(apiConfig.READER_SCHEMAS[reader]));
  return {
    required: read.flatMap(({ required }) => required),
    optional: [...read.flatMap(({ optional }) => optional), ...apiConfig.LIBRARY_KEYS],
  };
};

const TIERS: Readonly<Record<string, Tier>> = {
  api: {
    image: "ghcr.io/betteranswers/api",
    dockerfile: "apps/api/Dockerfile",
    gate: ["node", "apps/api/src/environment-gate.ts"],
    processes: Object.fromEntries(
      Object.entries(apiConfig.PROCESS_READERS).map(([name, readers]) => [name, apiKeys(readers)]),
    ),
  },
  worker: {
    image: "ghcr.io/betteranswers/worker",
    dockerfile: "apps/worker/Dockerfile",
    gate: ["python", "-m", "better_answers_worker.environment_gate"],
    processes: Object.fromEntries(workerLists.processes.map((name) => [name, workerKeys])),
  },
};

type Excuse = { readonly services: readonly string[]; readonly reason: string };

const EXCUSED: Readonly<Record<string, Excuse>> = {
  EMBEDDINGS_URL: {
    services: ["api", "worker"],
    reason:
      "reserved for the model host that docs/operations/coolify.md documents. No code reads it yet",
  },
};

type Finding = { readonly service: string; readonly key: string; readonly message: string };

const argvSchema = z.array(z.string());

const composeSchema = z.object({
  services: z.record(
    z.string(),
    z.object({
      image: z.string(),
      init: z.boolean().optional(),
      command: argvSchema.optional(),
      environment: z.record(z.string(), z.unknown()),
      healthcheck: z.object({ test: argvSchema }).optional(),
    }),
  ),
});

type Services = z.infer<typeof composeSchema>["services"];

type Environments = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

const servicesIn = (source: string): Services =>
  composeSchema.parse(parse(source, { merge: true })).services;

const environmentsIn = (source: string): Environments =>
  Object.fromEntries(
    Object.entries(servicesIn(source)).map(([name, service]) => [name, service.environment]),
  );

const imageCommand = (dockerfile: string): readonly string[] => {
  const written = /^CMD (?<argv>\[.*\])$/mu.exec(
    readFileSync(path.join(repositoryRoot, dockerfile), "utf8"),
  )?.groups?.["argv"];
  assert(written !== undefined, `${dockerfile} has no CMD in exec form`);
  return argvSchema.parse(JSON.parse(written));
};

const finding = (service: string, key: string, message: string): Finding => ({
  service,
  key,
  message,
});

const variablesIn = (value: unknown): string[] =>
  typeof value === "string"
    ? [...value.matchAll(/\$\{?(\w+)/gu)].flatMap(([, name]) => name ?? [])
    : [];

const sharedDsns = (environments: Environments): Finding[] => {
  const dsns = Object.entries(environments).map(([service, environment]) => ({
    service,
    variables: variablesIn(environment["DATABASE_URL"]),
  }));
  return dsns.flatMap(({ service, variables }) => {
    const shared = variables.filter((variable) =>
      dsns.some((other) => other.service !== service && other.variables.includes(variable)),
    );
    return shared.map((variable) =>
      finding(
        service,
        "DATABASE_URL",
        `${service} takes DATABASE_URL from ${variable}, as another service does. Each service connects as its own database role, so set ${service}'s DATABASE_URL from a variable of its own`,
      ),
    );
  });
};

/** The process that the argv starts through the tier's gate, or undefined when it bypasses the gate. */
const gatedProcess = (argv: readonly string[], tier: Tier): string | undefined => {
  const named = argv.at(-1);
  const gated =
    argv.length === tier.gate.length + 1 && tier.gate.every((word, index) => argv[index] === word);
  return gated && named !== undefined && Object.hasOwn(tier.processes, named) ? named : undefined;
};

const ungated = (name: string, what: string, argv: readonly string[], tier: Tier): Finding =>
  finding(
    name,
    "",
    `${name}'s ${what} runs ${JSON.stringify(argv)}, which does not start through the environment gate, so the process keeps every variable the orchestrator hands the container. Run ${JSON.stringify([...tier.gate, "<process>"])} with one of ${Object.keys(tier.processes).join(", ")}`,
  );

const keyFindings = (
  name: string,
  set: readonly string[],
  keys: Keys,
  excused: Readonly<Record<string, Excuse>>,
): Finding[] => {
  const read = new Set([...keys.required, ...keys.optional]);
  const excusedHere = Object.entries(excused)
    .filter(([, excuse]) => excuse.services.includes(name))
    .map(([key]) => key);

  const lacking = keys.required
    .filter((key) => !set.includes(key))
    .map((key) =>
      finding(
        name,
        key,
        `${name} lacks ${key}, which the process ${name} starts requires. Set it in the service's environment, or in an anchor that the service merges`,
      ),
    );
  const unread = set
    .filter((key) => !read.has(key) && !excusedHere.includes(key))
    .map((key) =>
      finding(
        name,
        key,
        `${name} sets ${key}, which the process ${name} starts does not read, so the environment gate drops it. Delete it from ${name}'s environment in ${COMPOSE}. If an anchor supplies it, stop merging the anchor into ${name} and list ${name}'s keys. If a library reads it, add it to the library keys of the tier's config module`,
      ),
    );
  const stale = excusedHere
    .filter((key) => !set.includes(key) || read.has(key))
    .map((key) =>
      finding(
        name,
        key,
        `EXCUSED names ${key} for ${name}, but ${read.has(key) ? `the process ${name} starts reads it now` : `${name} does not set it`}. Delete the entry`,
      ),
    );
  return [...lacking, ...unread, ...stale];
};

type Service = Services[string];

const tierOf = (service: Service): Tier | undefined =>
  Object.values(TIERS).find(({ image }) => service.image.startsWith(`${image}@`));

/** The argv the container starts: the service's own command, or else the image's `CMD`. */
const commandOf = (service: Service, tier: Tier): readonly string[] =>
  service.command ?? imageCommand(tier.dockerfile);

const probeFindings = (name: string, service: Service, tier: Tier): Finding[] => {
  const probe = service.healthcheck?.test.slice(1) ?? [];
  const runsTierCode = probe[0] === tier.gate[0];
  return runsTierCode && gatedProcess(probe, tier) === undefined
    ? [ungated(name, "healthcheck", probe, tier)]
    : [];
};

const tierFindings = (
  name: string,
  service: Service,
  tier: Tier,
  excused: Readonly<Record<string, Excuse>>,
): Finding[] => {
  const command = commandOf(service, tier);
  const keys = tier.processes[gatedProcess(command, tier) ?? ""];
  const started =
    keys === undefined
      ? [ungated(name, "command", command, tier)]
      : keyFindings(name, Object.keys(service.environment), keys, excused);
  const init =
    service.init === true
      ? [
          finding(
            name,
            "init",
            `${name} sets init, so Docker's init runs as PID 1 with every variable of the container, and the app's user can read it from /proc/1/environ. Delete the line. Started as PID 1, the gate puts tini there with only the kept keys`,
          ),
        ]
      : [];
  return [...started, ...init, ...probeFindings(name, service, tier)];
};

const serviceFindings = (
  name: string,
  service: Service,
  excused: Readonly<Record<string, Excuse>>,
): Finding[] => {
  const tier = tierOf(service);
  return tier === undefined
    ? [
        finding(
          name,
          "",
          `${name} runs ${service.image}, which is the image of no tier in TIERS. Add the tier, with its gate and the keys each of its processes reads`,
        ),
      ]
    : tierFindings(name, service, tier, excused);
};

const startedIn = (source: string): Readonly<Record<string, string | undefined>> =>
  Object.fromEntries(
    Object.entries(servicesIn(source)).map(([name, service]) => {
      const tier = tierOf(service);
      return [name, tier && gatedProcess(commandOf(service, tier), tier)];
    }),
  );

const findingsIn = (source: string, excused: Readonly<Record<string, Excuse>>): Finding[] => [
  ...Object.entries(servicesIn(source)).flatMap(([name, service]) =>
    serviceFindings(name, service, excused),
  ),
  ...sharedDsns(environmentsIn(source)),
];

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

  it("starts each service through its tier's environment gate", () => {
    expect(startedIn(compose)).toEqual({ migrate: "migrate", api: "api", worker: "worker" });
  });

  it("registers every reader the api's config module exports", () => {
    const exported = Object.keys(apiConfig).filter((name) => /^read[A-Z]/u.test(name));

    expect(Object.keys(apiConfig.READER_SCHEMAS).sort()).toEqual(exported.sort());
    expect([...apiConfig.PROCESS_READERS.api].sort()).toEqual(exported.sort());
  });

  it("counts a default or an optional field as optional", () => {
    const schema = z.object({
      A: z.string(),
      B: z.string().optional(),
      C: z.string().default("c"),
    });

    expect(keysOf(schema)).toEqual({ required: ["A"], optional: ["B", "C"] });
  });

  it("reads the worker's keys and processes from its own modules", () => {
    expect(workerKeys.required).toContain("DATABASE_URL");
    expect(workerKeys.optional).toContain("WORKER_ID");
    expect(workerKeys.optional).toContain("HF_HOME");
    expect(workerLists.processes.sort()).toEqual(["health", "worker"]);
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

  it("asks only the services whose process reads the key", () => {
    const removed = edited("  S3_SECRET_KEY: ${OBJECTSTORE_ROOT_SECRET:?}\n", "");

    expect(flagged(findingsIn(removed, EXCUSED))).toEqual([
      "api S3_SECRET_KEY",
      "worker S3_SECRET_KEY",
    ]);
  });

  it("refuses a secret planted on migrate, and names the fix", () => {
    const planted = edited(
      "      # The owner DSN",
      "      S3_SECRET_KEY: ${OBJECTSTORE_ROOT_SECRET:?}\n      # The owner DSN",
    );
    const findings = findingsIn(planted, EXCUSED);

    expect(flagged(findings)).toEqual(["migrate S3_SECRET_KEY"]);
    expect(findings[0]?.message).toContain("stop merging the anchor into migrate");
  });

  it("refuses the anchor merged back into migrate", () => {
    const planted = edited(
      "    environment:\n      # The owner DSN",
      "    environment:\n      <<: *bootstrap\n      # The owner DSN",
    );

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual([
      "migrate EMBEDDINGS_URL",
      "migrate S3_ACCESS_KEY",
      "migrate S3_BUCKET",
      "migrate S3_ENDPOINT",
      "migrate S3_REGION",
      "migrate S3_SECRET_KEY",
    ]);
  });

  it("refuses a worker that takes the api's database URL", () => {
    const removed = edited("      DATABASE_URL: ${WORKER_DATABASE_URL:?}\n", "");

    expect(flagged(findingsIn(removed, EXCUSED))).toEqual([
      "api DATABASE_URL",
      "worker DATABASE_URL",
    ]);
  });

  it("refuses a worker that names the api's variable without braces", () => {
    const planted = edited("${WORKER_DATABASE_URL:?}", "$DATABASE_URL");

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual([
      "api DATABASE_URL",
      "worker DATABASE_URL",
    ]);
  });

  it("refuses a worker that falls back to the api's variable", () => {
    const planted = edited("${WORKER_DATABASE_URL:?}", "${WORKER_DATABASE_URL:-${DATABASE_URL}}");

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual([
      "api DATABASE_URL",
      "worker DATABASE_URL",
    ]);
  });

  it("refuses a migrate that takes the api's database URL", () => {
    const planted = edited(
      "${MIGRATE_DATABASE_URL:?set it to the owner DSN, which only migrate uses}",
      "${DATABASE_URL:?}",
    );

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual([
      "api DATABASE_URL",
      "migrate DATABASE_URL",
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

  it("refuses a library key the tier does not read", () => {
    const planted = edited(
      "      MAX_CONCURRENT_RUNS:",
      "      NODE_ENV: production\n      MAX_CONCURRENT_RUNS:",
    );

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual(["worker NODE_ENV"]);
  });

  it("refuses an excused key in another service", () => {
    const planted = edited(
      "      # The owner DSN",
      "      EMBEDDINGS_URL: http://model\n      # The owner DSN",
    );

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual(["migrate EMBEDDINGS_URL"]);
  });

  it("refuses an excuse for a key no longer set", () => {
    const removed = edited("  EMBEDDINGS_URL: ${EMBEDDINGS_URL:-}\n", "");

    expect(flagged(findingsIn(removed, EXCUSED))).toEqual([
      "api EMBEDDINGS_URL",
      "worker EMBEDDINGS_URL",
    ]);
  });

  it("refuses an excuse for a key now read", () => {
    const excusedButRead = { ...EXCUSED, KEK: { services: ["api"], reason: "planted" } };

    expect(flagged(findingsIn(compose, excusedButRead))).toEqual(["api KEK"]);
  });

  it("refuses a service whose image belongs to no tier", () => {
    const planted = `${compose}  planted:\n    image: x\n    environment:\n      A: b\n`;

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual(["planted"]);
  });

  it("refuses a migrate started without the gate", () => {
    const planted = edited(
      '["node", "apps/api/src/environment-gate.ts", "migrate"]',
      '["pnpm", "migrate"]',
    );
    const findings = findingsIn(planted, EXCUSED);

    expect(flagged(findings)).toEqual(["migrate"]);
    expect(findings[0]?.message).toContain(
      '["node","apps/api/src/environment-gate.ts","<process>"]',
    );
  });

  it("refuses a gate asked for a process of no tier", () => {
    const planted = edited(
      '["node", "apps/api/src/environment-gate.ts", "migrate"]',
      '["node", "apps/api/src/environment-gate.ts", "seed"]',
    );

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual(["migrate"]);
  });

  it("refuses an api command that bypasses the gate", () => {
    const planted = edited(
      "    image: ghcr.io/betteranswers/api@${API_IMAGE_DIGEST:?}\n",
      '    image: ghcr.io/betteranswers/api@${API_IMAGE_DIGEST:?}\n    command: ["node", "apps/api/src/main.ts"]\n',
    );

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual(["api"]);
  });

  it("refuses Docker's init in front of the gate", () => {
    const planted = edited(
      "    stop_grace_period: 30s\n    <<: [*restart, *logging]\n",
      "    init: true\n    stop_grace_period: 30s\n    <<: [*restart, *logging]\n",
    );

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual(["worker init"]);
  });

  it("refuses a worker healthcheck that runs Python without the gate", () => {
    const planted = edited(
      '["CMD", "python", "-m", "better_answers_worker.environment_gate", "health"]',
      '["CMD", "python", "-m", "better_answers_worker.health"]',
    );

    expect(flagged(findingsIn(planted, EXCUSED))).toEqual(["worker"]);
  });
});
