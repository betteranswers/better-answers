import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";
import { readWorkflow, workflowStepSchema } from "@better-answers/devtools/workflows";

import {
  type Answer,
  deployScript,
  type Heard,
  listening,
  PATH_ONLY,
  type Ran,
  ran,
  scratchDirectory,
} from "./script-stand-ins.ts";

const releaseJobSchema = z.object({
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  if: z.string().optional(),
  environment: z.string().optional(),
  "timeout-minutes": z.number(),
  permissions: z.record(z.string(), z.string()),
  outputs: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  steps: z.array(workflowStepSchema),
});

type ReleaseJob = z.infer<typeof releaseJobSchema>;

const releaseWorkflowSchema = z.object({
  on: z.object({
    workflow_call: z.object({
      inputs: z.record(z.string(), z.object({ type: z.string(), required: z.boolean() })),
      secrets: z.record(z.string(), z.object({ required: z.boolean() })),
    }),
    schedule: z.array(z.object({ cron: z.string() })),
    workflow_dispatch: z.object({ inputs: z.record(z.string(), z.unknown()) }),
  }),
  concurrency: z.object({
    group: z.string(),
    "cancel-in-progress": z.boolean(),
    queue: z.string().optional(),
  }),
  jobs: z.record(z.string(), releaseJobSchema),
});

const buildWorkflowSchema = z.object({
  concurrency: z.object({ group: z.string() }),
  jobs: z.object({
    release: z.object({
      needs: z.string(),
      if: z.string(),
      uses: z.string(),
      with: z.record(z.string(), z.string()),
      secrets: z.record(z.string(), z.string()),
    }),
  }),
});

const scheduledSchema = z.object({
  on: z.object({ schedule: z.array(z.object({ cron: z.string() })).optional() }),
});

let releaseWorkflow: z.infer<typeof releaseWorkflowSchema> | undefined;
const release = () => (releaseWorkflow ??= readWorkflow("release.yml", releaseWorkflowSchema));
const build = () => readWorkflow("build.yml", buildWorkflowSchema);

const scratch = scratchDirectory("release-job-");

const HEAD = "5c1b9e0f2a7d4c3b8e6f1a0d9c2b7e4f3a8d6c1b";
const OLDER = "0e7a3c5b9d1f2e4a6c8b0d2f4e6a8c0b2d4f6e8a";
const OLDEST = "9a8b7c6d5e4f30211203f4e5d6c7b8a9f0e1d2c3";
const REPOSITORY = "betteranswers/better-answers";
const tagOf = (commit: string): string =>
  `refs/tags/release/20260926T023514Z-${commit.slice(0, 7)}`;

const STUB_GH = [
  "#!/usr/bin/env bash",
  '[ -n "${STUB_GH_FAILS:-}" ] && exit 1',
  "lines() { for line in $1; do printf '%s\\n' \"${line}\"; done; }",
  'case "$*" in',
  `  "api repos/${REPOSITORY}/git/ref/heads/main --jq .object.sha") printf '%s\\n' "\${STUB_HEAD}" ;;`,
  `  "api repos/${REPOSITORY}/commits?sha=main&per_page=100 --jq .[].sha") lines "\${STUB_COMMITS:-}" ;;`,
  `  "api repos/${REPOSITORY}/actions/workflows/build.yml/runs?branch=main&status=success&per_page=100 --jq .workflow_runs[].head_sha") lines "\${STUB_GREEN:-}" ;;`,
  `  "api --paginate repos/${REPOSITORY}/git/matching-refs/tags/release/ --jq .[].ref") lines "\${STUB_TAGS:-}" ;;`,
  "  *) exit 2 ;;",
  "esac",
  "",
].join("\n");

type GateRun = {
  readonly code: number | null;
  readonly said: string;
  readonly output: string;
  readonly summary: string;
};

