import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
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

type Decision = { readonly lane: string; readonly images: string };

const answerOf = (published: string, key: string): string =>
  new RegExp(`^${key}=(?<value>.*)$`, "m").exec(published)?.groups?.["value"] ?? "";

const answersTo = (changed: readonly string[], separator = "\n"): string => {
  const run = spawnSync("node", [path.join(repositoryRoot, LANE_SCRIPT)], {
    input: changed.map((changedPath) => `${changedPath}${separator}`).join(""),
    encoding: "utf8",
  });

  expect(run.status, `${LANE_SCRIPT} ended non-zero: ${run.stderr}`).toBe(0);
  return run.stdout;
};

const decide = (changed: readonly string[], separator = "\n"): Decision => {
  const answered = answersTo(changed, separator);
  return { lane: answerOf(answered, "lane"), images: answerOf(answered, "images") };
};

const laneOf = (changed: readonly string[], separator = "\n"): string =>
  decide(changed, separator).lane;

const imagesOf = (changed: readonly string[]): string => decide(changed).images;

const dependenciesOf = (changed: readonly string[]): string =>
  answerOf(answersTo(changed), "dependencies");

type LaneCase = {
  readonly changed: readonly string[];

  readonly lane: string;

  readonly images: string;

  /** Names the change in the test's title; `because` holds the reason, printed on failure. */
  readonly diff: string;

  readonly because: string;
};

/** The paths are what a merge group's diff hands the script; the answer is what the legs read. */
const LANES: readonly LaneCase[] = [
  {
    changed: ["apps/web/src/app.tsx"],
    lane: "full",
    images: "no",
    diff: "a web-only change",
    because:
      "the api image carries the SPA's build, but it is source the suites read on every run, and build.yml probes the image it pushes",
  },
  {
    changed: ["packages/core/src/kernel/actor.ts"],
    lane: "full",
    images: "no",
    diff: "a core change",
    because: "source the api image copies as it stands",
  },
  {
    changed: ["apps/worker/src/better_answers_worker/work_loop.py"],
    lane: "full",
    images: "no",
    diff: "a worker source change",
    because: "source the worker image copies as it stands",
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
    because: "it names the pnpm the api image's corepack installs",
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
    because: "a lockfile change is every image's dependencies, whatever else the diff touched",
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
    because: "it is the image",
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
    because: "the api image's base must run the node the tree is pinned to",
  },
  {
    changed: ["apps/worker/.tool-versions"],
    lane: "full",
    images: "yes",
    diff: "the uv pin",
    because: "the worker image's uv must be the uv the runner resolves the lockfile with",
  },
  {
    changed: ["apps/api/tests/image.test.ts"],
    lane: "full",
    images: "yes",
    diff: "an image probe",
    because: "an edit to a probe is run by that probe and by nothing else",
  },
  {
    changed: [".github/workflows/check.yml"],
    lane: "full",
    images: "yes",
    diff: "this workflow",
    because: "it decides whether the probes run, and an edit to that decision is read by a run",
  },
  {
    changed: ["contracts/manifest.json"],
    lane: "full",
    images: "no",
    diff: "a tier contract change",
    because: "both tiers' suites read the contract, and no image copies a line of it",
  },
  {
    changed: ["deployment/notes.ts"],
    lane: "full",
    images: "no",
    diff: "a lookalike of deploy/",
    because: "a directory is matched by its whole name, never by a prefix of it",
  },
  {
    changed: ["docs/vision.md", "CONTEXT.md"],
    lane: "docs",
    images: "no",
    diff: "a prose-only change",
    because: "every changed path is prose, which is the docs lane's whole rule",
  },
  {
    changed: ["docs/vision.md", "apps/web/src/app.tsx"],
    lane: "full",
    images: "no",
    diff: "prose mixed with code",
    because:
      "prose with code: the docs lane runs the suites that read documents, and none of the suites that read the code",
  },
  {
    changed: ["apps/web/src/app.tsx", "pnpm-lock.yaml"],
    lane: "full",
    images: "yes",
    diff: "source with a lockfile",
    because: "one image input among any number of other paths is enough",
  },
];

describe("which paths reach which lane", () => {
  it.each(LANES)(
    "picks the $lane lane for $diff",
    ({ changed, lane, images, because }: LaneCase) => {
      expect(decide(changed), `${changed.join(", ")}: ${because}`).toEqual({ lane, images });
    },
  );
});

