import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { mutateSet, mutationShardsFromArgv } from "@better-answers/devtools/mutation-shards";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import coreStrykerConfig from "../../../packages/core/stryker.config.mjs";
import { legs } from "../../../scripts/mutation-shards.mjs";
import apiStrykerConfig from "../stryker.config.mjs";
import { type ImageStep, readWorkflow, repositoryRoot, workflowStepSchema } from "./image-probe.ts";

const shardSchema = z.object({
  name: z.string(),
  path: z.string(),
  shard: z.number(),
  of: z.number(),
});

const mutationWorkflowSchema = z.object({
  on: z.object({
    workflow_dispatch: z.object({
      inputs: z.record(z.string(), z.object({ description: z.string(), type: z.string() })),
    }),
  }),
  concurrency: z.object({ group: z.string(), "cancel-in-progress": z.boolean() }).optional(),
  permissions: z.record(z.string(), z.string()),
  jobs: z.object({
    stryker: z.object({
      "timeout-minutes": z.union([z.number(), z.string()]),
      env: z.record(z.string(), z.string()).optional(),
      permissions: z.record(z.string(), z.string()).optional(),
      strategy: z.object({
        "max-parallel": z.number(),
        matrix: z.object({ include: z.array(shardSchema) }),
      }),
      steps: z.array(workflowStepSchema),
    }),
    summary: z.object({
      needs: z.string(),
      if: z.string(),
      permissions: z.record(z.string(), z.string()).optional(),
      strategy: z.object({
        matrix: z.object({ include: z.array(z.object({ name: z.string(), of: z.number() })) }),
      }),
      steps: z.array(workflowStepSchema),
    }),
  }),
});

const mutationWorkflow = () => readWorkflow("mutation.yml", mutationWorkflowSchema);

const BASELINE_ACTION = "./.github/actions/mutation-baseline";

const baselineActionSchema = z.object({
  runs: z.object({ using: z.literal("composite"), steps: z.array(workflowStepSchema) }),
});

const NEWEST_CHECKPOINT_VARIABLE = "NEWEST_CHECKPOINT";

const restoreStep = (): ImageStep => {
  const action = baselineActionSchema.parse(
    parse(readFileSync(path.join(repositoryRoot, BASELINE_ACTION, "action.yml"), "utf8")),
  );
  const found = action.runs.steps.find(
    (step) => step.env?.[NEWEST_CHECKPOINT_VARIABLE] !== undefined,
  );
  if (found === undefined) {
    throw new Error(`${BASELINE_ACTION} has no step carrying \`${NEWEST_CHECKPOINT_VARIABLE}\``);
  }
  return found;
};

const stepsUsing = (steps: readonly ImageStep[], action: string): readonly ImageStep[] =>
  steps.filter((step) => (step.uses ?? "").startsWith(action));

const onlyStep = (steps: readonly ImageStep[], action: string, job: string): ImageStep => {
  const [only, ...more] = stepsUsing(steps, action);
  if (only === undefined || more.length > 0) {
    throw new Error(`mutation.yml's ${job} job must use ${action} once`);
  }
  return only;
};

const stepRunning = (steps: readonly ImageStep[], text: string, job: string): ImageStep => {
  const found = steps.find((step) => step.run?.includes(text));
  if (found === undefined) throw new Error(`mutation.yml's ${job} job never runs \`${text}\``);
  return found;
};

const REPOSITORY = "betteranswers/better-answers";
const ARTIFACT = "stryker-incremental-core";
const REPOSITORY_ID = 1_046_872_215;
const FORK_ID = 1_071_530_904;

type Uploaded = {
  readonly run: number;
  readonly createdAt: string;
  readonly branch: string;
  readonly expired?: boolean;
  readonly fromAFork?: boolean;
};

const artifact = ({ run, createdAt, branch, expired = false, fromAFork = false }: Uploaded) => ({
  name: ARTIFACT,
  expired,
  created_at: createdAt,
  workflow_run: {
    id: run,
    repository_id: REPOSITORY_ID,
    head_repository_id: fromAFork ? FORK_ID : REPOSITORY_ID,
    head_branch: branch,
  },
});

const page = (...uploads: readonly Uploaded[]) => ({
  total_count: uploads.length,
  artifacts: uploads.map(artifact),
});