const gateRan = async (env: Readonly<Record<string, string>>): Promise<GateRun> => {
  const run = mkdtempSync(path.join(scratch, "gate-"));
  mkdirSync(path.join(run, "bin"));
  writeFileSync(path.join(run, "bin", "gh"), STUB_GH, { mode: 0o755 });
  writeFileSync(path.join(run, "output"), "");
  writeFileSync(path.join(run, "summary"), "");
  const result = await ran(deployScript("release-gate.sh"), [], {
    PATH: `${path.join(run, "bin")}:${PATH_ONLY.PATH}`,
    GITHUB_OUTPUT: path.join(run, "output"),
    GITHUB_STEP_SUMMARY: path.join(run, "summary"),
    REPOSITORY,
    STUB_HEAD: HEAD,
    ...env,
  });
  return {
    code: result.code,
    said: result.out,
    output: readFileSync(path.join(run, "output"), "utf8"),
    summary: readFileSync(path.join(run, "summary"), "utf8"),
  };
};

const decided = (promote: boolean, commit: string, trigger: string): string =>
  `promote=${String(promote)}\ncommit=${commit}\ntrigger=${trigger}\n`;

const skipped = (said: string, trigger: string): GateRun => ({
  code: 0,
  said: `::notice::${said}\n`,
  output: decided(false, "", trigger),
  summary: `### Not released\n\n${said}\n`,
});

const refused = (said: string, trigger: string): GateRun => ({
  code: 1,
  said: `::error::${said}\n`,
  output: decided(false, "", trigger),
  summary: "",
});

describe("the gate a merge's release passes", () => {
  it("releases a build's commit while it is main's head", async () => {
    expect(await gateRan({ COMMIT: HEAD, EVENT: "push" })).toEqual({
      code: 0,
      said: "",
      output: decided(true, HEAD, "merge"),
      summary: "",
    });
  });

  it("skips a build's commit once main has moved on", async () => {
    expect(await gateRan({ COMMIT: OLDER, EVENT: "push" })).toEqual(
      skipped(
        `${OLDER} is no longer main's head; ${HEAD} is. Production never goes back to an older commit, so a newer commit's green build releases in its place.`,
        "merge",
      ),
    );
  });

  it.each([
    {
      mode: "nightly",
      instead: "The nightly release promotes main's newest green commit after a fresh backup.",
    },
    { mode: "drill", instead: "Dispatch `release` with `rehearsed_by` (RUNBOOK.md page 6)." },
  ])("skips a build's release in $mode mode", async ({ mode, instead }) => {
    expect(await gateRan({ COMMIT: HEAD, EVENT: "push", RELEASE_MODE: mode })).toEqual(
      skipped(
        `RELEASE_MODE is ${mode}, so a green build does not release itself. ${instead}`,
        "merge",
      ),
    );
  });

  it("refuses a build's commit when main's head cannot be read", async () => {
    expect(await gateRan({ COMMIT: HEAD, EVENT: "push", STUB_GH_FAILS: "yes" })).toEqual(
      refused(
        `main's head could not be read, so ${HEAD} is not released: a newer commit may already be the head`,
        "merge",
      ),
    );
  });

  it("refuses a commit that is not a full sha", async () => {
    expect(await gateRan({ COMMIT: HEAD.slice(0, 7), EVENT: "push" })).toEqual(
      refused("commit is not a full commit sha (40 hex characters)", "merge"),
    );
  });
});

