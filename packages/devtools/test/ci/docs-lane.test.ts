import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assert, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { repositoryRoot, workspacePackages } from "@better-answers/devtools/paths";
import {
  gatesNamed,
  gatesUnder,
  rootScripts,
  workspacesGated,
  workspacesChecked,
} from "@better-answers/devtools/root-commands";
import {
  type ImageStep,
  readWorkflow,
  workflowStepSchema,
} from "@better-answers/devtools/workflows";

const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

const LANE_SCRIPT = "scripts/docs-lane.mjs";

const commandOf = (script: string): string => {
  const command = rootScripts()[script];
  assert(command !== undefined, `the root package.json has no ${script} script`);
  return command;
};

const groupOf = (match: RegExpMatchArray, name: string): string => match.groups?.[name] ?? "";

type Decision = { readonly lane: string; readonly images: string };

const answerOf = (published: string, key: string): string =>
  new RegExp(`^${key}=(?<value>.*)$`, "m").exec(published)?.groups?.["value"] ?? "";

const runLaneScript = (changed: readonly string[], separator = "\n"): string => {
  const run = spawnSync("node", [path.join(repositoryRoot, LANE_SCRIPT)], {
    input: changed.map((changedPath) => `${changedPath}${separator}`).join(""),
    encoding: "utf8",
  });

  expect(run.status, `${LANE_SCRIPT} ended non-zero: ${run.stderr}`).toBe(0);
  return run.stdout;
};

const decide = (changed: readonly string[], separator = "\n"): Decision => {
  const answered = runLaneScript(changed, separator);
  return { lane: answerOf(answered, "lane"), images: answerOf(answered, "images") };
};

const laneOf = (changed: readonly string[], separator = "\n"): string =>
  decide(changed, separator).lane;

const imagesOf = (changed: readonly string[]): string => decide(changed).images;

type LaneCase = {
  readonly changed: readonly string[];

  readonly lane: string;

  readonly images: string;

  readonly diff: string;

  readonly because: string;
};

const LANES: readonly LaneCase[] = [
  {
    changed: ["apps/web/src/app.tsx"],
    lane: "full",
    images: "no",
    diff: "a web-only change",
    because:
      "the api image includes the SPA's build, but the suites read this source on every run, and build.yml probes the image it pushes",
  },
  {
    changed: ["packages/core/src/kernel/principal/actor.ts"],
    lane: "full",
    images: "no",
    diff: "a core change",
    because: "the api image copies this file as source, not as an install input",
  },
  {
    changed: ["apps/worker/src/better_answers_worker/work_loop.py"],
    lane: "full",
    images: "no",
    diff: "a worker source change",
    because: "the worker image copies this file as source, not as an install input",
  },
  {
    changed: ["apps/worker/src/better_answers_worker/redaction/pins.py"],
    lane: "full",
    images: "yes",
    diff: "a redaction module change",
    because:
      "the worker image's build runs the redaction module to install the detector's weights, so it is an install input and not only source",
  },
  {
    changed: ["package.json"],
    lane: "full",
    images: "yes",
    diff: "the root manifest",
    because: "it names the pnpm version that corepack installs in the api image",
  },
  {
    changed: ["apps/web/package.json"],
    lane: "full",
    images: "yes",
    diff: "a workspace manifest",
    because: "the api image installs from every workspace's manifest, the SPA's included",
  },
  {
    changed: ["pnpm-lock.yaml"],
    lane: "full",
    images: "yes",
    diff: "a lockfile change",
    because: "the lockfile holds every image's dependencies, whatever else the diff changes",
  },
  {
    changed: ["apps/worker/uv.lock"],
    lane: "full",
    images: "yes",
    diff: "the worker's lockfile",
    because: "the worker image syncs its environment from it",
  },
  {
    changed: ["apps/api/Dockerfile"],
    lane: "full",
    images: "yes",
    diff: "a Dockerfile",
    because: "the Dockerfile defines the image",
  },
  {
    changed: ["deploy/backup.sh"],
    lane: "full",
    images: "yes",
    diff: "a deploy file",
    because: "deploy/ is the backup image's context, and the probes read the compose files in it",
  },
  {
    changed: [".node-version"],
    lane: "full",
    images: "yes",
    diff: "the node pin",
    because: "the api image's base must run the Node version that .node-version pins",
  },
  {
    changed: ["apps/worker/.tool-versions"],
    lane: "full",
    images: "yes",
    diff: "the uv pin",
    because: "the worker image must use the uv version that the runner resolves the lockfile with",
  },
  {
    changed: ["apps/api/tests/images/image.test.ts"],
    lane: "full",
    images: "yes",
    diff: "an image probe",
    because: "only the image probes run a probe file, so an edit to a probe must run them",
  },
  {
    changed: [".github/workflows/check.yml"],
    lane: "full",
    images: "yes",
    diff: "this workflow",
    because: "check.yml decides whether the probes run, so an edit to it must run them",
  },
  {
    changed: ["contracts/manifest.json"],
    lane: "full",
    images: "no",
    diff: "a tier contract change",
    because: "both tiers' suites read the contract, and no image copies it",
  },
  {
    changed: ["deployment/notes.ts"],
    lane: "full",
    images: "no",
    diff: "a lookalike of deploy/",
    because: "the script matches a directory by its whole name, so deployment/ is not deploy/",
  },
  {
    changed: ["docs/vision.md", "CONCEPTS.md"],
    lane: "docs",
    images: "no",
    diff: "a prose-only change",
    because: "the docs lane takes a change only when every changed path is markdown",
  },
  {
    changed: ["docs/vision.md", "apps/web/src/app.tsx"],
    lane: "full",
    images: "no",
    diff: "prose mixed with code",
    because:
      "the docs lane runs only the suites that read documents, so a change that includes code takes the full lane",
  },
  {
    changed: ["apps/web/src/app.tsx", "pnpm-lock.yaml"],
    lane: "full",
    images: "yes",
    diff: "source with a lockfile",
    because: "one image input in a change is enough to run the image probes",
  },
];

