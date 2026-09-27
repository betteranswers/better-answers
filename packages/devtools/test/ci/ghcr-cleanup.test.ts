import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";
import {
  type ImageStep,
  readWorkflow,
  workflowStepSchema,
} from "@better-answers/devtools/workflows";

import { cleanup } from "../../../../scripts/ghcr-cleanup.mjs";

const NOW_MS = Date.parse("2026-10-11T06:43:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const LAYER = "application/vnd.oci.image.layer.v1.tar+gzip";
const SIGSTORE_BUNDLE = "application/vnd.dev.sigstore.bundle.v0.3+json";
const PACKAGES_API = "https://api.github.com/orgs/betteranswers/packages/container/";

const digestOf = (body: string): string =>
  `sha256:${createHash("sha256").update(body).digest("hex")}`;

type Blob = { readonly digest: string; readonly size: number };

const blob = (pair: string, size: number): Blob => ({ digest: `sha256:${pair.repeat(32)}`, size });

type Version = {
  readonly id: number;
  readonly digest: string;
  readonly ageMs: number;
  readonly tags: readonly string[];
  readonly body: string | undefined;
};

const version = (id: number, ageDays: number, tags: readonly string[], body: string): Version => ({
  id,
  digest: digestOf(body),
  ageMs: ageDays * DAY_MS,
  tags,
  body,
});

const cacheOf = (
  id: number,
  ageDays: number,
  layers: readonly Blob[],
  tags: readonly string[] = [],
): Version =>
  version(
    id,
    ageDays,
    tags,
    JSON.stringify({
      schemaVersion: 2,
      mediaType: OCI_MANIFEST,
      config: {
        mediaType: "application/vnd.buildkit.cacheconfig.v0",
        digest: `sha256:${String(id).padStart(64, "0")}`,
        size: 3249,
      },
      layers: layers.map((layer) => ({ mediaType: LAYER, ...layer })),
    }),
  );

const imageBody = (pair: string): string =>
  JSON.stringify({
    schemaVersion: 2,
    mediaType: OCI_MANIFEST,
    config: { mediaType: "application/vnd.oci.image.config.v1+json", ...blob(pair, 1470) },
    layers: [{ mediaType: LAYER, ...blob(pair.split("").reverse().join(""), 29_000_000) }],
  });

/** Shaped as a provenance push's untagged manifest in the backup package. */
const ATTESTATION_BODY = JSON.stringify({
  schemaVersion: 2,
  mediaType: OCI_MANIFEST,
  artifactType: SIGSTORE_BUNDLE,
  config: {
    mediaType: "application/vnd.oci.empty.v1+json",
    digest: "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    size: 2,
  },
  layers: [
    {
      mediaType: SIGSTORE_BUNDLE,
      digest: "sha256:41fc9c627f9e0cc14e398b1a104dfd308b9502125c148cf622c003a559943911",
      size: 10910,
    },
  ],
  subject: {
    mediaType: "application/vnd.docker.distribution.manifest.v2+json",
    digest: "sha256:54edc5be6dc8479847c3455d1e8a81d077ee5215149f28a75882761dd10a2da8",
    size: 2070,
  },
});

const IMAGE = version(101, 30, ["sha-3f5f107"], imageBody("e1"));
const ATTESTATION_INDEX = version(
  102,
  30,
  ["sha256-54edc5be6dc8479847c3455d1e8a81d077ee5215149f28a75882761dd10a2da8"],
  JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [{ mediaType: OCI_MANIFEST, artifactType: SIGSTORE_BUNDLE }],
  }),
);
const ATTESTATION = version(103, 30, [], ATTESTATION_BODY);
const UNTAGGED_IMAGE = version(104, 30, [], imageBody("e4"));
const MISSING: Version = {
  id: 105,
  digest: `sha256:${"e".repeat(64)}`,
  ageMs: 30 * DAY_MS,
  tags: [],
  body: undefined,
};
const MISHASHED: Version = {
  ...version(106, 30, [], imageBody("e6")),
  digest: `sha256:${"f".repeat(64)}`,
};