describe("the gate the nightly release passes", () => {
  const nightly = (env: Readonly<Record<string, string>>) =>
    gateRan({ EVENT: "schedule", RELEASE_MODE: "nightly", ...env });

  it("releases main's newest commit with a green build", async () => {
    expect(
      await nightly({
        STUB_COMMITS: `${HEAD} ${OLDER} ${OLDEST}`,
        STUB_GREEN: `${OLDER} ${OLDEST}`,
        STUB_TAGS: tagOf(OLDEST),
      }),
    ).toEqual({ code: 0, said: "", output: decided(true, OLDER, "nightly"), summary: "" });
  });

  it("skips when main has not moved since its release", async () => {
    expect(
      await nightly({
        STUB_COMMITS: `${HEAD} ${OLDER}`,
        STUB_GREEN: `${HEAD} ${OLDER}`,
        STUB_TAGS: `${tagOf(OLDER)} ${tagOf(HEAD)}`,
      }),
    ).toEqual(
      skipped(
        `${HEAD} is the newest release on main, and no commit after it has a green build, so nothing is released tonight.`,
        "nightly",
      ),
    );
  });

  it("never releases a commit older than the last release", async () => {
    expect(
      await nightly({
        STUB_COMMITS: `${HEAD} ${OLDER} ${OLDEST}`,
        STUB_GREEN: OLDEST,
        STUB_TAGS: tagOf(OLDER),
      }),
    ).toEqual(
      skipped(
        `${OLDER} is the newest release on main, and no commit after it has a green build, so nothing is released tonight.`,
        "nightly",
      ),
    );
  });

  it("refuses when no recent commit on main is green", async () => {
    expect(await nightly({ STUB_COMMITS: `${HEAD} ${OLDER}`, STUB_GREEN: "" })).toEqual(
      refused(
        "none of main's last 100 commits has a green build, so nothing is released tonight",
        "nightly",
      ),
    );
  });

  it("has nothing to do in per-merge mode", async () => {
    expect(await gateRan({ EVENT: "schedule" })).toEqual(
      skipped(
        "RELEASE_MODE is per-merge, so the nightly release has nothing to do. Every green build on main releases itself.",
        "nightly",
      ),
    );
  });
});

const EVERY_TRIGGER = [
  { trigger: "merge", env: { COMMIT: HEAD, EVENT: "push" } },
  { trigger: "nightly", env: { EVENT: "schedule" } },
  { trigger: "dispatch", env: { EVENT: "workflow_dispatch" } },
];

describe("the gate a dispatched release passes", () => {
  it("lets a dispatch through outside drill mode, naming no drill", async () => {
    expect(await gateRan({ EVENT: "workflow_dispatch", RELEASE_MODE: "nightly" })).toEqual({
      code: 0,
      said: "",
      output: decided(true, "", "dispatch"),
      summary: "",
    });
  });

  it("refuses an undrilled dispatch in drill mode", async () => {
    expect(await gateRan({ EVENT: "workflow_dispatch", RELEASE_MODE: "drill" })).toEqual(
      refused(
        "RELEASE_MODE is drill: a release must ride a drill that just proved a restore, or state a hotfix reason. Fill `rehearsed_by` (RUNBOOK.md page 6)",
        "dispatch",
      ),
    );
  });

  it("lets a dispatch naming its drill through in drill mode", async () => {
    expect(
      await gateRan({
        EVENT: "workflow_dispatch",
        RELEASE_MODE: "drill",
        REHEARSED_BY: "drills/drill-20270104T020000Z.md",
      }),
    ).toEqual({ code: 0, said: "", output: decided(true, "", "dispatch"), summary: "" });
  });

  it.each(EVERY_TRIGGER)(
    "fails closed on an unknown mode, for a $trigger",
    async ({ trigger, env }) => {
      expect(await gateRan({ ...env, RELEASE_MODE: "weekly" })).toEqual(
        refused(
          "RELEASE_MODE is 'weekly', which is not per-merge, nightly or drill, so nothing is released. Set one (gh variable set RELEASE_MODE --body nightly), or delete it for per-merge",
          trigger,
        ),
      );
    },
  );
});

const READ_KEY = "hcr_read_only_key_for_tests";

/** GitHub starts the 02:35 schedule hours late, about here. */
const READ_AT = "2026-10-01T09:00:00Z";

const STUB_DATE = [
  "#!/usr/bin/env bash",
  '[ "$*" = "-u +%s" ] || exit 2',
  "printf '%s\\n' \"${STUB_NOW}\"",
  "",
].join("\n");

type Check = { readonly status: string; readonly last_ping: string | null };