describe("which lane a change runs in", () => {
  it("takes the docs lane when every changed path is markdown", () => {
    expect(laneOf(["docs/adr/0043-what-an-act-is.md"])).toEqual("docs");
    expect(laneOf(["docs/specs/T-121.md", "CONTEXT.md", "apps/web/CODING_STANDARDS.md"])).toEqual(
      "docs",
    );
    expect(laneOf(["docs/specs/old-name.md", "docs/specs/new-name.md"])).toEqual("docs");
  });

  it("takes the full lane when anything but markdown changes", () => {
    expect(laneOf(["docs/vision.md", "packages/core/src/kernel/actor.ts"])).toEqual("full");
    expect(laneOf(["docs/vision.md", "apps/worker/pyproject.toml"])).toEqual("full");

    expect(laneOf(["docs/notes.md", "scripts/notes.ts"])).toEqual("full");
  });

  it("refuses every path that only looks like markdown", () => {
    expect(laneOf(["docs/page.mdx"])).toEqual("full");
    expect(laneOf(["scripts/notes.md.ts"])).toEqual("full");
    expect(laneOf(["docs/vision.md.bak"])).toEqual("full");
    expect(laneOf(["docs/mdfiles/index.html"])).toEqual("full");
  });

  it("takes the full lane and probes when given no paths", () => {
    expect(decide([])).toEqual({ lane: "full", images: "yes" });
    expect(decide([""], "\n")).toEqual({ lane: "full", images: "yes" });
  });

  it("reads the NUL-separated form the workflow actually feeds it", () => {
    expect(laneOf(["docs/a.md", "docs/b.md"], "\0")).toEqual("docs");
    expect(laneOf(["docs/a\nb.md"], "\0")).toEqual("docs");
    expect(laneOf(["docs/a.md", "src/b.ts"], "\0")).toEqual("full");
  });
});