describe("the lane that each kind of change takes", () => {
  it.each(LANES)(
    "picks the $lane lane for $diff",
    ({ changed, lane, images, because }: LaneCase) => {
      expect(decide(changed), `${changed.join(", ")}: ${because}`).toEqual({ lane, images });
    },
  );
});

describe("which lane a change runs in", () => {
  it("takes the docs lane when every changed path is markdown", () => {
    expect(laneOf(["docs/adr/0043-what-an-action-is.md"])).toEqual("docs");
    expect(laneOf(["docs/specs/T-121.md", "CONCEPTS.md", "apps/web/AGENTS.md"])).toEqual("docs");
    expect(laneOf(["docs/specs/old-name.md", "docs/specs/new-name.md"])).toEqual("docs");
  });

  it("takes the full lane when anything but markdown changes", () => {
    expect(laneOf(["docs/vision.md", "packages/core/src/kernel/principal/actor.ts"])).toEqual(
      "full",
    );
    expect(laneOf(["docs/vision.md", "apps/worker/pyproject.toml"])).toEqual("full");

    expect(laneOf(["docs/notes.md", "scripts/notes.ts"])).toEqual("full");
  });

  it("takes the full lane for paths that only resemble markdown", () => {
    expect(laneOf(["docs/page.mdx"])).toEqual("full");
    expect(laneOf(["scripts/notes.md.ts"])).toEqual("full");
    expect(laneOf(["docs/vision.md.bak"])).toEqual("full");
    expect(laneOf(["docs/mdfiles/index.html"])).toEqual("full");
  });

  it("takes the full lane and the probes with no paths", () => {
    expect(decide([])).toEqual({ lane: "full", images: "yes" });
    expect(decide([""], "\n")).toEqual({ lane: "full", images: "yes" });
  });

  it("reads the NUL-separated paths that the workflow sends", () => {
    expect(laneOf(["docs/a.md", "docs/b.md"], "\0")).toEqual("docs");
    expect(laneOf(["docs/a\nb.md"], "\0")).toEqual("docs");
    expect(laneOf(["docs/a.md", "src/b.ts"], "\0")).toEqual("full");
  });
});

const imageLegSchema = z.object({
  tier: z.string(),
  context: z.string(),
  dockerfile: z.string(),
  probe: z.string().optional(),
});
type ImageLeg = z.infer<typeof imageLegSchema>;

const imageLegs = (): readonly ImageLeg[] =>
  z
    .object({
      jobs: z.object({
        image: z.object({
          strategy: z.object({ matrix: z.object({ include: z.array(imageLegSchema) }) }),
        }),
      }),
    })
    .parse(parse(read(".github/workflows/build.yml"))).jobs.image.strategy.matrix.include;

const probeFilesOf = (leg: ImageLeg): readonly string[] => {
  const file = (leg.probe ?? "").trim().split(/\s+/).at(-1) ?? "";
  return [...workspacePackages(), "apps/worker"]
    .map((workspace) => path.posix.join(workspace, file))
    .filter((candidate) => file !== "" && existsSync(path.join(repositoryRoot, candidate)));
};

const COPY = /^COPY\s+(?<words>.+)$/gm;

const copiedPathsOf = (leg: ImageLeg): readonly string[] =>
  [...read(leg.dockerfile).matchAll(COPY)].flatMap((found) => {
    const words = (found.groups?.["words"] ?? "").trim().split(/\s+/);
    if (words.some((word) => word.startsWith("--from="))) return [];
    return words
      .filter((word) => !word.startsWith("--"))
      .slice(0, -1)
      .map((source) => path.posix.join(leg.context, source).replace(/\/$/, ""));
  });

const changedPathIn = (copied: string): string =>
  statSync(path.join(repositoryRoot, copied)).isDirectory() ? `${copied}/a-changed-file` : copied;

const COPIED_SOURCE: readonly string[] = [
  "apps/api/src",
  "apps/web",
  "apps/worker/src",
  "packages/core/src",
  "packages/design-system",
  "packages/design-system/assets",
  "packages/design-system/styles.css",
  "packages/design-system/tokens",
  "packages/schema/migrations",
  "packages/schema/src",
];

const expectedImagesFor = (source: string): string =>
  COPIED_SOURCE.includes(source) ? "no" : "yes";