const checksAnswer =
  (checks: Readonly<Record<string, Check>>) =>
  (heard: Heard): Answer => {
    if (heard.headers["x-api-key"] !== READ_KEY) return { status: 401, body: "{}" };
    const slug = new URL(heard.url, "http://stand-in").searchParams.get("slug") ?? "";
    const check = checks[slug];
    return { status: 200, body: JSON.stringify({ checks: check === undefined ? [] : [check] }) };
  };

const freshnessRead = async (
  checks: Readonly<Record<string, Check>>,
  key: string = READ_KEY,
  at: string = READ_AT,
): Promise<Ran> => {
  const run = mkdtempSync(path.join(scratch, "fresh-"));
  mkdirSync(path.join(run, "bin"));
  writeFileSync(path.join(run, "bin", "date"), STUB_DATE, { mode: 0o755 });
  let result: Ran = { code: null, out: "", err: "" };
  await listening(checksAnswer(checks), async (origin) => {
    result = await ran(deployScript("backup-fresh.sh"), [], {
      PATH: `${path.join(run, "bin")}:${PATH_ONLY.PATH}`,
      STUB_NOW: String(Date.parse(at) / 1000),
      HEALTHCHECKS_API_URL: origin,
      HEALTHCHECKS_READ_KEY: key,
    });
  });
  return result;
};

/** Pings in the dead-man service's own form: seconds, and an offset rather than `Z`. */
const LAST_HOURS_DUMP = "2026-10-01T08:05:12+00:00";
const TONIGHTS_COPIES = "2026-10-01T02:04:51+00:00";

describe("the backup a nightly release rides on", () => {
  it("names the dump and copies it rides, both fresh", async () => {
    expect(
      await freshnessRead({
        "pg-hourly": { status: "up", last_ping: LAST_HOURS_DUMP },
        nightly: { status: "up", last_ping: TONIGHTS_COPIES },
      }),
    ).toEqual({
      code: 0,
      out: `the box's own backup: the database dump verified at ${LAST_HOURS_DUMP}, the object and git store copies at ${TONIGHTS_COPIES}\n`,
      err: "",
    });
  });

  it("refuses a dump whose last run failed", async () => {
    expect(
      await freshnessRead({
        "pg-hourly": { status: "down", last_ping: LAST_HOURS_DUMP },
        nightly: { status: "up", last_ping: TONIGHTS_COPIES },
      }),
    ).toEqual({
      code: 1,
      out: "",
      err: `::error::the pg-hourly backup is not fresh: its check is down, last pinged ${LAST_HOURS_DUMP}, where it needs to be up and pinged since 2026-10-01T07:55:00Z, so nothing is released\n`,
    });
  });

  it("holds the dump to 65 minutes before the read", async () => {
    const pinged = async (dump: string) =>
      (
        await freshnessRead({
          "pg-hourly": { status: "up", last_ping: dump },
          nightly: { status: "up", last_ping: TONIGHTS_COPIES },
        })
      ).code;

    expect([
      await pinged("2026-10-01T07:55:00+00:00"),
      await pinged("2026-10-01T07:54:59+00:00"),
    ]).toEqual([0, 1]);
  });

  it("refuses copies from the night before", async () => {
    const copies = "2026-09-30T02:04:51+00:00";

    expect(
      await freshnessRead({
        "pg-hourly": { status: "up", last_ping: LAST_HOURS_DUMP },
        nightly: { status: "up", last_ping: copies },
      }),
    ).toEqual({
      code: 1,
      out: "",
      err: `::error::the nightly backup is not fresh: its check is up, last pinged ${copies}, where it needs to be up and pinged since 2026-10-01T02:00:00Z, so nothing is released\n`,
    });
  });

  it("takes a dump pinged while the read is under way", async () => {
    expect(
      await freshnessRead({
        "pg-hourly": { status: "up", last_ping: "2026-10-01T09:00:01+00:00" },
        nightly: { status: "up", last_ping: TONIGHTS_COPIES },
      }),
    ).toMatchObject({ code: 0, err: "" });
  });

  it("takes the night before's copies when read before 02:00", async () => {
    const dump = "2026-10-01T01:05:12+00:00";
    const copies = "2026-09-30T02:04:51+00:00";

    expect(
      await freshnessRead(
        {
          "pg-hourly": { status: "up", last_ping: dump },
          nightly: { status: "up", last_ping: copies },
        },
        READ_KEY,
        "2026-10-01T01:30:00Z",
      ),
    ).toMatchObject({ code: 0, err: "" });
  });

  it("refuses when the service will not answer for the key", async () => {
    expect(await freshnessRead({}, "not-the-key")).toEqual({
      code: 1,
      out: "",
      err: "::error::the dead-man service answered 401 for the pg-hourly check, so the backup's freshness is unknown and nothing is released\n",
    });
  });

  it("refuses without the read key", async () => {
    expect(await freshnessRead({}, "")).toEqual({
      code: 1,
      out: "",
      err: "::error::HEALTHCHECKS_READ_KEY is not set in the production environment, so the nightly release cannot read whether the box's backup is fresh (RUNBOOK.md page 6)\n",
    });
  });
});

