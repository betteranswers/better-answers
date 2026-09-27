import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";
import { readWorkflow, workflowStepSchema } from "@better-answers/devtools/workflows";

const releaseWorkflowSchema = z.object({
  on: z.object({
    workflow_call: z.object({
      inputs: z.record(z.string(), z.object({ type: z.string(), required: z.boolean() })),
    }),
    workflow_dispatch: z.object({ inputs: z.record(z.string(), z.unknown()) }),
  }),
  concurrency: z.object({
    group: z.string(),
    "cancel-in-progress": z.boolean(),
    queue: z.string().optional(),
  }),
  jobs: z.object({
    gate: z.object({
      outputs: z.record(z.string(), z.string()),
      steps: z.array(workflowStepSchema),
    }),
    promote: z.object({ needs: z.string(), if: z.string(), steps: z.array(workflowStepSchema) }),
  }),
});

const buildWorkflowSchema = z.object({
  concurrency: z.object({ group: z.string() }),
  jobs: z.object({
    release: z.object({
      needs: z.string(),
      if: z.string(),
      uses: z.string(),
      with: z.record(z.string(), z.string()),
    }),
  }),
});

const release = () => readWorkflow("release.yml", releaseWorkflowSchema);
const build = () => readWorkflow("build.yml", buildWorkflowSchema);

const gateStep = () => release().jobs.gate.steps.find((step) => step.id === "ask");

const HEAD = "5c1b9e0f2a7d4c3b8e6f1a0d9c2b7e4f3a8d6c1b";
const OLDER = "0e7a3c5b9d1f2e4a6c8b0d2f4e6a8c0b2d4f6e8a";
const REPOSITORY = "betteranswers/better-answers";

/** Answers only the one call the gate makes, so a changed call fails as unread. */
const STUB_GH = [
  "#!/usr/bin/env bash",
  '[ -n "${STUB_GH_FAILS:-}" ] && exit 1',
  `[ "$*" = "api repos/${REPOSITORY}/git/ref/heads/main --jq .object.sha" ] || exit 2`,
  'printf "%s\\n" "${STUB_HEAD}"',
  "",
].join("\n");

const scratch = mkdtempSync(path.join(tmpdir(), "release-gate-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

type GateRun = {
  readonly code: number | null;
  readonly said: string;
  readonly output: string;
  readonly summary: string;
};

const gateRan = (env: Readonly<Record<string, string>>): GateRun => {
  const script = gateStep()?.run;
  if (script === undefined) throw new Error("release.yml's gate has no `ask` step to run");
  const run = mkdtempSync(path.join(scratch, "run-"));
  mkdirSync(path.join(run, "bin"));
  writeFileSync(path.join(run, "bin", "gh"), STUB_GH, { mode: 0o755 });
  writeFileSync(path.join(run, "output"), "");
  writeFileSync(path.join(run, "summary"), "");
  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      PATH: `${path.join(run, "bin")}:${process.env["PATH"] ?? ""}`,
      GITHUB_OUTPUT: path.join(run, "output"),
      GITHUB_STEP_SUMMARY: path.join(run, "summary"),
      REPOSITORY,
      COMMIT: "",
      PLATFORM_LIVE_SINCE: "",
      REHEARSED_BY: "",
      STUB_HEAD: HEAD,
      ...env,
    },
  });
  return {
    code: result.status,
    said: result.stdout,
    output: readFileSync(path.join(run, "output"), "utf8"),
    summary: readFileSync(path.join(run, "summary"), "utf8"),
  };
};