describe("which paths are an image's inputs", () => {
  it("treats each Dockerfile, .dockerignore and build.yml probe as input", () => {
    const named = imageLegs().flatMap((leg) => [
      leg.dockerfile,
      ...[path.posix.join(leg.context, ".dockerignore")].filter((ignore) =>
        existsSync(path.join(repositoryRoot, ignore)),
      ),
      ...probeFilesOf(leg),
    ]);

    expect(imageLegs().length).toBeGreaterThan(2);
    expect(
      imageLegs().filter((leg) => probeFilesOf(leg).length !== 1),
      "a leg's probe in build.yml names no test file that this test can find, or names a file that exists in two workspaces",
    ).toEqual([]);
    expect(
      named.filter((input) => imagesOf([input]) !== "yes"),
      "scripts/docs-lane.mjs does not answer images=yes for a Dockerfile, .dockerignore or probe that build.yml names, so a change to it skips the image probes. Add the path to IMAGE_INPUTS.",
    ).toEqual([]);
  });

  it("counts every non-source path a Dockerfile copies as an input", () => {
    const copied = [...new Set(imageLegs().flatMap(copiedPathsOf))];
    const misread = copied.filter(
      (source) => imagesOf([changedPathIn(source)]) !== expectedImagesFor(source),
    );

    expect(copied.length).toBeGreaterThan(10);
    expect(
      misread,
      "a Dockerfile copies a path that scripts/docs-lane.mjs does not count as an image input, or the script counts a path that COPIED_SOURCE lists as source. Add an install input to IMAGE_INPUTS in the script, or add a source path to COPIED_SOURCE.",
    ).toEqual([]);
    expect(
      COPIED_SOURCE.filter((source) => !copied.includes(source)),
      "COPIED_SOURCE names a path that no Dockerfile copies. Delete it from COPIED_SOURCE.",
    ).toEqual([]);
  });

  it("lists only image inputs that exist in the tree", () => {
    const list = /const IMAGE_INPUTS = \[(?<list>[^\]]*)\]/.exec(read(LANE_SCRIPT))?.groups?.[
      "list"
    ];
    assert(
      list !== undefined,
      "scripts/docs-lane.mjs does not declare `const IMAGE_INPUTS = [...]`",
    );
    const listed = [...list.matchAll(/"(?<input>[^"]+)"/g)].map((found) => groupOf(found, "input"));

    expect(listed.length).toBeGreaterThan(10);
    expect(
      listed.filter((input) => !existsSync(path.join(repositoryRoot, input))),
      "IMAGE_INPUTS in scripts/docs-lane.mjs names a path that does not exist. Correct the path, or delete it.",
    ).toEqual([]);
  });
});

type ProseSuite = {
  readonly file: string;

  readonly reads: string;

  readonly inTheLane: string | { readonly outside: string };
};

const PROSE_SUITES: readonly ProseSuite[] = [
  {
    file: "packages/devtools/test/ci/deploy-tree.test.ts",
    reads:
      "the deploy tree, every workflow under .github/workflows, deploy/RELEASES.md and docs/operations/{RUNBOOK,SECRETS,coolify}.md",
    inTheLane: "check:docs:devtools",
  },
  {
    file: "packages/devtools/test/ci/tracked-skills.test.ts",
    reads:
      "packages/design-system/SKILL.md through its symlink, and which of the pixel-perfect plugin's files git tracks",
    inTheLane: "check:docs:devtools",
  },
  {
    file: "packages/devtools/test/scans/contract-paths.test.ts",
    reads:
      "contracts/README.md and every fixture under contracts/, for the repository paths they name",
    inTheLane: "check:docs:devtools",
  },
  {
    file: "packages/devtools/test/gates/solutions-docs.test.ts",
    reads: "every doc under docs/solutions, for the ADR format and for a line-number reference",
    inTheLane: "check:docs:devtools",
  },
  {
    file: "packages/devtools/test/ci/docs-lane.test.ts",
    reads: "no markdown. It checks this table against the scripts that check:docs runs",
    inTheLane: "check:docs:devtools",
  },
  {
    file: "apps/web/test/gates/web-skills.test.ts",
    reads:
      "every markdown file of the verify and playwright-specs skills, every path under apps/ they name, the suite's modules and specs for the helpers they share, and the navigation list for the pages the feature files name",
    inTheLane: "check:docs:web",
  },
  {
    file: "apps/worker/tests/redaction/test_redaction.py",
    reads: "apps/worker/tests/fixtures/redaction/supplier-information-pack.md",
    inTheLane: {
      outside:
        "it loads the detector's models to read that fixture, which needs the weights cache and a uv environment. The docs lane exists to avoid installing both. The fixture is a test input, not a document, so an edit to it alone is the one markdown change that this lane does not check. The process review of 21/09/2026 recorded this decision",
    },
  },
  {
    file: "apps/worker/tests/redaction/test_redaction_windows.py",
    reads: "the same fixture, for heading offsets and truncation lengths",
    inTheLane: { outside: "the same fixture and the same uv environment as the suite above" },
  },
  {
    file: "apps/worker/tests/test_planted_page.py",
    reads: "the same fixture, asserting each planted literal appears exactly once",
    inTheLane: { outside: "the same fixture and the same uv environment as the suite above" },
  },
  {
    file: "packages/core/test/tier-contract.test.ts",
    reads:
      "contracts/README.md, which it excludes by name. A second markdown file under contracts/ counts as an undeclared fixture and fails this suite",
    inTheLane: "check:docs:core",
  },
  {
    file: "apps/worker/tests/test_tier_contract.py",
    reads: "the same exclusion, from the other tier",
    inTheLane: {
      outside:
        "packages/core/test/tier-contract.test.ts checks the same exclusion and fails on the same commit. This suite needs a uv environment to repeat that check",
    },
  },
  {
    file: "apps/worker/tests/test_image.py",
    reads: "the same fixture, read through the built worker image",
    inTheLane: {
      outside:
        "it builds the worker image, which needs a builder and the cache credentials. The suite tests the image, not the markdown page",
    },
  },
];

const SUITES_IN_THE_LANE = PROSE_SUITES.flatMap((suite) =>
  typeof suite.inTheLane === "string" ? [{ file: suite.file, step: suite.inTheLane }] : [],
);

const SUITES_OUTSIDE_THE_LANE = PROSE_SUITES.filter((suite) => typeof suite.inTheLane !== "string");