const API_DIGEST = "sha256:1f2e3d4c5b6a79880a9b8c7d6e5f40312a3b4c5d6e7f8091a2b3c4d5e6f70819";
const WORKER_DIGEST = "sha256:e0d1c2b3a4958677f6e5d4c3b2a19080f7e6d5c4b3a29181a0b1c2d3e4f50617";

type Redeployed = Ran & { readonly heard: readonly Heard[] };

const redeployedThrough = async (
  answer: (heard: Heard) => Answer,
  credentials: Readonly<Record<string, string>> = {},
): Promise<Redeployed> => {
  let result: Redeployed = { code: null, out: "", err: "", heard: [] };
  await listening(answer, async (origin, heard) => {
    const done = await ran(deployScript("release-redeploy.sh"), [API_DIGEST, WORKER_DIGEST], {
      ...PATH_ONLY,
      COOLIFY_URL: origin,
      COOLIFY_TOKEN: "deploy-token",
      CF_ACCESS_CLIENT_ID: "access-id",
      CF_ACCESS_CLIENT_SECRET: "access-secret",
      PROD_UUID: "uuid-1",
      ...credentials,
    });
    result = { ...done, heard: [...heard] };
  });
  return result;
};

const sent = (heard: Heard) => ({
  method: heard.method,
  url: heard.url,
  body: heard.body,
  token: heard.headers["authorization"],
  access: [heard.headers["cf-access-client-id"], heard.headers["cf-access-client-secret"]],
});

describe("the redeploy a release makes", () => {
  it("sets both digests, then deploys, with every credential", async () => {
    const redeployed = await redeployedThrough(() => ({ status: 200, body: "{}" }));
    const credentialed = { token: "Bearer deploy-token", access: ["access-id", "access-secret"] };

    expect(redeployed.code).toBe(0);
    expect(redeployed.heard.map(sent)).toEqual([
      {
        method: "PATCH",
        url: "/api/v1/applications/uuid-1/envs",
        body: `{"key":"API_IMAGE_DIGEST","value":"${API_DIGEST}","is_preview":false}\n`,
        ...credentialed,
      },
      {
        method: "PATCH",
        url: "/api/v1/applications/uuid-1/envs",
        body: `{"key":"WORKER_IMAGE_DIGEST","value":"${WORKER_DIGEST}","is_preview":false}\n`,
        ...credentialed,
      },
      { method: "POST", url: "/api/v1/deploy?uuid=uuid-1&force=false", body: "", ...credentialed },
    ]);
  });

  it("stops at the edge's redirect to sign-in", async () => {
    const redeployed = await redeployedThrough(() => ({ status: 302, body: "" }));

    expect(redeployed.code).toBe(1);
    expect(redeployed.heard).toHaveLength(1);
    expect(redeployed.err).toEqual(
      "::error::PATCH /api/v1/applications/uuid-1/envs was answered 302, a redirect to sign-in: the edge's Access credential is missing or expired, so nothing reached the orchestrator\n",
    );
  });

  it("stops at an orchestrator that refuses the deploy", async () => {
    const redeployed = await redeployedThrough((heard) =>
      heard.method === "POST" ? { status: 500, body: "{}" } : { status: 200, body: "{}" },
    );

    expect(redeployed.code).toBe(1);
    expect(redeployed.heard).toHaveLength(3);
    expect(redeployed.err).toEqual(
      "::error::POST /api/v1/deploy?uuid=uuid-1&force=false was answered 500, so the release stops before anything else is sent\n",
    );
  });

  it("calls nothing without its edge credential", async () => {
    const redeployed = await redeployedThrough(() => ({ status: 200, body: "{}" }), {
      CF_ACCESS_CLIENT_ID: "",
    });

    expect({ code: redeployed.code, heard: redeployed.heard.length, err: redeployed.err }).toEqual({
      code: 1,
      heard: 0,
      err: "::error::CF_ACCESS_CLIENT_ID is empty, so the orchestrator cannot be reached. A called release reads an environment secret only when its caller passes the secret's name\n",
    });
  });
});