describe("the gate a release passes before it promotes", () => {
  it("releases a build's commit while it is main's head", () => {
    expect(gateRan({ COMMIT: HEAD })).toEqual({
      code: 0,
      said: "",
      output: "promote=true\n",
      summary: "",
    });
  });

  it("skips a build's commit once main has moved on", () => {
    const skipped = `${OLDER} is no longer main's head; ${HEAD} is. Production never goes back to an older commit, so a newer commit's green build releases in its place.`;

    expect(gateRan({ COMMIT: OLDER })).toEqual({
      code: 0,
      said: `::notice::${skipped}\n`,
      output: "promote=false\n",
      summary: `### Not released\n\n${skipped}\n`,
    });
  });

  it("skips every build's release once the platform is live", () => {
    const skipped =
      "The platform is live (PLATFORM_LIVE_SINCE 2027-01-04), so a green build no longer releases itself. Dispatch `release` with `rehearsed_by` (RUNBOOK.md page 6).";

    expect(gateRan({ COMMIT: HEAD, PLATFORM_LIVE_SINCE: "2027-01-04" })).toEqual({
      code: 0,
      said: `::notice::${skipped}\n`,
      output: "promote=false\n",
      summary: `### Not released\n\n${skipped}\n`,
    });
  });

  it("refuses a build's commit when main's head cannot be read", () => {
    expect(gateRan({ COMMIT: HEAD, STUB_GH_FAILS: "yes" })).toEqual({
      code: 1,
      said: `::error::main's head could not be read, so ${HEAD} is not released: a newer commit may already be the head\n`,
      output: "",
      summary: "",
    });
  });

  it("refuses a commit that is not a full sha", () => {
    expect(gateRan({ COMMIT: HEAD.slice(0, 7) })).toEqual({
      code: 1,
      said: "::error::commit is not a full commit sha (40 hex characters)\n",
      output: "",
      summary: "",
    });
  });

  it("lets a dispatch through before go-live, naming no drill", () => {
    expect(gateRan({})).toEqual({ code: 0, said: "", output: "promote=true\n", summary: "" });
  });

  it("refuses an undrilled dispatch once the platform is live", () => {
    expect(gateRan({ PLATFORM_LIVE_SINCE: "2027-01-04" })).toEqual({
      code: 1,
      said: "::error::the platform is live (PLATFORM_LIVE_SINCE 2027-01-04): a release must ride a drill that just proved a restore, or state a hotfix reason. Fill `rehearsed_by` (RUNBOOK.md page 6)\n",
      output: "",
      summary: "",
    });
  });

  it("lets a dispatch naming its drill through once live", () => {
    expect(
      gateRan({
        PLATFORM_LIVE_SINCE: "2027-01-04",
        REHEARSED_BY: "drills/drill-20270104T020000Z.md",
      }),
    ).toEqual({ code: 0, said: "", output: "promote=true\n", summary: "" });
  });
});

describe("how build.yml hands its commit to release.yml", () => {
  it("calls the release after every image leg, on main alone", () => {
    expect(build().jobs.release).toEqual({
      needs: "image",
      if: "${{ !cancelled() && needs.image.result == 'success' && github.ref == 'refs/heads/main' }}",
      uses: "./.github/workflows/release.yml",
      with: { commit: "${{ github.sha }}" },
    });
    expect(release().on.workflow_call.inputs).toEqual({
      commit: { type: "string", required: true },
    });
  });

  it("queues every release in one group, cancelling none", () => {
    expect(release().concurrency).toEqual({
      group: "release-production",
      "cancel-in-progress": false,
      queue: "max",
    });
    expect(release().concurrency.group).not.toEqual(build().concurrency.group);
  });

  it("promotes only what the gate passes, at the build's commit", () => {
    const { gate, promote } = release().jobs;
    const checkout = promote.steps.find((step) => step.uses?.startsWith("actions/checkout@"));

    expect(gate.outputs).toEqual({ promote: "${{ steps.ask.outputs.promote }}" });
    expect({ needs: promote.needs, if: promote.if }).toEqual({
      needs: "gate",
      if: "needs.gate.outputs.promote == 'true'",
    });
    expect(checkout?.with?.["ref"]).toEqual("${{ inputs.commit || 'main' }}");
  });

  it("reads the switch the runbook tells the owner to set", () => {
    expect(gateStep()?.env?.["PLATFORM_LIVE_SINCE"]).toEqual("${{ vars.PLATFORM_LIVE_SINCE }}");
    expect(readFileSync(path.join(repositoryRoot, "docs/operations/RUNBOOK.md"), "utf8")).toContain(
      "gh variable set PLATFORM_LIVE_SINCE --body <date>",
    );
  });
});