const NIGHT_BEFORE_LAST = {
  run: 35_833_649_657,
  createdAt: "2026-09-23T09:48:40Z",
  branch: "main",
};
const LAST_NIGHT = { run: 35_970_714_712, createdAt: "2026-09-24T09:38:41Z", branch: "main" };
const EXPIRED_ON_MAIN = {
  run: 34_323_778_136,
  createdAt: "2026-09-09T07:31:08Z",
  branch: "main",
  expired: true,
};
const A_FORK_CALLING_ITS_BRANCH_MAIN = {
  run: 35_990_231_067,
  createdAt: "2026-09-24T11:02:15Z",
  branch: "main",
  fromAFork: true,
};
const ANOTHER_BRANCH = { run: 35_991_007_520, createdAt: "2026-09-24T12:40:03Z", branch: "t-400" };
const THIS_BRANCH = { run: 35_990_560_931, createdAt: "2026-09-24T11:30:52Z", branch: "t-229" };
const THIS_RUN = 36_060_418_207;
const THIS_RUN_BEGAN = "2026-09-24T13:00:00Z";
const AFTER_THIS_RUN_BEGAN = {
  run: 36_060_512_880,
  createdAt: "2026-09-24T13:31:09Z",
  branch: "main",
};

type Restored = {
  readonly status: number | null;
  readonly asked: readonly string[];
  readonly log: string;
  readonly reports: string;
  readonly checkpoint: string | undefined;
  readonly baseline: string | undefined;
};

const contentsOf = (file: string): string | undefined =>
  existsSync(file) ? readFileSync(file, "utf8") : undefined;

const REFUSED = Symbol("the artifacts API refuses the token");

// Answers the runs API as asked, lists `pages.json` as the artifacts API, and downloads a run's
// checkpoint as one naming that run.
const fakeGh = (
  file: (name: string) => string,
  answer: unknown,
  runs: "answers" | "refuses",
): string =>
  [
    "#!/bin/sh",
    `printf '%s\\n' "$*" >> '${file("asked")}'`,
    'case "$1 $2" in',
    runs === "answers"
      ? `  "api repos/${REPOSITORY}/actions/runs/${String(THIS_RUN)}") echo '${THIS_RUN_BEGAN}' ;;`
      : `  "api repos/${REPOSITORY}/actions/runs/${String(THIS_RUN)}") echo 'HTTP 403' >&2; exit 1 ;;`,
    answer === REFUSED
      ? "  api*) echo 'HTTP 403: Resource not accessible by integration' >&2; exit 1 ;;"
      : `  api*) cat '${file("pages.json")}' ;;`,
    '  run*) run="$3"',
    '    while [ "$#" -gt 0 ]; do [ "$1" = "--dir" ] && dir="$2"; shift; done',
    '    mkdir -p "$dir"',
    `    printf '{"uploadedBy":%s}' "$run" > "$dir/stryker-incremental.json" ;;`,
    "esac",
    "",
  ].join("\n");