type Step = z.infer<typeof workflowStepSchema>;

const running = (text: string) => (step: Step) => step.run?.includes(text) ?? false;

const jobOf = (name: string): ReleaseJob => {
  const job = release().jobs[name];
  if (job === undefined) throw new Error(`release.yml has no \`${name}\` job`);
  return job;
};

describe("how the workflows hand a release its commit", () => {
  it("calls the release after every image leg, on main alone", () => {
    expect(build().jobs.release).toEqual({
      needs: "image",
      if: "${{ !cancelled() && needs.image.result == 'success' && github.ref == 'refs/heads/main' }}",
      uses: "./.github/workflows/release.yml",
      with: { commit: "${{ github.sha }}" },
      secrets: {
        COOLIFY_DEPLOY_TOKEN: "${{ secrets.COOLIFY_DEPLOY_TOKEN }}",
        CF_ACCESS_CLIENT_ID: "${{ secrets.CF_ACCESS_CLIENT_ID }}",
        CF_ACCESS_CLIENT_SECRET: "${{ secrets.CF_ACCESS_CLIENT_SECRET }}",
      },
    });
    expect(release().on.workflow_call.inputs).toEqual({
      commit: { type: "string", required: true },
    });
  });

  it("declares every secret the caller passes", () => {
    const passed = Object.keys(build().jobs.release.secrets).sort();
    const declared = Object.keys(release().on.workflow_call.secrets).sort();

    expect(passed.filter((name) => !declared.includes(name))).toEqual([]);
  });

  it("queues every release in one group, cancelling none", () => {
    expect(release().concurrency).toEqual({
      group: "release-production",
      "cancel-in-progress": false,
      queue: "max",
    });
    expect(release().concurrency.group).not.toEqual(build().concurrency.group);
  });

  it("runs the gate, promote and record, nothing else", () => {
    expect(Object.keys(release().jobs)).toEqual(["gate", "promote", "record"]);
  });

  it("promotes only what the gate passes, at the gate's commit", () => {
    const [gate, promote] = [jobOf("gate"), jobOf("promote")];
    const checkout = promote.steps.find((step) => step.uses?.startsWith("actions/checkout@"));

    expect(gate.outputs).toEqual({
      promote: "${{ steps.ask.outputs.promote }}",
      commit: "${{ steps.ask.outputs.commit }}",
      trigger: "${{ steps.ask.outputs.trigger }}",
    });
    expect({ needs: promote.needs, if: promote.if }).toEqual({
      needs: "gate",
      if: "needs.gate.outputs.promote == 'true'",
    });
    expect(checkout?.with?.["ref"]).toEqual("${{ needs.gate.outputs.commit || 'main' }}");
  });

  it("checks the backup first, then redeploys and smokes", () => {
    const { steps } = jobOf("promote");
    const backup = steps.findIndex(running("deploy/backup-fresh.sh"));
    const redeploy = steps.findIndex(running("deploy/release-redeploy.sh"));
    const smoke = steps.findIndex(running("deploy/await-release.sh"));

    expect(steps[backup]?.if).toEqual("needs.gate.outputs.trigger == 'nightly'");
    expect([backup >= 0, backup < redeploy, redeploy < smoke]).toEqual([true, true, true]);
  });

  it("reads the switch the runbook tells the owner to set", () => {
    const ask = jobOf("gate").steps.find((step) => step.id === "ask");
    const runbook = readFileSync(path.join(repositoryRoot, "docs/operations/RUNBOOK.md"), "utf8");

    expect(ask?.env?.["RELEASE_MODE"]).toEqual("${{ vars.RELEASE_MODE }}");
    expect(runbook).toContain("gh variable set RELEASE_MODE --body nightly");
  });

  it("is read by nothing in check.yml", () => {
    const check = readFileSync(path.join(repositoryRoot, ".github/workflows/check.yml"), "utf8");

    expect(check).not.toMatch(/release\.yml|workflow_run/);
  });
});