describe("what the docs lane runs", () => {
  it("runs its steps through scripts/check.mjs", () => {
    const steps = gatesNamed(commandOf("check:docs"));

    expect(
      steps.length,
      "the root check:docs script does not call scripts/check.mjs with its steps",
    ).toBeGreaterThan(1);
    expect(steps).toContain("format:check");
    expect(steps.filter((step) => rootScripts()[step] === undefined)).toEqual([]);
  });

  it("runs exactly the suites that PROSE_SUITES puts in it", () => {
    const commands = gatesNamed(commandOf("check:docs")).map(commandOf).join("\n");
    const named = (suite: { readonly file: string }): boolean =>
      commands.includes(path.basename(suite.file));

    expect(
      SUITES_IN_THE_LANE.filter((suite) => !named(suite)).map((suite) => suite.file),
      "PROSE_SUITES puts a suite in the docs lane, but no step of check:docs runs it. Add the suite to the step that its row names.",
    ).toEqual([]);
    expect(
      SUITES_OUTSIDE_THE_LANE.filter(named).map((suite) => suite.file),
      "check:docs runs a suite that PROSE_SUITES keeps in the full lane. Move the row into the docs lane, or remove the suite from check:docs.",
    ).toEqual([]);
  });

  it("names an existing step and file for each suite", () => {
    const absent = PROSE_SUITES.filter(
      (suite) => !existsSync(path.join(repositoryRoot, suite.file)),
    ).map((suite) => suite.file);
    const unrunnable = SUITES_IN_THE_LANE.filter(
      ({ step }) => !Object.hasOwn(rootScripts(), step),
    ).map(({ file, step }) => `${file} is run by ${step}`);

    expect(PROSE_SUITES.length).toBeGreaterThan(5);
    expect(
      absent,
      "a row of PROSE_SUITES names a file that does not exist. Correct the path, or delete the row.",
    ).toEqual([]);
    expect(
      unrunnable,
      "a row of PROSE_SUITES names a step that is not a root script. Name a root script.",
    ).toEqual([]);
  });
});

type Step = ImageStep;

const workflowFile = z.object({
  jobs: z.record(
    z.string(),
    z.object({
      if: z.string().optional(),
      needs: z.union([z.string(), z.array(z.string())]).optional(),
      permissions: z.record(z.string(), z.string()).optional(),
      strategy: z
        .object({
          "fail-fast": z.boolean().optional(),
          matrix: z.record(z.string(), z.array(z.unknown())),
        })
        .optional(),
      steps: z.array(workflowStepSchema).optional(),
    }),
  ),
});
type Workflow = z.infer<typeof workflowFile>;
type Job = Workflow["jobs"][string];

const workflow = (name: string): Workflow => readWorkflow(name, workflowFile);

const LANE = "lane";

const FAN_IN = "check";

const TITLE_JOB = "pr-title";

const JOBS_ON_NO_LANE: readonly string[] = [TITLE_JOB];

const checkJobs = (): Readonly<Record<string, Job>> => workflow("check.yml").jobs;

const legsOfLane = (lane: string): readonly string[] =>
  Object.keys(checkJobs()).filter(
    (job) => job.startsWith(`${lane}-`) && !JOBS_ON_NO_LANE.includes(job),
  );

const stepsOfJob = (job: string): readonly Step[] => checkJobs()[job]?.steps ?? [];

const laneStep = (): Step | undefined => stepsOfJob(LANE).find((one) => one.id === LANE);

const SHARD_ARGUMENT = / --shard="\$\{SHARD\}"$/;

const runsAShard = (step: Step): boolean => SHARD_ARGUMENT.test((step.run ?? "").trim());

const envOf = (step: Step): readonly [string, string][] => Object.entries(step.env ?? {});

const gatesOf = (job: string): readonly string[] =>
  stepsOfJob(job).flatMap((step) =>
    gatesUnder((step.run ?? "").trim().replace(SHARD_ARGUMENT, "")),
  );

const NARROWED: Readonly<Record<string, readonly string[]>> = {
  "check:workspaces": [
    "check:libraries:unsharded",
    "check:core:typecheck",
    "check:core:suite",
    "check:api",
    "check:web:typecheck",
    "check:web:test",
    "check:web:e2e",
  ],
};

const RUN_BY_STEP: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "packages/core": { typecheck: "check:core:typecheck", test: "check:core:suite" },
  "apps/web": { typecheck: "check:web:typecheck", test: "check:web:test", e2e: "check:web:e2e" },
};

const SHARDED_LEGS: Readonly<Record<string, string>> = {
  "full-web-browser": "check:web:e2e",
};

const manifestAt = (directory: string): { readonly name: string; readonly check: string } => {
  const { name, scripts } = z
    .object({ name: z.string(), scripts: z.record(z.string(), z.string()) })
    .parse(JSON.parse(read(path.join(directory, "package.json"))));
  return { name, check: scripts["check"] ?? "" };
};

const wholeGateOf = (gate: string): string =>
  Object.entries(NARROWED).find(([, parts]) => parts.includes(gate))?.[0] ?? gate;

const CODE_LANE = "full";

const A_BASE = "0123456789abcdef0123456789abcdef01234567";

const TARGET_TIP = "1111111111111111111111111111111111111111";

/** Keys are expression paths such as `github.event_name`. GitHub reads an absent path as "". */
type Context = Readonly<Record<string, string>>;

type LaneStepCase = {
  readonly run: string;

  readonly github: Context;

  readonly fetched: boolean;

  readonly changedSince: Readonly<Record<string, readonly string[]>>;

  readonly lane: string;

  readonly images: string;
};