const BASE = blob("aa", 6_574_037);
const CURRENT = cacheOf(201, 0.04, [BASE, blob("a1", 1_000_000)], ["buildcache"]);
const NEWER = cacheOf(202, 2, [BASE, blob("a2", 1_000_000)]);
const NEW = cacheOf(203, 3, [BASE, blob("a3", 1_000_000)]);
const A_WEEK_OLD = cacheOf(204, 7, [BASE, blob("a4", 1_000_000)]);
const OLDER = cacheOf(205, 8, [BASE, blob("b5", 50_000_000)]);
const OLDEST = cacheOf(206, 30, [blob("b5", 50_000_000), blob("b6", 64_000_000)]);

const FLOOR = [CURRENT, NEWER, NEW];

const EVERY_KIND = [
  CURRENT,
  NEWER,
  NEW,
  A_WEEK_OLD,
  OLDER,
  IMAGE,
  ATTESTATION_INDEX,
  ATTESTATION,
  UNTAGGED_IMAGE,
  MISSING,
  MISHASHED,
  OLDEST,
];

type Answer = { readonly status: number; readonly headers?: Readonly<Record<string, string>> };

type Package = {
  readonly listing: readonly Version[];
  readonly relisting?: readonly Version[];
  readonly listed?: number;
  readonly deletes?: (id: number) => Answer;
};

type Sent = { readonly method: string; readonly url: string };

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const entryOf = (listed: Version) => {
  const at = new Date(NOW_MS - listed.ageMs).toISOString();
  return {
    id: listed.id,
    name: listed.digest,
    created_at: at,
    updated_at: at,
    metadata: { package_type: "container", container: { tags: listed.tags } },
  };
};

type Route = {
  readonly method: string;
  readonly pattern: RegExp;
  readonly answer: (tier: Package, found: (group: string) => string) => Response;
};

const registryOf = (packages: ReadonlyMap<string, Package>) => {
  const sent: Sent[] = [];
  const listings = new Map<string, number>();

  const listingOf = (fixture: Package, tier: string, page: number): Response => {
    if (page === 1) listings.set(tier, (listings.get(tier) ?? 0) + 1);
    if (fixture.listed !== undefined) return json({ message: "Forbidden" }, fixture.listed);
    const relisted = (listings.get(tier) ?? 0) > 1 ? fixture.relisting : undefined;
    return json((relisted ?? fixture.listing).slice((page - 1) * 100, page * 100).map(entryOf));
  };

  const manifestOf = (fixture: Package, digest: string): Response => {
    const body = fixture.listing.find((listed) => listed.digest === digest)?.body;
    return body === undefined
      ? json({ errors: [{ code: "MANIFEST_UNKNOWN" }] }, 404)
      : new Response(body, { headers: { "content-type": OCI_MANIFEST } });
  };

  const deleteOf = (fixture: Package, id: number): Response => {
    const { status, headers } = fixture.deletes?.(id) ?? { status: 204 };
    return new Response(status === 204 ? null : JSON.stringify({ message: "refused" }), {
      status,
      headers: headers ?? {},
    });
  };

  const tier = "(?<tier>[a-z]+)";
  const routes: readonly Route[] = [
    {
      method: "GET",
      pattern: new RegExp(`^${PACKAGES_API}${tier}/versions\\?per_page=100&page=(?<page>\\d+)$`),
      answer: (fixture, found) => listingOf(fixture, found("tier"), Number(found("page"))),
    },
    {
      method: "DELETE",
      pattern: new RegExp(`^${PACKAGES_API}${tier}/versions/(?<id>\\d+)$`),
      answer: (fixture, found) => deleteOf(fixture, Number(found("id"))),
    },
    {
      method: "GET",
      pattern: new RegExp(
        `^https://ghcr\\.io/token\\?service=ghcr\\.io&scope=repository%3Abetteranswers%2F${tier}%3Apull$`,
      ),
      answer: () => json({ token: "pull-token" }),
    },
    {
      method: "GET",
      pattern: new RegExp(
        `^https://ghcr\\.io/v2/betteranswers/${tier}/manifests/(?<digest>sha256:[0-9a-f]{64})$`,
      ),
      answer: (fixture, found) => manifestOf(fixture, found("digest")),
    },
  ];

  const answer = (method: string, url: string): Response => {
    const route = routes.find((one) => one.method === method && one.pattern.test(url));
    const groups = route?.pattern.exec(url)?.groups ?? {};
    const found = (group: string): string => groups[group] ?? "";
    const fixture = packages.get(found("tier"));
    if (route === undefined || fixture === undefined)
      throw new Error(`nothing answers ${method} ${url}`);
    return route.answer(fixture, found);
  };

  return {
    sent,
    fetch: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? "GET";
      sent.push({ method, url });
      return answer(method, url);
    },
    sleep: async (ms: number): Promise<void> => {
      sent.push({ method: "SLEEP", url: String(ms) });
    },
  };
};

