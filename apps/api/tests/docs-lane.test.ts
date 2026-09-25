import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  gatesNamed,
  gatesUnder,
  rootName,
  rootScripts,
  workspacePackages,
  workspacesGated,
  workspacesChecked,
  workspacesWithNoCheck,
} from "./workspaces.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

const LANE_SCRIPT = "scripts/docs-lane.mjs";

type Decision = { readonly lane: string; readonly worker: string };

const decide = (changed: readonly string[], separator = "\n"): Decision => {
  const run = spawnSync("node", [path.join(repositoryRoot, LANE_SCRIPT)], {
    input: changed.map((changedPath) => `${changedPath}${separator}`).join(""),
    encoding: "utf8",
  });

  expect(run.status, `${LANE_SCRIPT} ended non-zero: ${run.stderr}`).toBe(0);
  const answered = (key: string): string =>
    new RegExp(`^${key}=(?<value>.*)$`, "m").exec(run.stdout)?.groups?.["value"] ?? "";

  return { lane: answered("lane"), worker: answered("worker") };
};

const laneOf = (changed: readonly string[], separator = "\n"): string =>
  decide(changed, separator).lane;

type LaneCase = {
  readonly changed: readonly string[];

  readonly lane: string;

  readonly worker: string;

  readonly because: string;
};

/** The paths are what a pull request's diff hands the script; the answer is what the legs read. */
const LANES: readonly LaneCase[] = [
  {
    changed: ["apps/web/src/app.tsx"],
    lane: "affected",
    worker: "no",
    because: "a web-only change: the filter names apps/web, and nothing depends on the SPA",
  },
  {
    changed: ["packages/core/src/kernel/actor.ts"],
    lane: "affected",
    worker: "no",
    because:
      "a core change: apps/api imports it and apps/web imports apps/api, so the filter's `...[` prefix brings both of them with it",
  },
  {
    changed: ["apps/worker/src/better_answers_worker/work_loop.py"],
    lane: "affected",
    worker: "yes",
    because:
      "a worker-only change: no pnpm workspace owns apps/worker, so the filter selects nothing and the worker's own leg is what runs",
  },
  {
    changed: ["package.json"],
    lane: "full",
    worker: "no",
    because:
      "a root file no workspace owns: pnpm reads it as the workspace root's own and would run the root `check`, which is the whole run by another name",
  },
  {
    changed: ["pnpm-lock.yaml"],
    lane: "full",
    worker: "no",
    because: "a lockfile change is every workspace's dependencies, whatever the diff touched",
  },
  {
    changed: ["contracts/manifest.json"],
    lane: "full",
    worker: "yes",
    because:
      "both tiers read the contract and no pnpm workspace owns a line of contracts/, so the TypeScript half — packages/core/test/tier-contract.test.ts — would not run on the filter's answer",
  },
  {
    changed: [".github/workflows/check.yml"],
    lane: "full",
    worker: "no",
    because: "this workflow is held by suites in apps/api and apps/worker that no filter names",
  },
  {
    changed: ["apps/docs-site/index.ts"],
    lane: "full",
    worker: "no",
    because:
      "a directory that only looks like a workspace: pnpm would map it to the workspace root, the exclusion would drop that, and the leg would pass having run nothing",
  },
  {
    changed: ["packages/not-a-workspace/index.ts"],
    lane: "full",
    worker: "no",
    because: "the same hole one level down, and the same answer",
  },
  {
    changed: ["docs/vision.md", "CONTEXT.md"],
    lane: "docs",
    worker: "no",
    because: "every changed path is prose, which is the docs lane's whole rule",
  },
  {
    changed: ["docs/vision.md", "apps/web/src/app.tsx"],
    lane: "full",
    worker: "no",
    because:
      "prose with code: the suites that read this repository's documents live in apps/api and packages/core, and a filter that named apps/web would run every gate except the coupled one",
  },
];