const aPullRequestOn = (base: string): Context => ({
  "github.event_name": "pull_request",
  "github.event.pull_request.base.sha": base,
});

const LANE_STEPS: readonly LaneStepCase[] = [
  {
    run: "a pull request changing the lockfile",
    github: aPullRequestOn(TARGET_TIP),
    fetched: true,
    changedSince: { [TARGET_TIP]: ["pnpm-lock.yaml"] },
    lane: "full",
    images: "yes",
  },
  {
    run: "a pull request changing source",
    github: aPullRequestOn(TARGET_TIP),
    fetched: true,
    changedSince: { [TARGET_TIP]: ["apps/api/src/main.ts"] },
    lane: "full",
    images: "no",
  },
  {
    run: "a docs-only pull request",
    github: aPullRequestOn(TARGET_TIP),
    fetched: true,
    changedSince: { [TARGET_TIP]: ["docs/vision.md"] },
    lane: "docs",
    images: "no",
  },
  {
    run: "an unfetched pull request base",
    github: aPullRequestOn(TARGET_TIP),
    fetched: false,
    changedSince: { [TARGET_TIP]: ["apps/api/src/main.ts"] },
    lane: "full",
    images: "yes",
  },
  {
    run: "a manual dispatch, which names no base",
    github: { "github.event_name": "workflow_dispatch" },
    fetched: true,
    changedSince: { [TARGET_TIP]: ["docs/vision.md"] },
    lane: "full",
    images: "yes",
  },
  {
    run: "a branch's first push",
    github: { "github.event_name": "push", "github.event.before": "0".repeat(40) },
    fetched: true,
    changedSince: { ["0".repeat(40)]: ["docs/vision.md"] },
    lane: "full",
    images: "yes",
  },
  {
    run: "a called run changing source",
    github: { "github.event_name": "workflow_call", "github.event.before": A_BASE },
    fetched: true,
    changedSince: { [A_BASE]: ["packages/core/src/kernel/principal/actor.ts"] },
    lane: "full",
    images: "no",
  },
];

type LaneStepRun = {
  readonly status: number | null;

  readonly published: Decision;

  readonly asked: readonly string[];

  readonly output: string;
};

const stub = (bin: string, name: string, script: string): void => {
  writeFileSync(path.join(bin, name), `#!/bin/sh\n${script}`);
  chmodSync(path.join(bin, name), 0o755);
};

const EXPRESSION = /^\$\{\{ (?<path>[\w.]+) \}\}$/;

const laneStepEnv = (github: Context): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(laneStep()?.env ?? {}).map(([name, value]) => {
      const named = EXPRESSION.exec(value)?.groups?.["path"];
      if (named === undefined)
        throw new Error(
          `the lane step sets ${name} to more than one expression path, which this test cannot read`,
        );
      return [name, github[named] ?? ""];
    }),
  );

type Scratch = {
  readonly asked: string;

  readonly fetched: boolean;

  readonly since: string;

  readonly fetchHead: string;
};

const gitStub = ({ asked, fetched, since, fetchHead }: Scratch): string =>
  [
    `echo "$1" >> '${asked}'`,
    'for word in "$@"; do before="$last"; last="$word"; done',
    'case "$1" in',
    fetched ? `  fetch) echo "$last" > '${fetchHead}' ;;` : "  fetch) exit 128 ;;",
    `  rev-parse) [ "$last" = FETCH_HEAD ] && cat '${fetchHead}' ;;`,
    `  diff) [ "$last" = HEAD ] && cat '${since}/'"$before" ;;`,
    "  *) exit 3 ;;",
    "esac",
    "",
  ].join("\n");