const runAgainst = async (packages: ReadonlyMap<string, Package>, dryRun = false) => {
  const registry = registryOf(packages);
  const log: string[] = [];
  const result = await cleanup({
    token: "gh-token",
    owner: "betteranswers",
    actor: "github-actions[bot]",
    repository: "betteranswers/better-answers",
    tiers: [...packages.keys()],
    dryRun,
    fetch: registry.fetch,
    sleep: registry.sleep,
    nowMs: NOW_MS,
    log: (line: string) => {
      log.push(line);
    },
  });
  return { ...result, log, sent: registry.sent };
};

const onePackage = (fixture: Package) => new Map([["api", fixture]]);

const deletedIn = (sent: readonly Sent[]): readonly string[] =>
  sent.filter(({ method }) => method === "DELETE").map(({ url }) => url.replace(PACKAGES_API, ""));

const reasonRow = (reason: string, count = 1): string => `| \`api\` | ${reason} | ${count} |`;

describe("the weekly deletion of old BuildKit cache manifests", () => {
  it("deletes untagged caches over seven days old, oldest first", async () => {
    const run = await runAgainst(onePackage({ listing: EVERY_KIND }));

    expect(run.failed).toBe(false);
    expect(deletedIn(run.sent)).toEqual(["api/versions/206", "api/versions/205"]);
    expect(run.log).toEqual(["api: 12 versions, 2 selected, 2 deleted"]);
    expect(run.summary).toContain("| `api` | 12 | 2 | 2 | 114.0 MB |");
  });

  it.each([
    { what: "an image", listed: IMAGE, reason: "an image (`sha-` tag)" },
    {
      what: "an attestation index",
      listed: ATTESTATION_INDEX,
      reason: "an attestation index (`sha256-` tag)",
    },
    { what: "an attestation", listed: ATTESTATION, reason: `not a cache: \`${SIGSTORE_BUNDLE}\`` },
    {
      what: "an untagged image",
      listed: UNTAGGED_IMAGE,
      reason: "not a cache: `application/vnd.oci.image.config.v1+json`",
    },
    {
      what: "a manifest the registry lacks",
      listed: MISSING,
      reason: "manifest unreadable: HTTP 404",
    },
    {
      what: "a manifest off its digest",
      listed: MISHASHED,
      reason: "manifest unreadable: a body that does not hash to its digest",
    },
    { what: "a cache seven days old", listed: A_WEEK_OLD, reason: "a cache 7 days old or less" },
  ])("keeps $what, and counts it", async ({ listed, reason }) => {
    const run = await runAgainst(onePackage({ listing: [...FLOOR, listed] }));

    expect(deletedIn(run.sent)).toEqual([]);
    expect(run.summary).toContain(reasonRow(reason));
    expect(run.summary).toContain(reasonRow("the current cache (`buildcache` tag)"));
  });

  it("keeps the three newest caches, however old", async () => {
    const stale = [40, 41, 42, 43].map((ageDays, index) =>
      cacheOf(301 + index, ageDays, [BASE], index === 0 ? ["buildcache"] : []),
    );
    const run = await runAgainst(onePackage({ listing: stale }));

    expect(deletedIn(run.sent)).toEqual(["api/versions/304"]);
    expect(run.summary).toContain(reasonRow("one of the 3 newest caches", 2));
  });

  it("deletes nothing on a dry run, reporting the selection", async () => {
    const run = await runAgainst(onePackage({ listing: EVERY_KIND }), true);

    expect(run.failed).toBe(false);
    expect(run.sent.filter(({ method }) => method !== "GET")).toEqual([]);
    expect(run.summary).toEqual(
      [
        "## Cache manifests: a dry run, so nothing was deleted",
        "",
        "A version is selected when it is untagged, its manifest's config is `application/vnd.buildkit.cacheconfig.v0`, it is more than 7 days old, and it is not one of its package's 3 newest caches.",
        "",
        "| Package | Versions | Selected | Deleted | Would free, at most |",
        "| --- | ---: | ---: | ---: | ---: |",
        "| `api` | 12 | 2 | 0 | 114.0 MB |",
        "",
        "### Kept",
        "",
        "| Package | Why | Versions |",
        "| --- | --- | ---: |",
        "| `api` | one of the 3 newest caches | 2 |",
        "| `api` | a cache 7 days old or less | 1 |",
        "| `api` | an attestation index (`sha256-` tag) | 1 |",
        "| `api` | an image (`sha-` tag) | 1 |",
        "| `api` | manifest unreadable: a body that does not hash to its digest | 1 |",
        "| `api` | manifest unreadable: HTTP 404 | 1 |",
        "| `api` | not a cache: `application/vnd.dev.sigstore.bundle.v0.3+json` | 1 |",
        "| `api` | not a cache: `application/vnd.oci.image.config.v1+json` | 1 |",
        "| `api` | the current cache (`buildcache` tag) | 1 |",
        "",
        "A dry run sends no delete, so it cannot show whether this repository holds the Admin role that deleting takes on each package.",
        "",
        "*At most*: the blobs the manifests name that no kept cache names. An image can share a blob with a cache, and GHCR frees only a blob nothing names.",
        "",
      ].join("\n"),
    );
  });

  it("pauses two seconds before every delete", async () => {
    const run = await runAgainst(onePackage({ listing: EVERY_KIND }));

    expect(run.sent.filter(({ method }) => method !== "GET")).toEqual([
      { method: "SLEEP", url: "2000" },
      { method: "DELETE", url: `${PACKAGES_API}api/versions/206` },
      { method: "SLEEP", url: "2000" },
      { method: "DELETE", url: `${PACKAGES_API}api/versions/205` },
    ]);
  });

  it("reads every page of a package's versions", async () => {
    const images = Array.from({ length: 150 }, (_, index) =>
      version(1000 + index, 1, [`sha-${String(index).padStart(7, "0")}`], `{"image":${index}}`),
    );
    const run = await runAgainst(
      onePackage({ listing: [...images.slice(0, 120), OLDEST, ...FLOOR, ...images.slice(120)] }),
    );

    expect(run.sent.filter(({ url }) => url.endsWith("per_page=100&page=2"))).toHaveLength(2);
    expect(deletedIn(run.sent)).toEqual(["api/versions/206"]);
    expect(run.log).toEqual(["api: 154 versions, 1 selected, 1 deleted"]);
  });

  it("keeps a version tagged between its listing and delete", async () => {
    const retagged = { ...OLDEST, tags: ["buildcache"] };
    const run = await runAgainst(
      onePackage({
        listing: EVERY_KIND,
        relisting: EVERY_KIND.map((listed) => (listed === OLDEST ? retagged : listed)),
      }),
    );

    expect(deletedIn(run.sent)).toEqual(["api/versions/205"]);
    expect(run.summary).toContain(reasonRow("tagged or changed since it was listed"));
  });

  it("fails naming the Admin role when GitHub refuses a delete", async () => {
    const run = await runAgainst(
      onePackage({ listing: EVERY_KIND, deletes: () => ({ status: 403 }) }),
    );

    expect(run.failed).toBe(true);
    expect(deletedIn(run.sent)).toEqual(["api/versions/206"]);
    expect(run.log).toContain(
      '::error::GitHub refused to delete a version of ghcr.io/betteranswers/api (HTTP 403), which takes the Admin role on the package. At https://github.com/orgs/betteranswers/packages/container/api/settings, under "Manage Actions access", give betteranswers/better-answers the Admin role. If the package inherits its access from the repository, turn that off first.',
    );
    expect(run.summary).toContain(reasonRow("not sent"));
  });

  it.each([
    {
      limit: "an allowance running low",
      answer: { status: 204, headers: { "x-ratelimit-remaining": "150" } },
    },
    { limit: "a secondary rate limit", answer: { status: 403, headers: { "retry-after": "60" } } },
    { limit: "a 429", answer: { status: 429 } },
  ])("stops deleting at $limit, failing nothing", async ({ answer }) => {
    const run = await runAgainst(onePackage({ listing: EVERY_KIND, deletes: () => answer }));

    expect(run.failed).toBe(false);
    expect(deletedIn(run.sent)).toEqual(["api/versions/206"]);
    expect(run.log.filter((line) => line.startsWith("::warning::"))).toHaveLength(1);
    expect(run.summary).toContain("The next run takes the rest.");
  });

  it("deletes at most four hundred versions in one run", async () => {
    const backlog = Array.from({ length: 401 }, (_, index) =>
      cacheOf(5000 + index, 410 - index, [BASE]),
    );
    const run = await runAgainst(onePackage({ listing: [...FLOOR, ...backlog] }));

    expect(deletedIn(run.sent)).toHaveLength(400);
    expect(deletedIn(run.sent)).not.toContain("api/versions/5400");
    expect(run.log).toContain(
      "::warning::the run reached its cap of 400 deletes, so the next run takes the rest",
    );
  });

  it("names a package it cannot list, and reads the next", async () => {
    const run = await runAgainst(
      new Map([
        ["api", { listing: [], listed: 403 }],
        ["worker", { listing: EVERY_KIND }],
      ]),
    );

    expect(run.failed).toBe(true);
    expect(run.log).toEqual([
      "::error::the packages API would not list ghcr.io/betteranswers/api's versions (HTTP 403)",
      "worker: 12 versions, 2 selected, 2 deleted",
    ]);
    expect(deletedIn(run.sent)).toEqual(["worker/versions/206", "worker/versions/205"]);
  });
});