const restoreAgainst = (
  answer: unknown,
  branch = "main",
  runs: "answers" | "refuses" = "answers",
): Restored => {
  const step = restoreStep();
  const directory = mkdtempSync(path.join(tmpdir(), "mutation-restore-"));
  const file = (name: string) => path.join(directory, name);
  const reports = file("packages/core/reports/mutation");
  try {
    writeFileSync(file("pages.json"), answer === REFUSED ? "" : JSON.stringify(answer));
    writeFileSync(file("asked"), "");
    writeFileSync(file("gh"), fakeGh(file, answer, runs), { mode: 0o755 });
    const ran = spawnSync("bash", ["--noprofile", "--norc", "-e", "-c", step.run ?? ""], {
      encoding: "utf8",
      env: {
        PATH: `${directory}${path.delimiter}${process.env["PATH"] ?? ""}`,
        REPOSITORY,
        BRANCH: branch,
        RUN: String(THIS_RUN),
        ARTIFACT,
        REPORTS: reports,
        [NEWEST_CHECKPOINT_VARIABLE]: step.env?.[NEWEST_CHECKPOINT_VARIABLE] ?? "",
      },
    });
    expect(ran.error, "bash did not start").toBeUndefined();
    return {
      status: ran.status,
      asked: readFileSync(file("asked"), "utf8").trim().split("\n").filter(Boolean),
      log: ran.stdout + ran.stderr,
      reports,
      checkpoint: contentsOf(path.join(reports, "stryker-incremental.json")),
      baseline: contentsOf(path.join(reports, "baseline.json")),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const BEGAN = `api repos/${REPOSITORY}/actions/runs/${String(THIS_RUN)} --jq .created_at`;

const LISTED = `api --paginate --slurp repos/${REPOSITORY}/actions/artifacts?name=${ARTIFACT}&per_page=100`;

const downloaded = (run: number, reports: string) =>
  `run download ${String(run)} --repo ${REPOSITORY} --name ${ARTIFACT} --dir ${reports}`;

const CONFIGS = new Map([
  ["apps/api", apiStrykerConfig],
  ["packages/core", coreStrykerConfig],
]);

const configSchema = z.object({
  mutate: z.array(z.string()),
  incremental: z.boolean(),
  incrementalFile: z.string(),
});

describe("the nightly mutation baseline, kept as the previous run's artifact", () => {
  it("restores main's newest checkpoint for this leg, and the baseline", () => {
    const restored = restoreAgainst([
      page(EXPIRED_ON_MAIN, A_FORK_CALLING_ITS_BRANCH_MAIN, ANOTHER_BRANCH),
      page(NIGHT_BEFORE_LAST, LAST_NIGHT),
    ]);

    expect(restored.status, `the step went red: ${restored.log}`).toBe(0);
    expect(restored.asked).toEqual([BEGAN, LISTED, downloaded(35_970_714_712, restored.reports)]);
    expect(restored.checkpoint).toEqual('{"uploadedBy":35970714712}');
    expect(restored.baseline).toEqual('{"uploadedBy":35970714712}');
    expect(restored.log).toContain("from run 35970714712");
  });

  it.each([
    { left: "no checkpoint at all", pages: [page()] },
    {
      left: "only an expired upload, a fork's pull request's and another branch's",
      pages: [page(EXPIRED_ON_MAIN, A_FORK_CALLING_ITS_BRANCH_MAIN, ANOTHER_BRANCH)],
    },
  ])("tests every mutant, staying green, when earlier runs left $left", ({ pages }) => {
    const restored = restoreAgainst(pages);

    expect(restored.status, `the step went red: ${restored.log}`).toBe(0);
    expect(restored.asked).toEqual([BEGAN, LISTED]);
    expect(restored.checkpoint).toBeUndefined();
    expect(restored.baseline).toBeUndefined();
    expect(restored.log).toContain("tests every mutant");
  });

  it("starts a branch run from whichever checkpoint is newer", () => {
    const ownIsNewer = restoreAgainst([page(ANOTHER_BRANCH, THIS_BRANCH, LAST_NIGHT)], "t-229");
    const mainIsNewer = restoreAgainst(
      [page({ ...THIS_BRANCH, createdAt: "2026-09-24T09:12:08Z" }, LAST_NIGHT)],
      "t-229",
    );

    expect(ownIsNewer.asked).toEqual([
      BEGAN,
      LISTED,
      downloaded(35_990_560_931, ownIsNewer.reports),
    ]);
    expect(mainIsNewer.asked).toEqual([
      BEGAN,
      LISTED,
      downloaded(35_970_714_712, mainIsNewer.reports),
    ]);
  });

  it("takes nothing uploaded after this run began", () => {
    const restored = restoreAgainst([page(LAST_NIGHT, AFTER_THIS_RUN_BEGAN)]);

    expect(restored.status, `the step went red: ${restored.log}`).toBe(0);
    expect(restored.asked).toEqual([BEGAN, LISTED, downloaded(35_970_714_712, restored.reports)]);
  });

  it("goes red when the runs API hides this run's start", () => {
    const restored = restoreAgainst([page(LAST_NIGHT)], "main", "refuses");

    expect(restored.status).toBe(1);
    expect(restored.asked).toEqual([BEGAN]);
    expect(restored.checkpoint).toBeUndefined();
    expect(restored.log).toContain(`would not say when run ${String(THIS_RUN)} began`);
  });

  it.each([
    { when: "will not list it", answer: REFUSED, says: `would not list ${ARTIFACT}` },
    {
      when: "answers with something other than a list of artifacts",
      answer: { message: "Not Found", status: "404" },
      says: `something other than a list of ${ARTIFACT}`,
    },
  ])("goes red, naming the artifact, when the artifacts API $when", ({ answer, says }) => {
    const restored = restoreAgainst(answer);

    expect(restored.status).toBe(1);
    expect(restored.asked).toEqual([BEGAN, LISTED]);
    expect(restored.checkpoint).toBeUndefined();
    expect(restored.log).toContain(says);
  });

  it("reads each leg's checkpoint from the artifact its upload names", () => {
    const { stryker, summary } = mutationWorkflow().jobs;
    const restore = restoreStep();
    const shardRestore = onlyStep(stryker.steps, BASELINE_ACTION, "stryker");
    const summaryRestore = onlyStep(summary.steps, BASELINE_ACTION, "summary");

    expect(restore.env?.["ARTIFACT"]).toEqual("stryker-incremental-${{ inputs.leg }}");
    expect(restore.env?.["REPORTS"]).toEqual("${{ inputs.reports }}");
    expect(restore.env?.["BRANCH"]).toEqual("${{ github.ref_name }}");
    expect(shardRestore.with?.["leg"]).toEqual("${{ matrix.name }}");
    expect(summaryRestore.with?.["leg"]).toEqual("${{ matrix.name }}");
    expect(onlyStep(summary.steps, "actions/upload-artifact@", "summary").with?.["name"]).toEqual(
      "stryker-incremental-${{ matrix.name }}",
    );
  });

  it("hands each shard the leg's results, and gathers its own", () => {
    const { stryker } = mutationWorkflow().jobs;
    const gather = stepRunning(stryker.steps, "stryker-incremental.json", "stryker");
    const upload = onlyStep(stryker.steps, "actions/upload-artifact@", "stryker");

    expect(onlyStep(stryker.steps, BASELINE_ACTION, "stryker").with?.["reports"]).toEqual(
      "${{ matrix.path }}/reports/mutation",
    );
    expect(gather.if).toEqual("always() && env.SELECTED == 'true'");
    expect(gather.env?.["REPORTS"]).toEqual("${{ matrix.path }}/reports/mutation");
    expect(upload.if).toEqual("always() && env.SELECTED == 'true'");
    expect(upload.with?.["overwrite"]).toBe(true);
    expect(
      [...new Set(stryker.strategy.matrix.include.map((shard) => shard.path))].toSorted(),
    ).toEqual([...CONFIGS.keys()]);
    for (const [leg, config] of CONFIGS) {
      const read = configSchema.parse(config);

      expect(
        { incremental: read.incremental, incrementalFile: read.incrementalFile },
        `${leg} writes its checkpoint somewhere the shard does not gather it from`,
      ).toEqual({
        incremental: true,
        incrementalFile: "reports/mutation/stryker-incremental.json",
      });
    }
  });

  it("uploads a leg's merged results unless its merge failed", () => {
    const upload = onlyStep(
      mutationWorkflow().jobs.summary.steps,
      "actions/upload-artifact@",
      "summary",
    );

    expect(upload.if).toEqual("always() && steps.merge.outcome == 'success'");
    expect(upload.with?.["path"]).toEqual("${{ runner.temp }}/merged/stryker-incremental.json");
    expect(upload.with?.["retention-days"]).toBe(14);
    expect(upload.with?.["overwrite"]).toBe(true);
  });

  it("caps a night at 120 minutes, a dispatch as asked", () => {
    expect(mutationWorkflow().jobs.stryker["timeout-minutes"]).toEqual(
      "${{ fromJSON(inputs.ceiling-minutes || '120') }}",
    );
  });

  it("queues a branch's runs, each starting from the last checkpoint", () => {
    expect(mutationWorkflow().concurrency).toEqual({
      group: "mutation-${{ github.ref }}",
      "cancel-in-progress": false,
    });
  });

  it("asks only to read the tree and this repository's artifacts", () => {
    expect(mutationWorkflow().permissions).toEqual({ contents: "read", actions: "read" });
    expect(mutationWorkflow().jobs.stryker.permissions).toBeUndefined();
    expect(mutationWorkflow().jobs.summary.permissions).toBeUndefined();
  });
});

// The organisation's plan runs 20 jobs at once. A merge group runs four legs and a pull request
// three, each opening with a lane job.
const CONCURRENT_JOBS = 20;
const MERGE_GROUP_LEGS = 4;
const PULL_REQUEST_LEGS = 3;
const A_LANE_JOB = 1;

const legRoots = new Map([
  ["api", "apps/api"],
  ["core", "packages/core"],
]);

const sliceArgv = (leg: string, shard: number, of: number): readonly string[] => [
  "slice",
  "--leg",
  leg,
  "--shard",
  String(shard),
  "--of",
  String(of),
  "--baseline",
  path.join(repositoryRoot, "no-previous-run.json"),
];

describe("each mutation leg, run as shards and summed once", () => {
  it("runs shards 1 to N once, summed by one summary", () => {
    const { stryker, summary } = mutationWorkflow().jobs;
    const shards = stryker.strategy.matrix.include;

    expect(summary.strategy.matrix.include.map((leg) => leg.name).toSorted()).toEqual(
      [...new Set(shards.map((shard) => shard.name))].toSorted(),
    );
    for (const { name, of } of summary.strategy.matrix.include) {
      const own = shards.filter((shard) => shard.name === name);

      expect(own.map((shard) => shard.shard)).toEqual(
        Array.from({ length: of }, (_, index) => index + 1),
      );
      expect(own.every((shard) => shard.of === of && shard.path === legRoots.get(name))).toBe(true);
    }
  });

  it("cuts each leg into slices that tile its mutate set", async () => {
    for (const { name, of } of mutationWorkflow().jobs.summary.strategy.matrix.include) {
      const root = legRoots.get(name) ?? "";
      const config = configSchema.parse(CONFIGS.get(root));
      const printed = await Promise.all(
        Array.from({ length: of }, (_, index) =>
          mutationShardsFromArgv(sliceArgv(name, index + 1, of), legs),
        ),
      );
      const script = spawnSync(
        process.execPath,
        [path.join(repositoryRoot, "scripts/mutation-shards.mjs"), ...sliceArgv(name, of, of)],
        { encoding: "utf8" },
      );
      const slices = printed.map((slice) => slice.split(","));
      const parts = slices.flat().map((part) => {
        const [, file = part, from, to] = /^(.+):(\d+)-(\d+)$/u.exec(part) ?? [];
        return {
          file,
          lines: from === undefined ? undefined : { from: Number(from), to: Number(to) },
        };
      });
      const whole = parts.flatMap(({ file, lines }) => (lines === undefined ? [file] : []));
      const cut = Map.groupBy(
        parts.flatMap(({ file, lines }) => (lines === undefined ? [] : [{ file, lines }])),
        ({ file }) => file,
      );

      expect(script.stdout, `${name}'s script printed another slice: ${script.stderr}`).toBe(
        printed.at(-1),
      );
      expect(slices.every((slice) => slice.length > 0 && slice[0] !== "")).toBe(true);
      expect(new Set(whole).size, `${name}'s slices share a file`).toBe(whole.length);
      expect([...whole, ...cut.keys()].toSorted()).toEqual(
        mutateSet(path.join(repositoryRoot, root), config.mutate),
      );
      for (const [file, pieces] of cut) {
        const text = readFileSync(path.join(repositoryRoot, root, file), "utf8");
        const last = text.trimEnd().split("\n").length;
        const ranges = pieces
          .map(({ lines }) => lines)
          .toSorted((left, right) => left.from - right.from);

        expect(whole, `${file} is both cut and whole`).not.toContain(file);
        expect(
          ranges.map(({ from }) => from),
          `${name}'s pieces of ${file} leave a gap or overlap`,
        ).toEqual([1, ...ranges.slice(0, -1).map(({ to }) => to + 1)]);
        expect(ranges.at(-1)?.to).toBe(last);
      }
    }
  });

  it("gathers each shard's files where the summary downloads them", () => {
    const { stryker, summary } = mutationWorkflow().jobs;
    const gather = stepRunning(stryker.steps, "stryker-incremental.json", "stryker");
    const upload = onlyStep(stryker.steps, "actions/upload-artifact@", "stryker");
    const download = onlyStep(summary.steps, "actions/download-artifact@", "summary");

    expect(gather.env?.["GATHERED"]).toEqual("${{ runner.temp }}/shard");
    expect(gather.run).toContain('"${GATHERED}/${SHARD}.checkpoint.json"');
    expect(gather.run).toContain('"${GATHERED}/${SHARD}.report.json"');
    expect(upload.with?.["name"]).toEqual("stryker-shard-${{ matrix.name }}-${{ matrix.shard }}");
    expect(upload.with?.["path"]).toEqual("${{ runner.temp }}/shard/");
    expect(download.with).toEqual({
      pattern: "stryker-shard-${{ matrix.name }}-*",
      path: "${{ runner.temp }}/shards",
      "merge-multiple": true,
    });
    expect(stepRunning(summary.steps, "mutation-shards.mjs merge", "summary").run).toContain(
      '--shards "${RUNNER_TEMP}/shards"',
    );
  });

  it("slices and merges by the one run the restore reads", () => {
    const { stryker, summary } = mutationWorkflow().jobs;

    expect(onlyStep(stryker.steps, BASELINE_ACTION, "stryker").with?.["reports"]).toEqual(
      "${{ matrix.path }}/reports/mutation",
    );
    expect(stepRunning(stryker.steps, "mutation-shards.mjs slice", "stryker").run).toContain(
      "--baseline reports/mutation/baseline.json",
    );
    expect(onlyStep(summary.steps, BASELINE_ACTION, "summary").with?.["reports"]).toEqual(
      "${{ runner.temp }}/baseline",
    );
    expect(stepRunning(summary.steps, "mutation-shards.mjs merge", "summary").run).toContain(
      '--baseline "${RUNNER_TEMP}/baseline/baseline.json"',
    );
  });

  it("sums a leg up after every shard, whatever each did", () => {
    const { summary } = mutationWorkflow().jobs;

    expect(summary.needs).toEqual("stryker");
    expect(summary.if).toEqual("always()");
  });

  it("runs only the shards a dispatch names, skipping the rest", () => {
    const workflow = mutationWorkflow();
    const { stryker } = workflow.jobs;

    expect(workflow.on.workflow_dispatch.inputs["shards"]?.type).toEqual("string");
    expect(stryker.env?.["SELECTED"]).toEqual(
      "${{ !inputs.shards || contains(format(',{0},', inputs.shards), format(',{0}-{1},', matrix.name, matrix.shard)) }}",
    );
    const [check, ...rest] = stryker.steps;

    expect(check?.if).toEqual("inputs.shards");
    expect(rest.map((step) => step.if?.replace("always() && ", "") ?? "no condition")).toEqual(
      rest.map(() => "env.SELECTED == 'true'"),
    );
  });

  // A shard named wrongly would run nothing, and the run would come back green having tested
  // nothing.
  it.each([
    { shards: "core-1,api-2", leg: "core", of: 16, refused: false },
    { shards: "api-6", leg: "core", of: 16, refused: false },
    { shards: "api-6", leg: "api", of: 5, refused: true },
    { shards: "core-17", leg: "core", of: 16, refused: true },
    { shards: "core-1, api-2", leg: "core", of: 16, refused: true },
    { shards: "core4", leg: "core", of: 16, refused: true },
    { shards: "core-0", leg: "core", of: 16, refused: true },
    { shards: "web-1", leg: "core", of: 16, refused: true },
  ])("refuses $shards in a $leg shard: $refused", ({ shards, leg, of, refused }) => {
    const [check] = mutationWorkflow().jobs.stryker.steps;
    const run = spawnSync("bash", ["-c", check?.run ?? "exit 2"], {
      encoding: "utf8",
      env: { ...process.env, SHARDS: shards, LEG: leg, OF: String(of) },
    });

    expect({ refused: run.status !== 0, said: run.stdout.startsWith("::error::") }).toEqual({
      refused,
      said: refused,
    });
    expect(check?.env).toEqual({
      SHARDS: "${{ inputs.shards }}",
      LEG: "${{ matrix.name }}",
      OF: "${{ matrix.of }}",
    });
  });

  it("knows a shard's leg by the matrix's own names", () => {
    const { stryker } = mutationWorkflow().jobs;
    const [check] = stryker.steps;
    const legs = /\^\(([a-z|]+)\)-/u.exec(check?.run ?? "")?.[1]?.split("|") ?? [];

    expect(legs.toSorted()).toEqual(
      [...new Set(stryker.strategy.matrix.include.map((shard) => shard.name))].toSorted(),
    );
  });

  it("leaves room for a merge group and a pull request", () => {
    expect(mutationWorkflow().jobs.stryker.strategy["max-parallel"]).toBeLessThanOrEqual(
      CONCURRENT_JOBS - MERGE_GROUP_LEGS - PULL_REQUEST_LEGS - A_LANE_JOB,
    );
  });
});