describe("the tag a release records", () => {
  it("promotes with read access and no stored credential", () => {
    const promote = jobOf("promote");
    const checkout = promote.steps.find((step) => step.uses?.startsWith("actions/checkout@"));

    expect(promote.permissions).toEqual({ contents: "read", packages: "read" });
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    expect(promote.steps.filter(running("git push"))).toEqual([]);
  });

  it("gives write access to the record job alone", () => {
    const writers = Object.entries(release().jobs)
      .filter(([, job]) => job.permissions["contents"] === "write")
      .map(([name]) => name);

    expect(writers).toEqual(["record"]);
  });

  it("tags promote's head after health names its digest", () => {
    const { steps } = jobOf("record");
    const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    const health = steps.findIndex(running("deploy/await-release.sh"));
    const push = steps.findIndex(running('git push origin "refs/tags/${tag}"'));

    expect(checkout?.with?.["ref"]).toEqual("${{ needs.promote.outputs.head }}");
    expect(steps[health]?.env?.["API_DIGEST"]).toEqual("${{ needs.promote.outputs.api_digest }}");
    expect([health >= 0, health < push]).toEqual([true, true]);
  });

  it("installs nothing in the job holding write access", () => {
    const { steps } = jobOf("record");

    expect(
      steps.filter(
        (step) =>
          /setup-node|action-setup|setup-uv/.test(step.uses ?? "") ||
          /\b(pnpm|npm|uv|pip)\b/.test(step.run ?? ""),
      ),
    ).toEqual([]);
  });

  it("records on the smoke", () => {
    const record = jobOf("record");

    expect({ needs: record.needs, if: record.if }).toEqual({ needs: "promote", if: undefined });
  });

  it("tags by hand only a release production answers healthy on", () => {
    const said = [jobOf("promote"), jobOf("record")]
      .flatMap((job) => job.steps)
      .filter((step) => step.if === "failure()")
      .map((step) => step.run ?? "");

    expect(said.join("\n")).not.toContain("record it by hand");
    expect(said).toHaveLength(2);
    for (const one of said) expect(one).toMatch(/tag it by hand .* healthy on api/);
  });
});

const STUB_GIT = [
  "#!/usr/bin/env bash",
  'printf "%s\\0" "$@" >> "${STUB_GIT_LOG}"',
  'printf "\\036" >> "${STUB_GIT_LOG}"',
  "",
].join("\n");

const RECORDED_HEAD = "7364d68b07ba4287d8d78ba4f79e5501ba3961fa";

type Recorded = { readonly calls: readonly (readonly string[])[]; readonly summary: string };