const cleanupWorkflowSchema = z.object({
  on: z.object({
    schedule: z.array(z.object({ cron: z.string() })),
    workflow_dispatch: z.object({
      inputs: z.object({ "dry-run": z.object({ type: z.string(), default: z.boolean() }) }),
    }),
  }),
  permissions: z.record(z.string(), z.string()),
  jobs: z.object({
    "cache-manifests": z.object({
      permissions: z.record(z.string(), z.string()),
      steps: z.array(workflowStepSchema),
    }),
  }),
});

const cleanupWorkflow = () => readWorkflow("ghcr-cleanup.yml", cleanupWorkflowSchema);
const cleanupSteps = () => cleanupWorkflow().jobs["cache-manifests"].steps;

const scheduleSchema = z.object({
  on: z.object({ schedule: z.array(z.object({ cron: z.string() })) }),
});

const scanTiersSchema = z.object({
  jobs: z.object({ tiers: z.object({ steps: z.array(workflowStepSchema) }) }),
});

const SCRIPT = "scripts/ghcr-cleanup.mjs";

const stepOf = (steps: readonly ImageStep[], holds: (step: ImageStep) => boolean): ImageStep => {
  const found = steps.find(holds);
  if (found === undefined) throw new Error("no step of ghcr-cleanup.yml's job matches");
  return found;
};