describe("which paths are a dependency change", () => {
  it.each([
    "package.json",
    "apps/api/package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "apps/worker/pyproject.toml",
    "apps/worker/uv.lock",
  ])("typechecks a pull request that changes %s", (changed) => {
    expect(dependenciesOf(["apps/api/src/main.ts", changed])).toEqual("yes");
  });

  it("leaves a change to no manifest or lockfile untypechecked", () => {
    expect(dependenciesOf(["apps/api/src/main.ts", "docs/vision.md"])).toEqual("no");
    expect(dependenciesOf(["apps/web/package.json.bak", "packages/core/uv.lock"])).toEqual("no");
  });

  it("typechecks when given no paths", () => {
    expect(dependenciesOf([])).toEqual("yes");
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

/** The probe command ends in its file, relative to whichever workspace it runs in. */
const probeFilesOf = (leg: ImageLeg): readonly string[] => {
  const file = (leg.probe ?? "").trim().split(/\s+/).at(-1) ?? "";
  return [...workspacePackages(), "apps/worker"]
    .map((workspace) => path.posix.join(workspace, file))
    .filter((candidate) => file !== "" && existsSync(path.join(repositoryRoot, candidate)));
};

const COPY = /^COPY\s+(?<words>.+)$/gm;

/** A stage's own output is no path in the tree, so a `--from` copy names nothing to watch. */
const copiedBy = (leg: ImageLeg): readonly string[] =>
  [...read(leg.dockerfile).matchAll(COPY)].flatMap((found) => {
    const words = (found.groups?.["words"] ?? "").trim().split(/\s+/);
    if (words.some((word) => word.startsWith("--from="))) return [];
    return words
      .filter((word) => !word.startsWith("--"))
      .slice(0, -1)
      .map((source) => path.posix.join(leg.context, source).replace(/\/$/, ""));
  });

const aChangeTo = (copied: string): string =>
  statSync(path.join(repositoryRoot, copied)).isDirectory() ? `${copied}/a-changed-file` : copied;

/** Copied into an image as it stands; the suites read it on every run and build.yml probes the image. */
const COPIED_SOURCE: readonly string[] = [
  "apps/api/src",
  "apps/web",
  "apps/worker/src",
  "packages/core/src",
  "packages/design-system",
  "packages/design-system/assets",
  "packages/schema/migrations",
  "packages/schema/src",
];

describe("which paths are an image's inputs", () => {
  it("counts every Dockerfile, ignore file and probe build.yml names", () => {
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
      "a leg's probe names no file this reading can find, or names one in two workspaces",
    ).toEqual([]);
    expect(
      named.filter((input) => imagesOf([input]) !== "yes"),
      "a change to what build.yml builds or probes would leave the probes deferred",
    ).toEqual([]);
  });

  it("counts everything a Dockerfile copies except the source", () => {
    const copied = [...new Set(imageLegs().flatMap(copiedBy))];
    const misread = copied.filter(
      (source) => imagesOf([aChangeTo(source)]) !== (COPIED_SOURCE.includes(source) ? "no" : "yes"),
    );

    expect(copied.length).toBeGreaterThan(10);
    expect(
      misread,
      "a Dockerfile copies a path the lane script does not count as an input, or counts source it was told to leave. Add it to the script's list, or to COPIED_SOURCE.",
    ).toEqual([]);
    expect(
      COPIED_SOURCE.filter((source) => !copied.includes(source)),
      "COPIED_SOURCE names a path no Dockerfile copies",
    ).toEqual([]);
  });

  it("names only paths the tree has", () => {
    const list = /const IMAGE_INPUTS = \[(?<list>[^\]]*)\]/.exec(read(LANE_SCRIPT))?.groups?.[
      "list"
    ];
    const listed = [...(list ?? "").matchAll(/"(?<input>[^"]+)"/g)].map(
      (found) => found.groups?.["input"] ?? "",
    );

    expect(listed.length).toBeGreaterThan(10);
    expect(
      listed.filter((input) => !existsSync(path.join(repositoryRoot, input))),
      "the lane script names an image input the tree no longer has",
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
    file: "apps/api/tests/avoid-words.test.ts",
    reads:
      "apps/api/tests/old-words.ts and CONTEXT.md's heads and marks, then every tracked text file outside its carve-outs",
    inTheLane: "check:docs:api",
  },
  {
    file: "packages/devtools/test/ci/deploy-tree.test.ts",
    reads:
      "the deploy tree, .github/workflows/*.yml and deploy/RELEASES.md and docs/operations/{RUNBOOK,SECRETS,coolify}.md",
    inTheLane: "check:docs:devtools",
  },
  {
    file: "packages/devtools/test/ci/provision-skills.test.ts",
    reads: "the tracked SKILL.md files, packages/design-system/SKILL.md through its symlink",
    inTheLane: "check:docs:devtools",
  },
  {
    file: "packages/devtools/test/ci/survey-architecture-skill.test.ts",
    reads:
      ".claude/skills/survey-architecture/SKILL.md and its two references, and every path they name",
    inTheLane: "check:docs:devtools",
  },
  {
    file: "packages/devtools/test/ci/docs-lane.test.ts",
    reads: "no markdown — it holds this table against the script the lane runs",
    inTheLane: "check:docs:devtools",
  },
  {
    file: "apps/web/test/browser-suite-skill.test.ts",
    reads: ".claude/skills/browser-suite/SKILL.md, and every apps/** path it names",
    inTheLane: "check:docs:web",
  },
  {
    file: "apps/worker/tests/test_redaction.py",
    reads: "apps/worker/tests/fixtures/redaction/supplier-information-pack.md",
    inTheLane: {
      outside:
        "it loads the detector's models to read that fixture, which is the weights cache and a uv environment — the whole of what the docs lane exists not to install. The fixture is a test input rather than a document, and an edit to it alone is the one markdown change this lane does not gate: said here so that it is a decision on the record (the process review, 21/09/2026)",
    },
  },
  {
    file: "apps/worker/tests/test_redaction_windows.py",
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
      "contracts/README.md, by excluding it by name — so a SECOND markdown file under contracts/ is counted as an undeclared fixture and turns this red",
    inTheLane: "check:docs:core",
  },
  {
    file: "apps/worker/tests/test_tier_contract.py",
    reads: "the same exclusion, from the other tier",
    inTheLane: {
      outside:
        "the core-side suite above holds the same coupling and catches the same commit, and this one needs a uv environment to say so a second time",
    },
  },
  {
    file: "apps/worker/tests/test_image.py",
    reads: "the same fixture, read through the built worker image",
    inTheLane: {
      outside:
        "it builds the worker image, which needs a builder and the cache credentials — and what it is about is the image, not the page",
    },
  },
];

describe("what the docs lane runs", () => {
  it("runs its steps through the root check's runner", () => {
    const steps = gatesNamed(rootScripts()["check:docs"] ?? "");

    expect(steps.length, "the root check:docs does not call the runner").toBeGreaterThan(1);
    expect(steps).toContain("format:check");
    expect(steps.filter((step) => rootScripts()[step] === undefined)).toEqual([]);
  });

  it("runs exactly the prose suites this table puts in it", () => {
    const lane = rootScripts()["check:docs"] ?? "";
    const commands = gatesNamed(lane)
      .map((step) => rootScripts()[step] ?? "")
      .join("\n");
    const named = (suite: ProseSuite): boolean => commands.includes(path.basename(suite.file));

    expect(
      PROSE_SUITES.filter((suite) => typeof suite.inTheLane === "string" && !named(suite)).map(
        (suite) => suite.file,
      ),
      "a suite this table puts in the docs lane is run by no step of check:docs.",
    ).toEqual([]);
    expect(
      PROSE_SUITES.filter((suite) => typeof suite.inTheLane !== "string" && named(suite)).map(
        (suite) => suite.file,
      ),
      "check:docs runs a suite this table says the full lane keeps. Move the row, or take the suite back out.",
    ).toEqual([]);
  });

  it("names an existing step and file for each suite", () => {
    const absent = PROSE_SUITES.filter(
      (suite) => !existsSync(path.join(repositoryRoot, suite.file)),
    ).map((suite) => suite.file);
    const unrunnable = PROSE_SUITES.flatMap((suite) =>
      typeof suite.inTheLane === "string" && rootScripts()[suite.inTheLane] === undefined
        ? [`${suite.file} is run by ${suite.inTheLane}`]
        : [],
    );

    expect(PROSE_SUITES.length).toBeGreaterThan(5);
    expect(absent, "a row names a suite the tree does not have. Correct it, or delete it.").toEqual(
      [],
    );
    expect(unrunnable, "a row names a step that is not a root script.").toEqual([]);
  });
});

type Step = ImageStep;

const workflowFile = z.object({
  jobs: z.record(
    z.string(),
    z.object({
      if: z.string().optional(),
      needs: z.union([z.string(), z.array(z.string())]).optional(),
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

/** The branch ruleset's required context, and the job build.yml's `image` waits on. */
const FAN_IN = "check";

/** No lane's leg, though its name starts like the pr lane's: it reads the title in the queue too. */
const TITLE_JOB = "pr-title";

/** No lane's leg either: it runs on a pull request whose dependencies moved, and nowhere else. */
const TYPECHECK_JOB = "dependency-typecheck";

const LOCKFILE_JOB = "pr-lockfile";

const checkJobs = (): Readonly<Record<string, Job>> => workflow("check.yml").jobs;

/** The fan-in reads the prefix to decide what it requires, so it is load-bearing, not tidiness. */
const legsOf = (lane: string): readonly string[] =>
  Object.keys(checkJobs()).filter((job) => job.startsWith(`${lane}-`) && job !== TITLE_JOB);

const stepsOfJob = (job: string): readonly Step[] => checkJobs()[job]?.steps ?? [];

const laneStep = (): Step | undefined => stepsOfJob(LANE).find((one) => one.id === LANE);

/** The matrix leg hands each of its jobs one slice of a root script's files. */
const SHARD_ARGUMENT = / --shard="\$\{SHARD\}"$/;

const gatesOf = (job: string): readonly string[] =>
  stepsOfJob(job).flatMap((step) =>
    gatesUnder((step.run ?? "").trim().replace(SHARD_ARGUMENT, "")),
  );

/** One step cannot run on every leg, so the legs run these narrowings and this folds them back. */
const NARROWED: Readonly<Record<string, readonly string[]>> = {
  "check:workspaces": [
    "check:libraries:unsharded",
    "check:core:typecheck",
    "check:core:suite",
    "check:api",
    "check:web",
  ],
};

/** A workspace whose suite is sharded runs its check as the steps it names, each a root script. */
const RUN_BY_STEP: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "packages/core": { typecheck: "check:core:typecheck", test: "check:core:suite" },
};

const SHARDED_LEG = "full-core";

const manifestAt = (directory: string): { readonly name: string; readonly check: string } => {
  const { name, scripts } = z
    .object({ name: z.string(), scripts: z.record(z.string(), z.string()) })
    .parse(JSON.parse(read(path.join(directory, "package.json"))));
  return { name, check: scripts["check"] ?? "" };
};

const wholeGateOf = (gate: string): string =>
  Object.entries(NARROWED).find(([, parts]) => parts.includes(gate))?.[0] ?? gate;

/** The lane that runs the root check's gates. The docs lane runs the prose suites, held above. */
const CODE_LANE = "full";

const A_BASE = "0123456789abcdef0123456789abcdef01234567";

const TARGET = "refs/heads/main";

/** Where `TARGET` points, which every group in the queue descends from. */
const TARGET_TIP = "1111111111111111111111111111111111111111";

/** The head of the group queued ahead, which GitHub gives the group behind it as `base_sha`. */
const AHEAD = "2222222222222222222222222222222222222222";

/** A run's `github` context by the path an expression names; GitHub reads an absent path as "". */
type Context = Readonly<Record<string, string>>;

const aGroupOn = (parent: string): Context => ({
  "github.event_name": "merge_group",
  "github.event.merge_group.base_sha": parent,
  "github.event.merge_group.base_ref": TARGET,
});

const AN_IMAGE_CHANGE = ["apps/worker/pyproject.toml", "apps/worker/uv.lock"];

type LaneStepCase = {
  readonly run: string;

  readonly github: Context;

  /** Whether the stubbed `git fetch` finds the base. */
  readonly fetched: boolean;

  /** What `git diff` names from each base to HEAD; a base absent here is one git cannot read. */
  readonly changedSince: Readonly<Record<string, readonly string[]>>;

  readonly lane: string;

  readonly images: string;

  readonly dependencies: string;
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
    lane: "pr",
    images: "yes",
    dependencies: "yes",
  },
  {
    run: "a pull request changing the worker's lockfile",
    github: aPullRequestOn(TARGET_TIP),
    fetched: true,
    changedSince: { [TARGET_TIP]: ["apps/worker/uv.lock"] },
    lane: "pr",
    images: "yes",
    dependencies: "yes",
  },
  {
    run: "a pull request changing source",
    github: aPullRequestOn(TARGET_TIP),
    fetched: true,
    changedSince: { [TARGET_TIP]: ["apps/api/src/main.ts"] },
    lane: "pr",
    images: "no",
    dependencies: "no",
  },
  {
    run: "a docs-only pull request",
    github: aPullRequestOn(TARGET_TIP),
    fetched: true,
    changedSince: { [TARGET_TIP]: ["docs/vision.md"] },
    lane: "pr",
    images: "no",
    dependencies: "no",
  },
  {
    run: "an unfetched pull request base",
    github: aPullRequestOn(TARGET_TIP),
    fetched: false,
    changedSince: { [TARGET_TIP]: ["apps/api/src/main.ts"] },
    lane: "pr",
    images: "yes",
    dependencies: "yes",
  },
  {
    run: "a docs-only merge group",
    github: aGroupOn(TARGET_TIP),
    fetched: true,
    changedSince: { [TARGET_TIP]: ["docs/vision.md"] },
    lane: "docs",
    images: "no",
    dependencies: "no",
  },
  {
    run: "a merge group changing source",
    github: aGroupOn(TARGET_TIP),
    fetched: true,
    changedSince: { [TARGET_TIP]: ["apps/api/src/main.ts"] },
    lane: "full",
    images: "no",
    dependencies: "no",
  },
  {
    run: "a merge group changing a lockfile",
    github: aGroupOn(TARGET_TIP),
    fetched: true,
    changedSince: { [TARGET_TIP]: ["apps/api/src/main.ts", "pnpm-lock.yaml"] },
    lane: "full",
    images: "yes",
    dependencies: "no",
  },
  {
    run: "a docs group behind an image change",
    github: aGroupOn(AHEAD),
    fetched: true,
    changedSince: {
      [AHEAD]: ["docs/vision.md"],
      [TARGET_TIP]: [...AN_IMAGE_CHANGE, "docs/vision.md"],
    },
    lane: "full",
    images: "yes",
    dependencies: "no",
  },
  {
    run: "a test-only group behind an image change",
    github: aGroupOn(AHEAD),
    fetched: true,
    changedSince: {
      [AHEAD]: ["apps/worker/tests/test_pipeline_landed.py"],
      [TARGET_TIP]: [...AN_IMAGE_CHANGE, "apps/worker/tests/test_pipeline_landed.py"],
    },
    lane: "full",
    images: "yes",
    dependencies: "no",
  },
  {
    run: "an unfetched merge group base",
    github: aGroupOn(TARGET_TIP),
    fetched: false,
    changedSince: { [TARGET_TIP]: ["docs/vision.md"] },
    lane: "full",
    images: "yes",
    dependencies: "no",
  },
  {
    run: "a merge group with no base",
    github: { "github.event_name": "merge_group" },
    fetched: true,
    changedSince: { [TARGET_TIP]: ["docs/vision.md"] },
    lane: "full",
    images: "yes",
    dependencies: "no",
  },
  {
    run: "a branch's first push",
    github: { "github.event_name": "push", "github.event.before": "0".repeat(40) },
    fetched: true,
    changedSince: { ["0".repeat(40)]: ["docs/vision.md"] },
    lane: "full",
    images: "yes",
    dependencies: "no",
  },
  {
    run: "a called run changing source",
    github: { "github.event_name": "workflow_call", "github.event.before": A_BASE },
    fetched: true,
    changedSince: { [A_BASE]: ["packages/core/src/kernel/actor.ts"] },
    lane: "full",
    images: "no",
    dependencies: "no",
  },
];

type LaneStepRun = {
  readonly status: number | null;

  readonly published: Decision & { readonly dependencies: string };

  /** The git subcommands the step ran, in order. */
  readonly asked: readonly string[];

  readonly output: string;
};

const stub = (bin: string, name: string, script: string): void => {
  writeFileSync(path.join(bin, name), `#!/bin/sh\n${script}`);
  chmodSync(path.join(bin, name), 0o755);
};

const EXPRESSION = /^\$\{\{ (?<path>[\w.]+) \}\}$/;

/** The step's `env:` as GitHub expands it over `github`, refusing any expression but one path. */
const laneStepEnv = (github: Context): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(laneStep()?.env ?? {}).map(([name, value]) => {
      const named = EXPRESSION.exec(value)?.groups?.["path"];
      if (named === undefined) throw new Error(`the lane step's ${name} reads more than a path`);
      return [name, github[named] ?? ""];
    }),
  );

type Scratch = {
  readonly asked: string;

  readonly fetched: boolean;

  /** A file per base that `git diff` can read, holding the paths it names from there. */
  readonly since: string;

  readonly fetchHead: string;
};

/** Fetches `TARGET` as `TARGET_TIP` and a sha as itself, as the remote would. */
const gitOver = ({ asked, fetched, since, fetchHead }: Scratch): string =>
  [
    `echo "$1" >> '${asked}'`,
    'for word in "$@"; do before="$last"; last="$word"; done',
    'case "$1" in',
    fetched
      ? `  fetch) if [ "$last" = '${TARGET}' ]; then echo ${TARGET_TIP}; else echo "$last"; fi > '${fetchHead}' ;;`
      : "  fetch) exit 128 ;;",
    `  rev-parse) [ "$last" = FETCH_HEAD ] && cat '${fetchHead}' ;;`,
    `  diff) [ "$last" = HEAD ] && cat '${since}/'"$before" ;;`,
    "  *) exit 3 ;;",
    "esac",
    "",
  ].join("\n");

/** Over a `git` answering from `changedSince`; `answered` replaces the lane script's answer. */
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
  stub(bin, "git", gitOver({ asked, fetched, since, fetchHead: path.join(scratch, "fetch-head") }));
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
      dependencies: answerOf(outputs, "dependencies"),
    },
    asked: readFileSync(asked, "utf8")
      .split("\n")
      .filter((line) => line !== ""),
    output: `${ran.stdout}${ran.stderr}`,
  };
  rmSync(scratch, { recursive: true, force: true });
  return run;
};

describe("the lane inside check.yml", () => {
  it.each(LANE_STEPS)("puts $run in $lane", (scenario: LaneStepCase) => {
    const run = runTheLaneStep(scenario);

    expect(run.status, `the step printed: ${run.output}`).toBe(0);
    expect(run.published).toEqual({
      lane: scenario.lane,
      images: scenario.images,
      dependencies: scenario.dependencies,
    });
  });

  it("diffs a pull request from its base", () => {
    const run = runTheLaneStep({
      run: "a pull request",
      github: aPullRequestOn(A_BASE),
      fetched: true,
      changedSince: { [A_BASE]: ["package.json"] },
      lane: "pr",
      images: "yes",
      dependencies: "yes",
    });

    expect(run.asked).toEqual(["fetch", "rev-parse", "diff"]);
    expect(run.published.dependencies).toEqual("yes");
  });

  it.each([
    {
      word: "the retired affected lane",
      github: aGroupOn(TARGET_TIP),
      answered: "lane=affected\\nimages=no\\ndependencies=no\\n",
      says: "no lane",
    },
    {
      word: "an images answer of maybe",
      github: aGroupOn(TARGET_TIP),
      answered: "lane=full\\nimages=maybe\\ndependencies=no\\n",
      says: "neither",
    },
    {
      word: "a pull request's dependencies answer of maybe",
      github: aPullRequestOn(TARGET_TIP),
      answered: "lane=full\\nimages=no\\ndependencies=maybe\\n",
      says: "neither",
    },
  ])("refuses $word, publishing nothing", ({ github, answered, says }) => {
    const run = runTheLaneStep(
      {
        run: "a change",
        github,
        fetched: true,
        changedSince: { [TARGET_TIP]: ["docs/vision.md"] },
        lane: "",
        images: "",
        dependencies: "",
      },
      answered,
    );

    expect(run.status, `the step printed: ${run.output}`).not.toBe(0);
    expect(run.output).toContain(says);
    expect(run.published).toEqual({ lane: "", images: "", dependencies: "" });
  });
});

describe("the full lane's legs against the one list of gates", () => {
  it("runs exactly the root check's gates across its legs", () => {
    const ran: string[] = [];
    for (const gate of legsOf(CODE_LANE).flatMap(gatesOf)) {
      const whole = wholeGateOf(gate);
      if (!ran.includes(whole)) ran.push(whole);
    }

    expect(
      ran,
      "the legs and the root check have stopped naming the same gates. Add the gate to a leg, or narrow it in NARROWED.",
    ).toEqual(gatesNamed(rootScripts()["check"] ?? ""));
  });

  it("runs each gate on one leg only", () => {
    const ran = legsOf(CODE_LANE).flatMap(gatesOf);

    expect(ran.filter((gate, at) => ran.indexOf(gate) !== at)).toEqual([]);
    expect(ran.filter((gate) => rootScripts()[gate] === undefined)).toEqual([]);
  });
});

describe("how the legs narrow check:workspaces", () => {
  it("narrows a step only into root scripts the legs run", () => {
    const ran = legsOf(CODE_LANE).flatMap(gatesOf);

    for (const [whole, parts] of Object.entries(NARROWED)) {
      expect(rootScripts()[whole], `${whole} is not a root script`).toBeDefined();
      expect(parts.filter((part) => rootScripts()[part] === undefined)).toEqual([]);
      expect(
        parts.filter((part) => !ran.includes(part)),
        `${whole} is narrowed past the legs`,
      ).toEqual([]);
    }
  });

  it("selects, between the narrowings of check:workspaces, every workspace it gates", () => {
    const selected = [
      ...Object.values(NARROWED)
        .flat()
        .flatMap((part) => workspacesChecked(rootScripts()[part] ?? "")),
      ...Object.keys(RUN_BY_STEP),
    ];

    expect(
      [...selected].sort(),
      "a workspace with a check script is on no leg, or is on two. The legs run check:workspaces between them or they do not run it at all.",
    ).toEqual([...workspacesGated()].sort());
  });

  it("runs every step a sharded workspace's check names", () => {
    for (const [directory, steps] of Object.entries(RUN_BY_STEP)) {
      const { name, check } = manifestAt(directory);

      expect(gatesNamed(check), `${directory}'s check names a step no leg runs`).toEqual(
        Object.keys(steps),
      );
      for (const [step, script] of Object.entries(steps)) {
        expect(rootScripts()[script]).toEqual(`pnpm --filter ${name} run ${step}`);
        expect(NARROWED["check:workspaces"]).toContain(script);
      }
    }
  });
});

describe("the sharded leg of check.yml", () => {
  it("numbers its shards 1 to N, one per job", () => {
    const strategy = checkJobs()[SHARDED_LEG]?.strategy;
    const shards = strategy?.matrix["shard"] ?? [];

    expect(
      Object.keys(strategy?.matrix ?? {}),
      "a second matrix key multiplies the jobs, so two of them run one shard",
    ).toEqual(["shard"]);
    expect(shards.length).toBeGreaterThan(1);
    expect(shards, "a gap or a repeat leaves some files unrun").toEqual(
      shards.map((_, at) => at + 1),
    );
    expect(stepsOfJob(SHARDED_LEG).flatMap((one) => Object.entries(one.env ?? {}))).toEqual([
      ["SHARD", "${{ matrix.shard }}/${{ strategy.job-total }}"],
    ]);
    expect(
      strategy?.["fail-fast"],
      "a red shard cancels the others, which then report nothing of their own files",
    ).toBe(false);
  });

  it("runs its sharded script alone, and no other leg shards", () => {
    const slicing = Object.keys(checkJobs()).filter((job) =>
      stepsOfJob(job).some((one) => SHARD_ARGUMENT.test((one.run ?? "").trim())),
    );

    expect(slicing).toEqual([SHARDED_LEG]);
    expect(
      gatesOf(SHARDED_LEG),
      "a gate beside the shard runs once per shard, where one run would do",
    ).toEqual([RUN_BY_STEP["packages/core"]?.["test"]]);
  });
});

type VerdictCase = {
  readonly verdict: "passes" | "fails";

  readonly run: string;

  readonly lane: string;

  /** The legs that ended in success; every other leg was skipped. */
  readonly ran: readonly string[];

  readonly title: string;

  readonly wanted: string;

  /** The dependency typecheck's result and what the fan-in wants of it; both `skipped` if absent. */
  readonly typecheck?: { readonly was: string; readonly wanted: string };

  /** Drops the lane's legs from the jobs the verdict reads, as a lane with no leg would. */
  readonly withoutItsLegs?: boolean;

  readonly says?: string;
};

const PROVED_NOTHING = "proved nothing";

/** A matrix leg is one entry in `needs`, its result the shards' together. */
const FULL_LEGS = ["full-root", SHARDED_LEG, "full-api", "full-web", "full-worker"];

const VERDICTS: readonly VerdictCase[] = [
  {
    verdict: "passes",
    run: "a pull request whose title passed",
    lane: "pr",
    ran: [LOCKFILE_JOB],
    title: "success",
    wanted: "success",
  },
  {
    verdict: "fails",
    run: "a pull request whose title failed",
    lane: "pr",
    ran: [LOCKFILE_JOB],
    title: "failure",
    wanted: "success",
  },
  {
    verdict: "fails",
    run: "a pull request that read no lockfile",
    lane: "pr",
    ran: [],
    title: "success",
    wanted: "success",
  },
  {
    verdict: "fails",
    run: "a pull request that ran a suite",
    lane: "pr",
    ran: [LOCKFILE_JOB, "full-api"],
    title: "success",
    wanted: "success",
  },
  {
    verdict: "fails",
    run: "a pr lane that read no title",
    lane: "pr",
    ran: [LOCKFILE_JOB],
    title: "skipped",
    wanted: "skipped",
    says: PROVED_NOTHING,
  },
  {
    verdict: "passes",
    run: "a dependency pull request that typechecked",
    lane: "pr",
    ran: [LOCKFILE_JOB],
    title: "success",
    wanted: "success",
    typecheck: { was: "success", wanted: "success" },
  },
  {
    verdict: "fails",
    run: "a dependency pull request whose typecheck failed",
    lane: "pr",
    ran: [LOCKFILE_JOB],
    title: "success",
    wanted: "success",
    typecheck: { was: "failure", wanted: "success" },
  },
  {
    verdict: "fails",
    run: "a dependency pull request that skipped its typecheck",
    lane: "pr",
    ran: [LOCKFILE_JOB],
    title: "success",
    wanted: "success",
    typecheck: { was: "skipped", wanted: "success" },
  },
  {
    verdict: "fails",
    run: "a merge group that typechecked dependencies",
    lane: "full",
    ran: FULL_LEGS,
    title: "success",
    wanted: "success",
    typecheck: { was: "success", wanted: "skipped" },
  },
  {
    verdict: "passes",
    run: "a docs merge group",
    lane: "docs",
    ran: ["docs-gates"],
    title: "success",
    wanted: "success",
  },
  {
    verdict: "fails",
    run: "a merge group whose title failed",
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
    run: "a full merge group missing a leg",
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

const verdictOn = ({
  lane,
  ran,
  title,
  wanted,
  typecheck = { was: "skipped", wanted: "skipped" },
  withoutItsLegs,
}: VerdictCase): SpawnSyncReturns<string> => {
  const legs = Object.keys(checkJobs())
    .filter((job) => ![FAN_IN, LANE, TITLE_JOB, TYPECHECK_JOB].includes(job))
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
        [TYPECHECK_JOB]: { result: typecheck.was },
      }),
      TITLE_WANTED: wanted,
      TYPECHECK_WANTED: typecheck.wanted,
    },
  });
};