const runTheLaneStep = (
  { github, fetched, changedSince }: LaneStepCase,
  answered?: string,
): LaneStepRun => {
  const scratch = mkdtempSync(path.join(tmpdir(), "lane-step-"));
  const bin = path.join(scratch, "bin");
  const since = path.join(scratch, "since");
  const asked = path.join(scratch, "asked");
  const published = path.join(scratch, "published");
  mkdirSync(bin);
  mkdirSync(since);
  for (const [base, changed] of Object.entries(changedSince)) {
    writeFileSync(
      path.join(since, base),
      changed.map((changedPath) => `${changedPath}\0`).join(""),
    );
  }
  writeFileSync(asked, "");
  writeFileSync(published, "");
  stub(bin, "git", gitStub({ asked, fetched, since, fetchHead: path.join(scratch, "fetch-head") }));
  if (answered !== undefined) stub(bin, "node", `printf '${answered}'\n`);
  const script = laneStep()?.run ?? "exit 9";
  const ran = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env["PATH"] ?? ""}`,
      RUNNER_TEMP: scratch,
      GITHUB_OUTPUT: published,
      ...laneStepEnv(github),
    },
  });
  const outputs = readFileSync(published, "utf8");
  const run = {
    status: ran.status,
    published: {
      lane: answerOf(outputs, "lane"),
      images: answerOf(outputs, "images"),
    },
    asked: readFileSync(asked, "utf8")
      .split("\n")
      .filter((line) => line !== ""),
    output: `${ran.stdout}${ran.stderr}`,
  };
  rmSync(scratch, { recursive: true, force: true });
  return run;
};

describe("the lane step in check.yml", () => {
  it.each(LANE_STEPS)("puts $run in $lane", (scenario: LaneStepCase) => {
    const run = runTheLaneStep(scenario);

    expect(run.status, `the step printed: ${run.output}`).toBe(0);
    expect(run.published).toEqual({ lane: scenario.lane, images: scenario.images });
  });

  it("diffs a pull request from its base", () => {
    const run = runTheLaneStep({
      run: "a pull request",
      github: aPullRequestOn(A_BASE),
      fetched: true,
      changedSince: { [A_BASE]: ["package.json"] },
      lane: "full",
      images: "yes",
    });

    expect(run.asked).toEqual(["fetch", "rev-parse", "diff"]);
    expect(run.published).toEqual({ lane: "full", images: "yes" });
  });

  it.each([
    {
      word: "the retired affected lane",
      github: aPullRequestOn(TARGET_TIP),
      answered: "lane=affected\\nimages=no\\n",
      says: "no lane",
    },
    {
      word: "the retired pr lane",
      github: aPullRequestOn(TARGET_TIP),
      answered: "lane=pr\\nimages=no\\n",
      says: "no lane",
    },
    {
      word: "an images answer of maybe",
      github: aPullRequestOn(TARGET_TIP),
      answered: "lane=full\\nimages=maybe\\n",
      says: "neither",
    },
  ])("refuses $word with no outputs", ({ github, answered, says }) => {
    const run = runTheLaneStep(
      {
        run: "a change",
        github,
        fetched: true,
        changedSince: { [TARGET_TIP]: ["docs/vision.md"] },
        lane: "",
        images: "",
      },
      answered,
    );

    expect(run.status, `the step printed: ${run.output}`).not.toBe(0);
    expect(run.output).toContain(says);
    expect(run.published).toEqual({ lane: "", images: "" });
  });
});

const IMAGE_GATES = "check:images";

describe("the full lane's legs and the root check's gates", () => {
  it("runs the root check's gates and the image gates", () => {
    const ran = [...new Set(legsOfLane(CODE_LANE).flatMap(gatesOf).map(wholeGateOf))];

    expect(
      ran,
      "the full lane's legs and the root check no longer run the same gates. Add the missing gate to a leg. If no single leg can run a step, split it across the legs and list its parts in NARROWED, which maps the parts back to the whole step.",
    ).toEqual([...gatesNamed(commandOf("check")), ...gatesNamed(commandOf(IMAGE_GATES))]);
  });

  it("runs the image gates on one leg only", () => {
    const imageGates = gatesNamed(commandOf(IMAGE_GATES));
    const legs = legsOfLane(CODE_LANE).filter((job) =>
      gatesOf(job).some((gate) => imageGates.includes(gate)),
    );

    expect(imageGates.length).toBeGreaterThan(1);
    expect(legs).toEqual(["full-images"]);
    expect(
      imageGates.filter((gate) => gatesNamed(commandOf("check")).includes(gate)),
      "the root check runs an image gate, so every local run of check rebuilds the images. Run image gates only from check:images.",
    ).toEqual([]);
  });

  it("runs each gate on one leg only", () => {
    const ran = legsOfLane(CODE_LANE).flatMap(gatesOf);

    expect(ran.filter((gate, at) => ran.indexOf(gate) !== at)).toEqual([]);
    expect(ran.filter((gate) => rootScripts()[gate] === undefined)).toEqual([]);
  });
});

describe("how the legs split check:workspaces", () => {
  it("splits a step only into root scripts the legs run", () => {
    const ran = new Set(legsOfLane(CODE_LANE).flatMap(gatesOf));

    for (const [whole, parts] of Object.entries(NARROWED)) {
      expect(rootScripts()[whole], `${whole} is not a root script`).toBeDefined();
      expect(parts.filter((part) => rootScripts()[part] === undefined)).toEqual([]);
      expect(
        parts.filter((part) => !ran.has(part)),
        `NARROWED splits ${whole} into a part that no full-lane leg runs`,
      ).toEqual([]);
    }
  });

  it("covers every workspace of check:workspaces once across its parts", () => {
    const selected = [
      ...Object.values(NARROWED)
        .flat()
        .flatMap((part) => workspacesChecked(commandOf(part))),
      ...Object.keys(RUN_BY_STEP),
    ];

    expect(
      [...selected].sort(),
      "a workspace with a check script is on no leg, or on two legs. Together, the legs must run every workspace that check:workspaces runs, each one once.",
    ).toEqual([...workspacesGated()].sort());
  });

  it("runs every step that a split workspace's check names", () => {
    for (const [directory, steps] of Object.entries(RUN_BY_STEP)) {
      const { name, check } = manifestAt(directory);

      expect(
        gatesNamed(check),
        `${directory}'s check steps differ from its RUN_BY_STEP entry, so a step runs on no leg`,
      ).toEqual(Object.keys(steps));
      for (const [step, script] of Object.entries(steps)) {
        expect(rootScripts()[script]).toEqual(`pnpm --filter ${name} run ${step}`);
        expect(NARROWED["check:workspaces"]).toContain(script);
      }
    }
  });
});

describe("the sharded legs of check.yml", () => {
  it.each(Object.keys(SHARDED_LEGS))("numbers %s's shards 1 to N, one per job", (leg) => {
    const strategy = checkJobs()[leg]?.strategy;
    assert(strategy !== undefined, `${leg} has no strategy in check.yml`);

    expect(
      Object.keys(strategy.matrix),
      "the matrix has a key other than shard. A second key multiplies the jobs, so two jobs run the same shard.",
    ).toEqual(["shard"]);
    const shards = strategy.matrix["shard"];
    assert(shards !== undefined, `${leg} has no shard matrix`);
    expect(shards.length).toBeGreaterThan(1);
    expect(
      shards,
      "number the shards 1 to N. A gap or a repeat leaves some files untested.",
    ).toEqual(shards.map((_, at) => at + 1));
    expect(stepsOfJob(leg).flatMap(envOf)).toEqual([
      ["SHARD", "${{ matrix.shard }}/${{ strategy.job-total }}"],
    ]);
    expect(
      strategy["fail-fast"],
      "set fail-fast to false. Otherwise a failing shard cancels the others, and they report nothing about their own files.",
    ).toBe(false);
  });

  it("runs each sharded script alone, and shards no other leg", () => {
    const slicing = Object.keys(checkJobs()).filter((job) => stepsOfJob(job).some(runsAShard));

    expect(slicing).toEqual(Object.keys(SHARDED_LEGS));
    for (const [leg, script] of Object.entries(SHARDED_LEGS)) {
      expect(
        gatesOf(leg),
        "a sharded leg must run only its sharded script. Another gate on that leg runs once per shard instead of once. Move it to an unsharded leg.",
      ).toEqual([script]);
    }
  });
});