const scriptStep = () => stepOf(cleanupSteps(), (step) => step.run === `node ${SCRIPT}`);

const yqPathIn = (steps: readonly ImageStep[]): string | undefined =>
  steps.map((step) => step.env?.["TIERS"]).find((tiers) => tiers?.startsWith(".jobs.") === true);

const startOf = (file: string): { readonly minute: number; readonly weekly: string } => {
  const [minute = "", hour = "", ...rest] = (
    readWorkflow(file, scheduleSchema).on.schedule[0]?.cron ?? ""
  ).split(" ");
  return { minute: Number(hour) * 60 + Number(minute), weekly: rest.join(" ") };
};

/** A nightly mutation run takes about two and a half hours, and a scan's job is held to thirty minutes. */
const MUTATION_MINUTES = 150;
const SCAN_MINUTES = 30;

describe("the workflow that deletes the cache manifests", () => {
  it("reads the tiers from build.yml where scan.yml does", () => {
    const scanPath = yqPathIn(readWorkflow("scan.yml", scanTiersSchema).jobs.tiers.steps);
    const tiers = stepOf(cleanupSteps(), (step) => step.id === "tiers");

    expect(scanPath).toEqual(".jobs.image.strategy.matrix.include[].tier");
    expect(yqPathIn(cleanupSteps())).toEqual(scanPath);
    expect(tiers.run).toContain(".github/workflows/build.yml");
    expect(scriptStep().env?.["TIERS"]).toEqual("${{ steps.tiers.outputs.tiers }}");
  });

  it("dispatches as a dry run unless told otherwise", () => {
    expect(cleanupWorkflow().on.workflow_dispatch.inputs["dry-run"]).toEqual({
      type: "boolean",
      default: true,
    });
    expect(scriptStep().env?.["DRY_RUN"]).toEqual(
      "${{ github.event_name == 'schedule' && 'false' || inputs.dry-run }}",
    );
  });

  it("runs on Sundays, after the nightly mutation and scan", () => {
    const cleaning = startOf("ghcr-cleanup.yml");

    expect(cleaning.weekly).toEqual("* * 0");
    expect(cleaning.minute).toBeGreaterThanOrEqual(
      startOf("mutation.yml").minute + MUTATION_MINUTES,
    );
    expect(cleaning.minute).toBeGreaterThanOrEqual(startOf("scan.yml").minute + SCAN_MINUTES);
  });

  it("grants its job contents read and packages write alone", () => {
    expect(cleanupWorkflow().permissions).toEqual({ contents: "read" });
    expect(cleanupWorkflow().jobs["cache-manifests"].permissions).toEqual({
      contents: "read",
      packages: "write",
    });
  });

  it("checks out the script, which imports Node's built-ins alone", () => {
    const checkout = stepOf(
      cleanupSteps(),
      (step) => step.uses?.startsWith("actions/checkout@") === true,
    );
    const script = readFileSync(path.join(repositoryRoot, SCRIPT), "utf8");
    const imports = [...script.matchAll(/^import\b[^;]*?\bfrom "(?<from>[^"]+)";$/gms)].map(
      (found) => found.groups?.["from"] ?? "",
    );

    expect(z.string().parse(checkout.with?.["sparse-checkout"]).trim().split("\n")).toContain(
      SCRIPT,
    );
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((from) => !from.startsWith("node:"))).toEqual([]);
    expect(cleanupSteps().filter((step) => /\b(?:pnpm|npm|yarn) /.test(step.run ?? ""))).toEqual(
      [],
    );
  });
});