describe("the one verdict check.yml reports", () => {
  it("hangs the required context off every leg, whatever they did", () => {
    const jobs = Object.keys(checkJobs());
    const fanIn = checkJobs()[FAN_IN];

    expect(jobs.at(-1), "the fan-in is not the last job, so a leg was added after it").toEqual(
      FAN_IN,
    );
    expect(fanIn?.needs).toEqual(jobs.filter((job) => job !== FAN_IN));
    expect(
      fanIn?.if,
      "under anything narrower than always() a failed leg leaves the required context skipped, which never reports",
    ).toEqual("${{ always() }}");
  });

  it.each([
    { job: TITLE_JOB, wantedBy: "TITLE_WANTED" },
    { job: TYPECHECK_JOB, wantedBy: "TYPECHECK_WANTED" },
  ])("wants $job's success exactly where it runs", ({ job, wantedBy }) => {
    const runsOn = /^\$\{\{ (?<condition>.+) \}\}$/.exec(checkJobs()[job]?.if ?? "")?.groups?.[
      "condition"
    ];
    const env = stepsOfJob(FAN_IN).flatMap((step) => Object.entries(step.env ?? {}));

    expect(runsOn, `${job} runs on no condition this reading can find`).toBeDefined();
    expect(Object.fromEntries(env)[wantedBy]).toEqual(
      `\${{ (${runsOn ?? ""}) && 'success' || 'skipped' }}`,
    );
  });

  it.each(VERDICTS)("$verdict on $run", (scenario: VerdictCase) => {
    const ran = verdictOn(scenario);

    expect(ran.status === 0 ? "passes" : "fails", `${ran.stdout}${ran.stderr}`).toEqual(
      scenario.verdict,
    );
    expect(ran.stdout).toContain(
      `${TITLE_JOB}: ${scenario.title} (this lane wants ${scenario.wanted})`,
    );
    expect(ran.stdout).toContain(
      `${TYPECHECK_JOB}: ${scenario.typecheck?.was ?? "skipped"} (this lane wants ${scenario.typecheck?.wanted ?? "skipped"})`,
    );
    expect(ran.stdout).toContain(scenario.says ?? "");
  });
});