type VerdictCase = {
  readonly verdict: "passes" | "fails";

  readonly run: string;

  readonly lane: string;

  readonly ran: readonly string[];

  readonly title: string;

  readonly wanted: string;

  readonly withoutItsLegs?: boolean;

  readonly says?: string;
};

const PROVED_NOTHING = "proved nothing";

const verdictOf = (run: SpawnSyncReturns<string>): VerdictCase["verdict"] =>
  run.status === 0 ? "passes" : "fails";

/** A matrix leg is one entry in `needs`, and its result combines the results of all its shards. */
const FULL_LEGS = [
  "full-root",
  "full-core",
  "full-api",
  "full-web-unit",
  "full-web-browser",
  "full-worker",
  "full-images",
];

const VERDICTS: readonly VerdictCase[] = [
  {
    verdict: "passes",
    run: "a full pull request",
    lane: "full",
    ran: FULL_LEGS,
    title: "success",
    wanted: "success",
  },
  {
    verdict: "fails",
    run: "a full pull request that ran no suite",
    lane: "full",
    ran: [],
    title: "success",
    wanted: "success",
  },
  {
    verdict: "fails",
    run: "a full pull request whose title failed",
    lane: "full",
    ran: FULL_LEGS,
    title: "failure",
    wanted: "success",
  },
  {
    verdict: "passes",
    run: "a docs pull request",
    lane: "docs",
    ran: ["docs-gates"],
    title: "success",
    wanted: "success",
  },
  {
    verdict: "fails",
    run: "a docs pull request whose title failed",
    lane: "docs",
    ran: ["docs-gates"],
    title: "failure",
    wanted: "success",
  },
  {
    verdict: "passes",
    run: "a full push",
    lane: "full",
    ran: FULL_LEGS,
    title: "skipped",
    wanted: "skipped",
  },
  {
    verdict: "fails",
    run: "a full pull request missing a leg",
    lane: "full",
    ran: FULL_LEGS.slice(1),
    title: "success",
    wanted: "success",
  },
  {
    verdict: "fails",
    run: "a docs run with no leg to require",
    lane: "docs",
    ran: [],
    title: "success",
    wanted: "success",
    withoutItsLegs: true,
    says: PROVED_NOTHING,
  },
  {
    verdict: "fails",
    run: "a full run with no leg to require",
    lane: "full",
    ran: [],
    title: "skipped",
    wanted: "skipped",
    withoutItsLegs: true,
    says: PROVED_NOTHING,
  },
];

const runFanIn = ({
  lane,
  ran,
  title,
  wanted,
  withoutItsLegs,
}: VerdictCase): SpawnSyncReturns<string> => {
  const legs = Object.keys(checkJobs())
    .filter((job) => ![FAN_IN, LANE, ...JOBS_ON_NO_LANE].includes(job))
    .filter((job) => withoutItsLegs !== true || !job.startsWith(`${lane}-`))
    .map((job) => [job, { result: ran.includes(job) ? "success" : "skipped" }] as const);

  return spawnSync("bash", ["-e", "-c", stepsOfJob(FAN_IN)[0]?.run ?? "exit 9"], {
    encoding: "utf8",
    env: {
      ...process.env,
      LANE: lane,
      LEGS: JSON.stringify({
        ...Object.fromEntries(legs),
        [LANE]: { result: "success" },
        [TITLE_JOB]: { result: title },
      }),
      TITLE_WANTED: wanted,
    },
  });
};

const VERDICTS_THAT_SAY_WHY = VERDICTS.flatMap(({ says, ...scenario }) =>
  says === undefined ? [] : [{ ...scenario, says }],
);

describe("the fan-in job that reports check.yml's result", () => {
  it("reports the required context after every leg, whatever their results", () => {
    const jobs = Object.keys(checkJobs());
    const fanIn = checkJobs()[FAN_IN];

    expect(
      jobs.at(-1),
      "the fan-in job `check` must be the last job in check.yml. Move the leg that was added after it above `check`.",
    ).toEqual(FAN_IN);
    expect(fanIn?.needs).toEqual(jobs.filter((job) => job !== FAN_IN));
    expect(
      workflow("build.yml").jobs["image"]?.needs,
      "build.yml's image job must need `check`, its call of check.yml, so that it waits for the result that the fan-in job reports.",
    ).toContain("check");
    expect(
      fanIn?.if,
      "the fan-in job's if must be `${{ always() }}`. Under a narrower condition, a failed leg skips the fan-in job, and a skipped required context never reports.",
    ).toEqual("${{ always() }}");
  });

  it("requires pr-title success only when pr-title runs", () => {
    const condition = checkJobs()[TITLE_JOB]?.if;
    assert(condition !== undefined, `${TITLE_JOB} has no if in check.yml`);
    const runsOn = /^\$\{\{ (?<condition>.+) \}\}$/.exec(condition)?.groups?.["condition"];
    const env = stepsOfJob(FAN_IN).flatMap(envOf);

    assert(
      runsOn !== undefined,
      `${TITLE_JOB}'s if is not a single expression that this test can read`,
    );
    expect(Object.fromEntries(env)["TITLE_WANTED"]).toEqual(
      `\${{ (${runsOn}) && 'success' || 'skipped' }}`,
    );
  });

  it.each(VERDICTS)("$verdict on $run", (scenario: VerdictCase) => {
    const ran = runFanIn(scenario);

    expect(verdictOf(ran), `${ran.stdout}${ran.stderr}`).toEqual(scenario.verdict);
    expect(ran.stdout).toContain(
      `${TITLE_JOB}: ${scenario.title} (this lane wants ${scenario.wanted})`,
    );
  });

  it.each(VERDICTS_THAT_SAY_WHY)("$run says why", ({ says, ...scenario }) => {
    expect(runFanIn(scenario).stdout).toContain(says);
  });
});