const recorded = async (): Promise<Recorded> => {
  const step = jobOf("record").steps.find(running('git push origin "refs/tags/${tag}"'));
  const run = mkdtempSync(path.join(scratch, "record-"));
  mkdirSync(path.join(run, "bin"));
  writeFileSync(path.join(run, "bin", "git"), STUB_GIT, { mode: 0o755 });
  writeFileSync(path.join(run, "step.sh"), step?.run ?? "exit 3");
  writeFileSync(path.join(run, "summary"), "");
  writeFileSync(path.join(run, "git.log"), "");
  const done = await ran(path.join(run, "step.sh"), [], {
    PATH: `${path.join(run, "bin")}:${PATH_ONLY.PATH}`,
    STUB_GIT_LOG: path.join(run, "git.log"),
    GITHUB_STEP_SUMMARY: path.join(run, "summary"),
    TAG: "release/20261003T182337Z-7364d68",
    MESSAGE: "release: api 938568b7b474 · worker 69e6aeebdb1b",
    RELEASE_HEAD: RECORDED_HEAD,
  });
  expect(done.code).toBe(0);
  const calls = readFileSync(path.join(run, "git.log"), "utf8")
    .split("\u001e")
    .filter((call) => call !== "")
    .map((call) => call.split("\0").filter((part) => part !== ""));
  return { calls, summary: readFileSync(path.join(run, "summary"), "utf8") };
};

const taggedBy = ({ calls }: Recorded) => {
  const tagged = calls.find((call) => call[0] === "tag") ?? [];
  return {
    on: tagged.at(-1),
    tag: tagged.at(-2),
    message: tagged[tagged.indexOf("--message") + 1],
    pushed: calls.filter((call) => call[0] === "push").map((call) => call.at(-1)),
  };
};

describe("the tag the record job makes", () => {
  it("takes the tag, message and head promote named", () => {
    expect(jobOf("record").steps.find(running('git push origin "refs/tags/${tag}"'))?.env).toEqual({
      TAG: "${{ needs.promote.outputs.tag }}",
      MESSAGE: "${{ needs.promote.outputs.message }}",
      RELEASE_HEAD: "${{ needs.promote.outputs.head }}",
    });
  });

  it("tags promote's head with promote's message, and pushes that tag", async () => {
    const record = await recorded();

    expect(taggedBy(record)).toEqual({
      on: RECORDED_HEAD,
      tag: "release/20261003T182337Z-7364d68",
      message: "release: api 938568b7b474 · worker 69e6aeebdb1b",
      pushed: ["refs/tags/release/20261003T182337Z-7364d68"],
    });
    expect(record.summary).toContain("### Recorded");
  });
});

const cronOf = (spec: string): { readonly minute: number; readonly hour: number } => {
  const [minute = "", hour = ""] = spec.split(" ");
  return { minute: Number(minute), hour: Number(hour) };
};

describe("when the nightly release runs", () => {
  it("runs after the box's nightly copy and that hour's dump", () => {
    const boxCron = readFileSync(deployScript("backup.Dockerfile"), "utf8");
    const dumpMinute = Number(/'(\d+) \* \* \* \* root [^']*backup\.sh hourly/.exec(boxCron)?.[1]);
    const copiesAt = /'(\d+) (\d+) \* \* \* root [^']*backup\.sh nightly/.exec(boxCron);
    const nightly = release().on.schedule.map((entry) => cronOf(entry.cron));

    expect(nightly).toEqual([{ minute: 35, hour: 2 }]);
    expect({
      copiesHour: Number(copiesAt?.[2]),
      copiesBefore: Number(copiesAt?.[1]) < 35,
      dumpBefore: dumpMinute < 35,
    }).toEqual({ copiesHour: 2, copiesBefore: true, dumpBefore: true });
  });

  it("shares its minute with no other scheduled workflow", () => {
    const schedules = readdirSync(path.join(repositoryRoot, ".github", "workflows"))
      .filter((file) => file.endsWith(".yml"))
      .flatMap((file) =>
        (readWorkflow(file, scheduledSchema).on.schedule ?? []).map((entry) =>
          entry.cron.split(" ").slice(0, 2).join(" "),
        ),
      );

    expect(schedules.filter((time, index) => schedules.indexOf(time) !== index)).toEqual([]);
    expect(schedules).toContain("35 2");
  });
});