describe("which paths reach which lane", () => {
  it.each(LANES)("$lane: $because", ({ changed, lane, worker }: LaneCase) => {
    expect(decide(changed)).toEqual({ lane, worker });
  });

  it("treats no directory the repository stopped installing as a workspace", () => {
    const known = new Set([...workspacePackages(), "apps/worker"]);
    const firstLevel = ["apps", "packages"].flatMap((parent) =>
      readdirSync(path.join(repositoryRoot, parent), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${parent}/${entry.name}`),
    );
    const orphans = firstLevel.filter(
      (directory) =>
        laneOf([`${directory}/a-changed-file.ts`]) === "affected" && !known.has(directory),
    );

    expect(firstLevel.length).toBeGreaterThan(known.size - 1);
    expect(
      orphans,
      "the lane sends a directory to the affected lane that pnpm's filter cannot answer for, so its change would be read by the root gates alone",
    ).toEqual([]);
  });

  it("reads every installed workspace as one the filter answers for", () => {
    const unresolved = [...workspacePackages(), "apps/worker"].filter(
      (directory) => laneOf([`${directory}/a-changed-file.ts`]) !== "affected",
    );

    expect(
      unresolved,
      "a workspace's own path takes the full lane, so every change inside it pays for the whole tree",
    ).toEqual([]);
  });
});

describe("which lane a change runs in", () => {
  it("takes the docs lane when every changed path is markdown", () => {
    expect(laneOf(["docs/adr/0043-what-an-act-is.md"])).toEqual("docs");
    expect(laneOf(["docs/specs/T-121.md", "CONTEXT.md", "apps/web/CODING_RULES.md"])).toEqual(
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

  it("takes the full lane when given no paths", () => {
    expect(laneOf([])).toEqual("full");
    expect(laneOf([""], "\n")).toEqual("full");
  });

  it("reads the NUL-separated form the workflow actually feeds it", () => {
    expect(laneOf(["docs/a.md", "docs/b.md"], "\0")).toEqual("docs");
    expect(laneOf(["docs/a\nb.md"], "\0")).toEqual("docs");
    expect(laneOf(["docs/a.md", "src/b.ts"], "\0")).toEqual("full");
  });
});

type ProseSuite = {
  readonly file: string;

  readonly reads: string;

  readonly inTheLane: string | { readonly outside: string };
};

const PROSE_SUITES: readonly ProseSuite[] = [
  {
    file: "apps/api/tests/adr-index.test.ts",
    reads: "docs/adr/README.md against every docs/adr/NNNN-*.md",
    inTheLane: "check:docs:api",
  },
  {
    file: "apps/api/tests/coding-rules-form.test.ts",
    reads: "the five CODING_RULES.md files, for the form every rule in them is written in",
    inTheLane: "check:docs:api",
  },
  {
    file: "apps/api/tests/coding-rules-tags.test.ts",
    reads: "every tracked text file, so every CODING_RULES.md, CONTEXT.md and docs/**/*.md",
    inTheLane: "check:docs:api",
  },
  {
    file: "apps/api/tests/avoid-words.test.ts",
    reads: "CONTEXT.md's _Avoid_ lines, then every tracked text file outside its carve-outs",
    inTheLane: "check:docs:api",
  },
  {
    file: "apps/api/tests/deploy-tree.test.ts",
    reads:
      "the deploy tree, .github/workflows/*.yml and deploy/RELEASES.md and docs/operations/{RUNBOOK,SECRETS,coolify}.md",
    inTheLane: "check:docs:api",
  },
  {
    file: "apps/api/tests/provision-skills.test.ts",
    reads: "the tracked SKILL.md files, packages/design-system/SKILL.md through its symlink",
    inTheLane: "check:docs:api",
  },
  {
    file: "apps/api/tests/docs-lane.test.ts",
    reads: "no markdown — it holds this table against the script the lane runs",
    inTheLane: "check:docs:api",
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

const step = z.object({
  id: z.string().optional(),
  if: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});
type Step = z.infer<typeof step>;

const workflowFile = z.object({
  on: z.record(z.string(), z.unknown()),
  concurrency: z.object({
    group: z.string(),
    "cancel-in-progress": z.union([z.string(), z.boolean()]),
  }),
  jobs: z.record(
    z.string(),
    z.object({
      if: z.string().optional(),
      needs: z.union([z.string(), z.array(z.string())]).optional(),
      permissions: z.record(z.string(), z.string()).optional(),
      outputs: z.record(z.string(), z.string()).optional(),
      steps: z.array(step).optional(),
    }),
  ),
});
type Workflow = z.infer<typeof workflowFile>;
type Job = Workflow["jobs"][string];

const workflow = (name: string): Workflow =>
  workflowFile.parse(parse(read(path.join(".github", "workflows", name))));

const conditionOf = (step: Step): string => step.if ?? "";

const LANE = "lane";

/** The branch ruleset's required context, and the job build.yml's `image` waits on. */
const FAN_IN = "check";

/** No lane's leg: a pull request's title is read whichever lane its paths chose. */
const TITLE_JOB = "pr-title";

const checkJobs = (): Readonly<Record<string, Job>> => workflow("check.yml").jobs;

/** The fan-in reads the prefix to decide what it requires, so it is load-bearing, not tidiness. */
const legsOf = (lane: string): readonly string[] =>
  Object.keys(checkJobs()).filter((job) => job.startsWith(`${lane}-`));

const stepsOfJob = (job: string): readonly Step[] => checkJobs()[job]?.steps ?? [];

const toolOf = (step: Step): string => step.uses ?? step.run ?? "";

const gatesOf = (job: string): readonly string[] =>
  stepsOfJob(job).flatMap((step) => gatesUnder(step.run ?? ""));

/** One step cannot run on four legs, so the legs run these narrowings and this folds them back. */
const NARROWED: Readonly<Record<string, readonly string[]>> = {
  "check:workspaces": ["check:libraries", "check:api", "check:web"],
};

/**
 * The affected lane narrows the same step by asking rather than by naming: one script, whose
 * workspaces are the filter's answer.
 */
const BY_THE_FILTER: Readonly<Record<string, string>> = { "check:affected": "check:workspaces" };

const wholeGateOf = (gate: string): string =>
  BY_THE_FILTER[gate] ??
  Object.entries(NARROWED).find(([, parts]) => parts.includes(gate))?.[0] ??
  gate;

/** The lanes that run the root check's gates. The docs lane runs the prose suites, held above. */
const CODE_LANES = ["full", "affected"] as const;

describe("the lane inside check.yml", () => {
  it("reports on merge groups under the job the ruleset requires", () => {
    const check = workflow("check.yml");

    expect(Object.keys(check.on)).toContain("merge_group");
    expect(Object.keys(check.on)).toContain("pull_request");
    expect(Object.keys(check.jobs)).toContain(FAN_IN);
  });

  it("cancels a superseded run only on a pull request", () => {
    const { concurrency } = workflow("check.yml");
    const isAPullRequest = "github.event_name == 'pull_request'";

    expect(concurrency["cancel-in-progress"]).toEqual(`\${{ ${isAPullRequest} }}`);
    expect(concurrency.group).toEqual(
      `check-\${{ ${isAPullRequest} && github.ref || github.sha }}`,
    );
  });

  it("decides the lane once, in a job installing nothing", () => {
    const decider = checkJobs()[LANE];
    const steps = decider?.steps ?? [];
    const decided = steps.find((step) => step.id === LANE)?.run ?? "";

    expect(decider?.outputs).toEqual({
      lane: `\${{ steps.${LANE}.outputs.lane }}`,
      base: `\${{ steps.${LANE}.outputs.base }}`,
      worker: `\${{ steps.${LANE}.outputs.worker }}`,
    });
    expect(steps.map(toolOf).filter((tool) => tool.startsWith("actions/checkout@"))).toHaveLength(
      1,
    );
    expect(
      steps.map(toolOf).filter((tool) => tool.includes("setup") || tool.includes("install")),
      "the lane job installs a toolchain every leg then installs again",
    ).toEqual([]);

    expect(decided).toContain("pull_request) base=");
    expect(decided).toContain("merge_group) base=");
    expect(decided).toContain("push | workflow_call) base=");
    expect(decided).toContain("lane=full");

    expect(decided).toContain("docs | affected | full) ;;");
    expect(decided).toContain("yes | no) ;;");

    expect(
      decided,
      "the affected lane is a pull request's alone: merge-time checks are the whole",
    ).toContain('[ "${EVENT}" != "pull_request" ]');

    expect(decided).toContain(LANE_SCRIPT);

    expect(decided).toContain("git diff -z --name-only --no-renames");
  });

  it("runs every leg on the lane its name starts with", () => {
    const legs = Object.entries(checkJobs()).filter(
      ([job]) => job !== LANE && job !== FAN_IN && job !== TITLE_JOB,
    );

    expect(legs.map(([job]) => job)).toEqual([
      ...legsOf("docs"),
      ...legsOf("full"),
      ...legsOf("affected"),
    ]);
    for (const [job, leg] of legs) {
      const lane = job.slice(0, job.indexOf("-"));

      expect(
        leg.if,
        `${job} runs on a condition its name does not say, so the fan-in requires the wrong thing of it`,
      ).toEqual(`\${{ needs.${LANE}.outputs.lane == '${lane}' }}`);
      expect(leg.needs).toEqual(LANE);
    }
  });

  it("gives the docs lane one job with no unused setup", () => {
    const tools = legsOf("docs").flatMap((job) => stepsOfJob(job).map(toolOf));

    expect(legsOf("docs")).toHaveLength(1);
    for (const setup of [
      "astral-sh/setup-uv@",
      "actions/cache@",
      "./.github/actions/git-filter-repo",
      "docker/setup-buildx-action@",
      "crazy-max/ghaction-github-runtime@",
      "playwright install",
    ]) {
      expect(
        tools.filter((tool) => tool.includes(setup)),
        `${setup} runs in the docs lane too`,
      ).toEqual([]);
    }
    expect(tools).toContain("pnpm check:docs");
  });
});

type Setup = {
  readonly tool: string;

  readonly onlyOn: readonly string[];

  readonly because: string;
};

const SETUP: readonly Setup[] = [
  {
    tool: "pnpm install --frozen-lockfile",
    onlyOn: [
      "docs-gates",
      "full-root",
      "full-api",
      "full-web",
      "affected-gates",
      "affected-workspaces",
      TITLE_JOB,
    ],
    because:
      "every leg that runs a pnpm workspace's own gates needs the tree installed, as does the title's commitlint; the worker's gates are uv's and its legs only spawn the runner",
  },
  {
    tool: "astral-sh/setup-uv@",
    onlyOn: ["full-root", "full-api", "full-worker", "affected-workspaces", "affected-worker"],
    because:
      "the worker's gates are uv's, packages/devtools runs ruff and mypy out of the same environment, and the api's hook suite asks the binary itself whether it is there",
  },
  {
    tool: "uv sync --frozen",
    onlyOn: ["full-root", "full-api", "full-worker", "affected-workspaces", "affected-worker"],
    because:
      "the binary alone runs nothing: a leg that spawns the worker, whether for its own gates or from a suite in the other tier, needs the environment the lockfile names",
  },
  {
    tool: "actions/cache@",
    onlyOn: ["full-root", "full-api", "full-worker", "affected-workspaces", "affected-worker"],
    because:
      "the only cache with a key here is the redaction detector's weights, and every leg that spawns the worker over an index job loads them",
  },
  {
    tool: "./.github/actions/git-filter-repo",
    onlyOn: ["full-root", "full-api", "affected-workspaces"],
    because:
      "each leg reaches the erasure routine's git step — packages/core through the erasure suite, apps/api through the rehearsal's phase two, the filter through whichever of them it selects — and the hosted Ubuntu runner carries no such tool",
  },
  {
    tool: "playwright install",
    onlyOn: ["full-web", "affected-workspaces"],
    because:
      "the browser suite over the served build is the SPA's last gate, and the filter cannot say whether the SPA is in its answer until it has been asked",
  },
  {
    tool: "docker/setup-buildx-action@",
    onlyOn: ["full-api", "full-worker", "affected-workspaces", "affected-worker"],
    because:
      "the daemon's own driver cannot import a type=gha cache, so a leg that builds an image without this builder is green and cold",
  },
  {
    tool: "crazy-max/ghaction-github-runtime@",
    onlyOn: ["full-api", "full-worker", "affected-workspaces", "affected-worker"],
    because:
      "a runner hands the ACTIONS_* variables to an action and to no run: step, so the builds those legs run from inside a suite cannot reach the cache without it",
  },
];

describe("what each leg of check.yml installs", () => {
  it("installs each tool on exactly the legs that run it", () => {
    for (const { tool, onlyOn, because } of SETUP) {
      const where = Object.keys(checkJobs()).filter((job) =>
        stepsOfJob(job).some((step) => toolOf(step).includes(tool)),
      );

      expect(where, `${tool}: ${because}`).toEqual([...onlyOn]);
    }
  });

  it("matches the two worker legs' steps, gating the affected leg's", () => {
    const WORKERS = "worker == 'yes'";
    const full = stepsOfJob("full-worker").map(toolOf);
    const affected = stepsOfJob("affected-worker");

    expect(
      full.filter((tool) => !affected.map(toolOf).includes(tool)),
      "a step the full lane's worker leg runs is missing from the affected lane's, so the two tiers' runs read different trees",
    ).toEqual([]);
    expect(
      affected
        .filter((step) => full.includes(toolOf(step)))
        .filter((step) => !conditionOf(step).includes(WORKERS)),
      "a step on the affected lane's worker leg runs whether or not the change reached the worker",
    ).toEqual([]);
  });

  it("names only existing legs for every tool", () => {
    const legs = Object.keys(checkJobs());

    expect(SETUP.flatMap((setup) => setup.onlyOn).filter((job) => !legs.includes(job))).toEqual([]);
    expect(SETUP.length, "a row left this table without the leg that stopped needing it").toBe(8);
  });
});

describe.each(CODE_LANES)("the %s lane's legs against the one list of gates", (lane: string) => {
  it("runs exactly the root check's gates across its legs", () => {
    const ran: string[] = [];
    for (const gate of legsOf(lane).flatMap(gatesOf)) {
      const whole = wholeGateOf(gate);
      if (!ran.includes(whole)) ran.push(whole);
    }

    expect(
      ran,
      "the legs and the root check have stopped naming the same gates. Add the gate to a leg, or narrow it in NARROWED.",
    ).toEqual(gatesNamed(rootScripts()["check"] ?? ""));
  });

  it("runs each gate on one leg only", () => {
    const ran = legsOf(lane).flatMap(gatesOf);

    expect(ran.filter((gate, at) => ran.indexOf(gate) !== at)).toEqual([]);
    expect(ran.filter((gate) => rootScripts()[gate] === undefined)).toEqual([]);
  });
});

describe("how the legs narrow check:workspaces", () => {
  const ran = (): readonly string[] => CODE_LANES.flatMap((lane) => legsOf(lane).flatMap(gatesOf));

  it("narrows a step only into root scripts the legs run", () => {
    const narrowings = [
      ...Object.entries(NARROWED),
      ...Object.entries(BY_THE_FILTER).map(([part, whole]) => [whole, [part]] as const),
    ];

    for (const [whole, parts] of narrowings) {
      expect(rootScripts()[whole], `${whole} is not a root script`).toBeDefined();
      expect(parts.filter((part) => rootScripts()[part] === undefined)).toEqual([]);
      expect(
        parts.filter((part) => !ran().includes(part)),
        `${whole} is narrowed past the legs`,
      ).toEqual([]);
    }
  });

  it("selects, between the narrowings of check:workspaces, every workspace it gates", () => {
    const selected = Object.values(NARROWED)
      .flat()
      .flatMap((part) => workspacesChecked(rootScripts()[part] ?? ""));

    expect(
      [...selected].sort(),
      "a workspace with a check script is on no leg, or is on two. The legs run check:workspaces between them or they do not run it at all.",
    ).toEqual([...workspacesGated()].sort());
  });

  it("asks the filter for touched workspaces and their dependents", () => {
    const filtered = rootScripts()["check:affected"] ?? "";

    expect(
      filtered,
      "the affected lane's script no longer asks pnpm which workspaces changed since the base",
    ).toContain('--filter "...[${BASE}]"');
    expect(filtered).toContain("--no-bail");
    expect(filtered).toContain("--if-present");
    expect(
      filtered,
      "pnpm maps a root file to the workspace root's own project, whose check is the whole run",
    ).toContain("--filter '!better-answers'");
    expect(rootName(), "the workspace root was renamed and the exclusion above was not").toEqual(
      "better-answers",
    );
  });

  it("guards the same selection, minus workspaces that run no gate", () => {
    const selectors = (script: string): readonly string[] =>
      [...(rootScripts()[script] ?? "").matchAll(/--filter\s+(?<selector>"[^"]*"|'[^']*')/g)].map(
        (found) => found.groups?.["selector"] ?? "",
      );

    expect(
      selectors("check:affected:scope"),
      "the guard counts a workspace with no check script, so a selection of only those would pass it having run nothing — or it reads a different selection from the run it guards",
    ).toEqual([
      ...selectors("check:affected"),
      ...workspacesWithNoCheck().map((name) => `'!${name}'`),
    ]);
    expect(selectors("check:affected")).toHaveLength(2);
    expect(workspacesWithNoCheck().length).toBeGreaterThan(0);
  });

  it("brings a workspace's dependents with it through the `...` prefix", () => {
    const listed = spawnSync(
      "pnpm",
      ["--filter", "...@better-answers/core", "list", "--depth", "-1", "--parseable"],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    const selected = listed.stdout
      .split("\n")
      .filter((line) => line.startsWith(repositoryRoot) && line !== repositoryRoot)
      .map((line) => path.relative(repositoryRoot, line))
      .sort();

    expect(listed.status, `pnpm ended non-zero: ${listed.stderr}`).toBe(0);
    expect(
      selected,
      "a change to packages/core no longer pays for the workspaces that import it",
    ).toEqual(["apps/api", "apps/web", "packages/core"]);
  });
});

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

  it("wants success from this lane's legs and skips from others", () => {
    const steps = stepsOfJob(FAN_IN);
    const verdict = steps.map((step) => step.run ?? "").join("\n");
    const read = steps.flatMap((step) => Object.values(step.env ?? {}));

    expect(read).toContain(`\${{ needs.${LANE}.outputs.lane }}`);
    expect(read).toContain("${{ toJSON(needs) }}");

    expect(verdict).toContain(`${LANE}) wanted=success ;;`);
    expect(verdict).toContain('"${LANE}-"*) wanted=success; required=$((required + 1)) ;;');
    expect(verdict).toContain("*) wanted=skipped ;;");
    expect(
      verdict,
      "the verdict can require nothing of anybody and still pass, which is a green check that read no leg",
    ).toContain('[ "${required}" -lt 1 ]');
    expect(verdict).toContain("exit 1");

    expect(
      verdict,
      "the verdict splices a context into the shell rather than reading it from the environment",
    ).not.toContain("${{");
  });

  it("wants the title job's success exactly where it runs", () => {
    const runsOn = /^\$\{\{ (?<condition>.+) \}\}$/.exec(checkJobs()[TITLE_JOB]?.if ?? "")
      ?.groups?.["condition"];
    const env = stepsOfJob(FAN_IN).flatMap((step) => Object.entries(step.env ?? {}));

    expect(runsOn, "the title job runs on no condition this reading can find").toBeDefined();
    expect(Object.fromEntries(env)["TITLE_WANTED"]).toEqual(
      `\${{ (${runsOn ?? ""}) && 'success' || 'skipped' }}`,
    );
  });

  it.each([
    { verdict: "passes", event: "a pull request", wanted: "success", title: "success" },
    { verdict: "fails", event: "a merge group", wanted: "success", title: "failure" },
    { verdict: "passes", event: "a push", wanted: "skipped", title: "skipped" },
  ])("$verdict on $event whose title job ended $title", ({ verdict, wanted, title }) => {
    const legs = Object.fromEntries(
      Object.keys(checkJobs())
        .filter((job) => job !== FAN_IN)
        .map((job) => [job, { result: job.startsWith("docs-") ? "success" : "skipped" }]),
    );
    const ran = spawnSync("bash", ["-e", "-c", stepsOfJob(FAN_IN)[0]?.run ?? "exit 9"], {
      encoding: "utf8",
      env: {
        ...process.env,
        LANE: "docs",
        LEGS: JSON.stringify({
          ...legs,
          [LANE]: { result: "success" },
          [TITLE_JOB]: { result: title },
        }),
        TITLE_WANTED: wanted,
      },
    });

    expect(ran.status === 0 ? "passes" : "fails", `${ran.stdout}${ran.stderr}`).toEqual(verdict);
    expect(ran.stdout).toContain(`${TITLE_JOB}: ${title} (this lane wants ${wanted})`);
  });
});

describe("the pull request's title, read by check.yml", () => {
  const TITLE_COMMAND = "pnpm exec commitlint";
  const PULL_REQUEST = "7";
  const REPOSITORY = "betteranswers/better-answers";
  const CONVENTIONAL = "ci: check the pull request's title with commitlint";
  const FROM_A_PULL_REQUEST = { PULL_REQUEST, QUEUED_REF: "" };

  const titleStep = (): Step | undefined =>
    stepsOfJob(TITLE_JOB).find((one) => (one.run ?? "").includes(TITLE_COMMAND));

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

  it("reads every event field from the environment, never spliced", () => {
    expect(titleStep()?.run ?? "").toContain(TITLE_COMMAND);
    expect(titleStep()?.run ?? "").not.toContain("${{");
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
      shape: "a title over 72 characters",
      title: `ci: check the title${" and check it again".repeat(3)}`,
      named: "[header-max-length]",
    },
  ])("fails $shape, naming the rule", ({ title, named }) => {
    const run = titleStepWith(title, FROM_A_PULL_REQUEST);

    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain(named);
  });
});

describe("the check build.yml does not run twice", () => {
  const build = (): Workflow => workflow("build.yml");
  const GATE = "already-checked";
  const VERDICT = `needs.${GATE}.outputs.verdict`;

  it("asks the runs API for this commit's green merge-group check", () => {
    const gate = build().jobs[GATE];
    const asked = (gate?.steps ?? []).map((step) => step.run ?? "").join("\n");

    expect(asked).toContain("actions/workflows/check.yml/runs");
    expect(asked).toContain("event=merge_group");
    expect(asked).toContain('.conclusion == "success"');
    expect(asked).toContain("head_sha=${COMMIT}");

    expect(asked).not.toContain("${{");

    expect(gate?.permissions).toEqual({ actions: "read" });
  });

  it("skips check only on a `yes` from the gate", () => {
    expect(build().jobs["check"]?.if).toEqual(`\${{ !cancelled() && ${VERDICT} != 'yes' }}`);
    expect(build().jobs["check"]?.needs).toEqual(GATE);
  });

  it("pushes an image after a green or already-green check", () => {
    const condition = (build().jobs["image"]?.if ?? "").replace(/\s+/g, " ");

    expect(condition).toEqual(
      "${{ !cancelled() " +
        "&& (needs.check.result == 'success' " +
        "|| (needs.check.result == 'skipped' " +
        `&& needs.${GATE}.result == 'success' ` +
        `&& ${VERDICT} == 'yes')) }}`,
    );
    expect(build().jobs["image"]?.needs).toEqual([GATE, "check"]);
  });

  it("builds an image for every commit, docs-only ones included", () => {
    const image = build().jobs["image"];

    expect((image?.steps ?? []).filter((step) => conditionOf(step).includes("lane"))).toEqual([]);
    expect(image?.if ?? "").not.toContain("lane");
  });
});
