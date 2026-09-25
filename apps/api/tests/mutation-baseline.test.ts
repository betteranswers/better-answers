import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import coreStrykerConfig from "../../../packages/core/stryker.config.mjs";
import apiStrykerConfig from "../stryker.config.mjs";
import { type ImageStep, readWorkflow, workflowStepSchema } from "./image-probe.ts";

const legSchema = z.object({ name: z.string(), path: z.string() });

const mutationWorkflowSchema = z.object({
  concurrency: z.object({ group: z.string(), "cancel-in-progress": z.boolean() }).optional(),
  permissions: z.record(z.string(), z.string()),
  jobs: z.object({
    stryker: z.object({
      "timeout-minutes": z.union([z.number(), z.string()]),
      permissions: z.record(z.string(), z.string()).optional(),
      strategy: z.object({ matrix: z.object({ include: z.array(legSchema) }) }),
      steps: z.array(workflowStepSchema),
    }),
  }),
});

const mutationWorkflow = () => readWorkflow("mutation.yml", mutationWorkflowSchema);

const NEWEST_CHECKPOINT_VARIABLE = "NEWEST_CHECKPOINT";

const restoreStep = (): ImageStep => {
  const found = mutationWorkflow().jobs.stryker.steps.find(
    (step) => step.env?.[NEWEST_CHECKPOINT_VARIABLE] !== undefined,
  );
  if (found === undefined) {
    throw new Error(`mutation.yml has no step carrying \`${NEWEST_CHECKPOINT_VARIABLE}\``);
  }
  return found;
};

const uploadStep = (): ImageStep => {
  const found = mutationWorkflow().jobs.stryker.steps.find((step) =>
    (step.uses ?? "").startsWith("actions/upload-artifact@"),
  );
  if (found === undefined) throw new Error("mutation.yml's stryker job uploads no artifact");
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

const restoreAgainst = (answer: unknown, branch = "main"): Restored => {
  const step = restoreStep();
  const directory = mkdtempSync(path.join(tmpdir(), "mutation-restore-"));
  const file = (name: string) => path.join(directory, name);
  const reports = file("packages/core/reports/mutation");
  try {
    writeFileSync(file("pages.json"), answer === REFUSED ? "" : JSON.stringify(answer));
    writeFileSync(file("asked"), "");
    const listing =
      answer === REFUSED
        ? "echo 'HTTP 403: Resource not accessible by integration' >&2; exit 1"
        : `cat '${file("pages.json")}'`;
    writeFileSync(
      file("gh"),
      [
        "#!/bin/sh",
        `printf '%s\\n' "$*" >> '${file("asked")}'`,
        'case "$1" in',
        `  api) ${listing} ;;`,
        '  run) run="$3"',
        '    while [ "$#" -gt 0 ]; do [ "$1" = "--dir" ] && dir="$2"; shift; done',
        '    mkdir -p "$dir"',
        `    printf '{"uploadedBy":%s}' "$run" > "$dir/stryker-incremental.json" ;;`,
        "esac",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const ran = spawnSync("bash", ["--noprofile", "--norc", "-e", "-c", step.run ?? ""], {
      encoding: "utf8",
      env: {
        PATH: `${directory}${path.delimiter}${process.env["PATH"] ?? ""}`,
        REPOSITORY,
        BRANCH: branch,
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

const LISTED = `api --paginate --slurp repos/${REPOSITORY}/actions/artifacts?name=${ARTIFACT}&per_page=100`;

const downloaded = (run: number, reports: string) =>
  `run download ${String(run)} --repo ${REPOSITORY} --name ${ARTIFACT} --dir ${reports}`;

describe("the nightly mutation baseline, kept as the previous run's artifact", () => {
  it("restores main's newest checkpoint for this leg, and the baseline", () => {
    const restored = restoreAgainst([
      page(EXPIRED_ON_MAIN, A_FORK_CALLING_ITS_BRANCH_MAIN, ANOTHER_BRANCH),
      page(NIGHT_BEFORE_LAST, LAST_NIGHT),
    ]);

    expect(restored.status, `the step went red: ${restored.log}`).toBe(0);
    expect(restored.asked).toEqual([LISTED, downloaded(35_970_714_712, restored.reports)]);
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
    expect(restored.asked).toEqual([LISTED]);
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

    expect(ownIsNewer.asked).toEqual([LISTED, downloaded(35_990_560_931, ownIsNewer.reports)]);
    expect(mainIsNewer.asked).toEqual([LISTED, downloaded(35_970_714_712, mainIsNewer.reports)]);
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
    expect(restored.asked).toEqual([LISTED]);
    expect(restored.checkpoint).toBeUndefined();
    expect(restored.log).toContain(says);
  });

  it("reads each leg's checkpoint from the artifact its upload names", () => {
    const restore = restoreStep();

    expect(uploadStep().with?.["name"]).toEqual("stryker-incremental-${{ matrix.name }}");
    expect(restore.env?.["ARTIFACT"]).toEqual("stryker-incremental-${{ matrix.name }}");
    expect(restore.env?.["REPORTS"]).toEqual("${{ matrix.path }}/reports/mutation");
    expect(restore.env?.["BRANCH"]).toEqual("${{ github.ref_name }}");
  });

  it("always uploads Stryker's incremental file, overwriting on a re-run", () => {
    const upload = uploadStep();
    const configs = new Map([
      ["apps/api", apiStrykerConfig],
      ["packages/core", coreStrykerConfig],
    ]);

    expect(upload.if).toEqual("always()");
    expect(upload.with?.["overwrite"]).toBe(true);
    expect(upload.with?.["path"]).toEqual(
      "${{ matrix.path }}/reports/mutation/stryker-incremental.json",
    );
    expect(mutationWorkflow().jobs.stryker.strategy.matrix.include.map((leg) => leg.path)).toEqual([
      ...configs.keys(),
    ]);
    for (const [leg, config] of configs) {
      const read = z
        .object({ incremental: z.boolean(), incrementalFile: z.string() })
        .parse(config);

      expect(read, `${leg} writes its checkpoint somewhere the upload does not read`).toEqual({
        incremental: true,
        incrementalFile: "reports/mutation/stryker-incremental.json",
      });
    }
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
  });
});