describe("the pull request title check in check.yml", () => {
  const TITLE_COMMAND = "commitlint";
  const PULL_REQUEST = "7";
  const REPOSITORY = "betteranswers/better-answers";
  const CONVENTIONAL = "ci: check the pull request's title with commitlint";
  const FROM_A_PULL_REQUEST = { PULL_REQUEST };

  const COMMITLINT = ["@commitlint/cli", "@commitlint/config-conventional"];

  const titleStep = (): Step | undefined =>
    stepsOfJob(TITLE_JOB).find((one) => (one.run ?? "").includes(TITLE_COMMAND));

  const pinnedVersion = (name: string): string =>
    z
      .object({ devDependencies: z.record(z.string(), z.string()) })
      .parse(JSON.parse(read("package.json"))).devDependencies[name] ?? "";

  const installedVersion = (name: string): string =>
    z
      .object({ version: z.string() })
      .parse(JSON.parse(read(path.join("node_modules", name, "package.json")))).version;

  const offlineDlx = (): string => {
    const asked = COMMITLINT.map((name) => `--package=${name}@${installedVersion(name)}`);
    const installed = path.join(repositoryRoot, "node_modules", ".bin", "commitlint");
    return `#!/bin/sh\n[ "$*" = "dlx ${asked.join(" ")} commitlint" ] || { echo "pnpm was asked: $*" >&2; exit 3; }\nexec '${installed}'\n`;
  };

  const titleStepWith = (
    title: string,
    event: { readonly PULL_REQUEST: string },
  ): SpawnSyncReturns<string> => {
    const bin = mkdtempSync(path.join(tmpdir(), "pr-title-"));
    writeFileSync(
      path.join(bin, "gh"),
      `#!/bin/sh\n[ "$*" = "api repos/${REPOSITORY}/pulls/${PULL_REQUEST} --jq .title" ] || exit 3\nprintf '%s\\n' "$TITLE"\n`,
    );
    chmodSync(path.join(bin, "gh"), 0o755);
    writeFileSync(path.join(bin, "pnpm"), offlineDlx());
    chmodSync(path.join(bin, "pnpm"), 0o755);
    const ran = spawnSync("bash", ["-e", "-c", titleStep()?.run ?? "exit 9"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env["PATH"] ?? ""}`,
        GITHUB_REPOSITORY: REPOSITORY,
        ...event,
        TITLE: title,
      },
    });
    rmSync(bin, { recursive: true, force: true });
    return ran;
  };

  it("runs the commitlint version that the root manifest pins", () => {
    expect(COMMITLINT.map(pinnedVersion)).toEqual(COMMITLINT.map(installedVersion));
  });

  it("passes a Conventional title", () => {
    const run = titleStepWith(CONVENTIONAL, FROM_A_PULL_REQUEST);

    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });

  it("fails an event that names no pull request", () => {
    const run = titleStepWith(CONVENTIONAL, { PULL_REQUEST: "" });

    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain("no pull request number in this event");
  });

  it.each([
    { shape: "a declarative title", title: "The title check runs in CI", named: "[type-empty]" },
    {
      shape: "a title over 100 characters",
      title: `ci: check the title${" and check it again".repeat(5)}`,
      named: "[header-max-length]",
    },
  ])("fails $shape, naming the rule", ({ title, named }) => {
    const run = titleStepWith(title, FROM_A_PULL_REQUEST);

    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain(named);
  });
});

describe("the workflows, in a repository without a merge queue", () => {
  const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");
  const workflowFiles = readdirSync(workflowDirectory).filter((file) => file.endsWith(".yml"));
  const textOf = (file: string): string => readFileSync(path.join(workflowDirectory, file), "utf8");

  it("do not use merge_group, which only a merge queue triggers", () => {
    const queueEvent = ["merge", "group"].join("_");

    expect(
      workflowFiles.filter((file) => textOf(file).includes(queueEvent)),
      `a workflow names ${queueEvent} again. The repository has no merge queue, so delete the trigger or condition.`,
    ).toEqual([]);
  });

  it("name no job verdict, because a skipped run passes it", () => {
    const jobsNamed = z.object({
      jobs: z.record(z.string(), z.object({ name: z.string().optional() })),
    });
    const named = workflowFiles.flatMap((file) =>
      Object.entries(jobsNamed.parse(parse(textOf(file))).jobs)
        .filter(([id, job]) => [id, job.name].includes("verdict"))
        .map(([id]) => `${file}: ${id}`),
    );

    expect(named).toEqual([]);
  });
});
