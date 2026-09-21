import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

const LANE_SCRIPT = "scripts/docs-lane.mjs";

const laneOf = (changed: readonly string[], separator = "\n"): string => {
  const run = spawnSync("node", [path.join(repositoryRoot, LANE_SCRIPT)], {
    input: changed.map((changedPath) => `${changedPath}${separator}`).join(""),
    encoding: "utf8",
  });

  expect(run.status, `${LANE_SCRIPT} ended non-zero: ${run.stderr}`).toBe(0);
  return run.stdout.trim();
};

describe("which lane a change runs in (the process review, 21/09/2026)", () => {
  it("takes the docs lane when every changed path is markdown, whatever happened to it", () => {
    expect(laneOf(["docs/adr/0043-what-an-act-is.md"])).toEqual("docs");
    expect(laneOf(["docs/specs/T-121.md", "CONTEXT.md", "apps/web/CODING_RULES.md"])).toEqual(
      "docs",
    );
    expect(laneOf(["docs/specs/old-name.md", "docs/specs/new-name.md"])).toEqual("docs");
  });

  it("takes the full lane the moment anything else is in the change", () => {
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

  it("takes the full lane when it was given no paths at all", () => {
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
    file: "apps/api/tests/coding-rules-tags.test.ts",
    reads: "every tracked text file, so every CODING_RULES.md, CONTEXT.md and docs/**/*.md",
    inTheLane: "check:docs:api",
  },
  {
    file: "apps/api/tests/deploy-tree.test.ts",
    reads: "deploy/RELEASES.md and docs/operations/{RUNBOOK,SECRETS,coolify}.md",
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

const manifest = (): Readonly<Record<string, string>> => {
  const parsed: unknown = JSON.parse(read("package.json"));
  expect(typeof parsed, "the root package.json is not an object").toBe("object");
  return (parsed as { readonly scripts?: Readonly<Record<string, string>> }).scripts ?? {};
};

const stepsOf = (script: string): readonly string[] =>
  (/^node\s+scripts\/check\.mjs\s+(?<steps>.+)$/.exec(script)?.groups?.["steps"] ?? "")
    .split(/\s+/)
    .filter((step) => step.length > 0);

describe("what the docs lane runs (the process review, 21/09/2026)", () => {
  it("runs its steps through the same runner the root check does, so one run names them all", () => {
    const steps = stepsOf(manifest()["check:docs"] ?? "");

    expect(steps.length, "the root check:docs does not call the runner").toBeGreaterThan(1);
    expect(steps).toContain("format:check");
    expect(steps.filter((step) => manifest()[step] === undefined)).toEqual([]);
  });

  it("runs every prose suite this table puts in it, and runs no suite it does not", () => {
    const lane = manifest()["check:docs"] ?? "";
    const commands = stepsOf(lane)
      .map((step) => manifest()[step] ?? "")
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

  it("names, for each suite, a step that exists and a file that exists", () => {
    const absent = PROSE_SUITES.filter(
      (suite) => !existsSync(path.join(repositoryRoot, suite.file)),
    ).map((suite) => suite.file);
    const unrunnable = PROSE_SUITES.flatMap((suite) =>
      typeof suite.inTheLane === "string" && manifest()[suite.inTheLane] === undefined
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

type Step = {
  readonly id?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly run?: string;
};

type Workflow = {
  readonly on: Readonly<Record<string, unknown>>;
  readonly concurrency: { readonly group: string; readonly "cancel-in-progress": string };
  readonly jobs: Readonly<
    Record<
      string,
      {
        readonly if?: string;
        readonly needs?: string | readonly string[];
        readonly permissions?: Readonly<Record<string, string>>;
        readonly steps?: readonly Step[];
      }
    >
  >;
};

const workflow = (name: string): Workflow =>
  parse(read(path.join(".github", "workflows", name))) as Workflow;

const conditionOf = (step: Step): string => step.if ?? "";

const FULL_LANE = "steps.lane.outputs.lane == 'full'";
const DOCS_LANE = "steps.lane.outputs.lane == 'docs'";

describe("the lane inside check.yml (the process review, 21/09/2026)", () => {
  it("reports on the merge queue's own ref, under the job name the ruleset requires", () => {
    const check = workflow("check.yml");

    expect(Object.keys(check.on)).toContain("merge_group");
    expect(Object.keys(check.on)).toContain("pull_request");
    expect(Object.keys(check.jobs)).toEqual(["check"]);
  });

  it("asks one question about cancelling, so a new event is never cancelled by accident", () => {
    const { concurrency } = workflow("check.yml");
    const isAPullRequest = "github.event_name == 'pull_request'";

    expect(concurrency["cancel-in-progress"]).toEqual(`\${{ ${isAPullRequest} }}`);
    expect(concurrency.group).toEqual(
      `check-\${{ ${isAPullRequest} && github.ref || github.sha }}`,
    );
  });

  it("decides the lane before it installs anything, and from the base its event carries", () => {
    const steps = workflow("check.yml").jobs["check"]?.steps ?? [];
    const laneAt = steps.findIndex((step) => step.id === "lane");
    const decided = steps[laneAt]?.run ?? "";

    expect(laneAt).toBeGreaterThan(-1);

    expect(decided).toContain("pull_request) base=");
    expect(decided).toContain("merge_group) base=");
    expect(decided).toContain("push | workflow_call) base=");
    expect(decided).toContain("lane=full");

    expect(decided).toContain("docs | full) ;;");
    expect(decided).toContain(LANE_SCRIPT);

    expect(decided).toContain("git diff -z --name-only --no-renames");

    const gated = steps.flatMap((step, at) => (conditionOf(step) === "" ? [] : [at]));
    expect(Math.min(...gated)).toBeGreaterThan(laneAt);
  });

  it("gives the docs lane its gates and none of the setup no prose gate can use", () => {
    const steps = workflow("check.yml").jobs["check"]?.steps ?? [];
    const named = (fragment: string): Step | undefined =>
      steps.find((step) => (step.uses ?? "").startsWith(fragment) || (step.run ?? "") === fragment);

    for (const setup of [
      "astral-sh/setup-uv@",
      "actions/cache@",
      "./.github/actions/git-filter-repo",
      "docker/setup-buildx-action@",
      "crazy-max/ghaction-github-runtime@",
    ]) {
      expect(conditionOf(named(setup) ?? {}), `${setup} runs in the docs lane too`).toEqual(
        FULL_LANE,
      );
    }
    expect(
      conditionOf(
        named("pnpm --filter @better-answers/web exec playwright install --with-deps chromium") ??
          {},
      ),
    ).toEqual(FULL_LANE);

    expect(conditionOf(named("pnpm check") ?? {})).toEqual(FULL_LANE);
    expect(conditionOf(named("pnpm check:docs") ?? {})).toEqual(DOCS_LANE);
  });

  it("installs the node side for both lanes, because the docs lane runs vitest too", () => {
    const steps = workflow("check.yml").jobs["check"]?.steps ?? [];
    const unconditional = steps
      .filter((step) => conditionOf(step) === "")
      .map((step) => step.uses ?? step.run ?? step.id ?? "");

    expect(unconditional.some((step) => step.startsWith("actions/checkout@"))).toBe(true);
    expect(unconditional.some((step) => step.startsWith("actions/setup-node@"))).toBe(true);
    expect(unconditional).toContain("pnpm install --frozen-lockfile");
  });
});

describe("the check build.yml does not run twice (the process review, 21/09/2026)", () => {
  const build = (): Workflow => workflow("build.yml");
  const GATE = "already-checked";
  const VERDICT = `needs.${GATE}.outputs.verdict`;

  it("asks the runs API for a successful merge-group run of check on this exact commit", () => {
    const gate = build().jobs[GATE];
    const asked = (gate?.steps ?? []).map((step) => step.run ?? "").join("\n");

    expect(asked).toContain("actions/workflows/check.yml/runs");
    expect(asked).toContain("event=merge_group");
    expect(asked).toContain('.conclusion == "success"');
    expect(asked).toContain("head_sha=${COMMIT}");

    expect(asked).not.toContain("${{");

    expect(gate?.permissions).toEqual({ actions: "read" });
  });

  it("skips check only on a `yes`, so a gate that could not answer runs the suite", () => {
    expect(build().jobs["check"]?.if).toEqual(`\${{ !cancelled() && ${VERDICT} != 'yes' }}`);
    expect(build().jobs["check"]?.needs).toEqual(GATE);
  });

  it("pushes an image after a green check, or after the one skip that means already green", () => {
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