describe("the pull request's title, read by check.yml", () => {
  const TITLE_COMMAND = "commitlint";
  const PULL_REQUEST = "7";
  const REPOSITORY = "betteranswers/better-answers";
  const CONVENTIONAL = "ci: check the pull request's title with commitlint";
  const FROM_A_PULL_REQUEST = { PULL_REQUEST, QUEUED_REF: "" };

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

  /** The installed commitlint, run in dlx's place so the test never reaches the registry. */
  const offlineDlx = (): string => {
    const asked = COMMITLINT.map((name) => `--package=${name}@${installedVersion(name)}`);
    const installed = path.join(repositoryRoot, "node_modules", ".bin", "commitlint");
    return `#!/bin/sh\n[ "$*" = "dlx ${asked.join(" ")} commitlint" ] || { echo "pnpm was asked: $*" >&2; exit 3; }\nexec '${installed}'\n`;
  };

  /** gh answers the one question the step should ask, and fails any other. */
  const titleStepWith = (
    title: string,
    event: { readonly PULL_REQUEST: string; readonly QUEUED_REF: string },
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

  it("fetches the commitlint the root manifest pins and installs", () => {
    expect(COMMITLINT.map(pinnedVersion)).toEqual(COMMITLINT.map(installedVersion));
  });

  it("passes a Conventional title", () => {
    const run = titleStepWith(CONVENTIONAL, FROM_A_PULL_REQUEST);

    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });

  it("reads the pull request's number off a merge group's ref", () => {
    const run = titleStepWith(CONVENTIONAL, {
      PULL_REQUEST: "",
      QUEUED_REF: `refs/heads/gh-readonly-queue/main/pr-${PULL_REQUEST}-0123456789abcdef`,
    });

    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });

  it("fails an event that names no pull request", () => {
    const run = titleStepWith(CONVENTIONAL, { PULL_REQUEST: "", QUEUED_REF: "refs/heads/main" });

    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain("no pull request number in this event");
  });

  it.each([
    { shape: "a declarative title", title: "The title check runs in CI", named: "[type-empty]" },
    {
      shape: "a title naming its ticket",
      title: "ci: check the pull request's title [T-386]",
      named: "[header-names-no-ticket]",
    },
    {
      shape: "a title over 90 characters",
      title: `ci: check the title${" and check it again".repeat(4)}`,
      named: "[header-max-length]",
    },
  ])("fails $shape, naming the rule", ({ title, named }) => {
    const run = titleStepWith(title, FROM_A_PULL_REQUEST);

    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain(named);
  });
});
