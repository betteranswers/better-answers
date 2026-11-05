import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { assert, describe, expect, it } from "vitest";
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
} from "../support/script-stand-ins.ts";

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

const runGate = async (env: Readonly<Record<string, string>>): Promise<GateRun> => {
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

describe("the release gate for a merge", () => {
  it("releases a build's commit while it is main's head", async () => {
    expect(await runGate({ COMMIT: HEAD, EVENT: "push" })).toEqual({
      code: 0,
      said: "",
      output: decided(true, HEAD, "merge"),
      summary: "",
    });
  });

  it("skips a build's commit once main has a newer head", async () => {
    expect(await runGate({ COMMIT: OLDER, EVENT: "push" })).toEqual(
      skipped(
        `${OLDER} was not released because the head of main is now ${HEAD}. Production never moves back to an older commit, so the build of ${HEAD} releases instead.`,
        "merge",
      ),
    );
  });

  it.each([
    {
      mode: "nightly",
      instead:
        "In nightly mode, the nightly run releases the newest green commit on main after it confirms a fresh backup.",
    },
    {
      mode: "drill",
      instead: "In drill mode, dispatch `release` and fill `rehearsed_by` (RUNBOOK.md page 6).",
    },
  ])("skips a build's release in $mode mode", async ({ mode, instead }) => {
    expect(await runGate({ COMMIT: HEAD, EVENT: "push", RELEASE_MODE: mode })).toEqual(
      skipped(
        `RELEASE_MODE is ${mode}, so a green build on main is not released automatically. ${instead}`,
        "merge",
      ),
    );
  });

  it("refuses a build's commit when main's head cannot be read", async () => {
    expect(await runGate({ COMMIT: HEAD, EVENT: "push", STUB_GH_FAILS: "yes" })).toEqual(
      refused(
        `Could not read the head of main from the GitHub API, so ${HEAD} was not released. Re-run this job; if main has moved on, the newer commit's build releases instead.`,
        "merge",
      ),
    );
  });

  it("refuses a commit that is not a full sha", async () => {
    expect(await runGate({ COMMIT: HEAD.slice(0, 7), EVENT: "push" })).toEqual(
      refused(
        `COMMIT '${HEAD.slice(0, 7)}' is not a full commit SHA. Pass all 40 hex characters.`,
        "merge",
      ),
    );
  });
});

describe("the release gate for the nightly release", () => {
  const nightly = (env: Readonly<Record<string, string>>) =>
    runGate({ EVENT: "schedule", RELEASE_MODE: "nightly", ...env });

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
        `Nothing was released tonight: ${HEAD} is already released, and no later commit on main has a green build.`,
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
        `Nothing was released tonight: ${OLDER} is already released, and no later commit on main has a green build.`,
        "nightly",
      ),
    );
  });

  it("refuses when no recent commit on main is green", async () => {
    expect(await nightly({ STUB_COMMITS: `${HEAD} ${OLDER}`, STUB_GREEN: "" })).toEqual(
      refused(
        "Nothing was released tonight: none of the last 100 commits on main has a green build. Fix the build on main, then dispatch `release` or wait for the next nightly run.",
        "nightly",
      ),
    );
  });

  it("skips the nightly release in per-merge mode", async () => {
    expect(await runGate({ EVENT: "schedule" })).toEqual(
      skipped(
        "RELEASE_MODE is per-merge, so the nightly run releases nothing. In per-merge mode, every green build on main is released.",
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

describe("the release gate for a dispatched release", () => {
  it("passes a dispatch outside drill mode without a drill record", async () => {
    expect(await runGate({ EVENT: "workflow_dispatch", RELEASE_MODE: "nightly" })).toEqual({
      code: 0,
      said: "",
      output: decided(true, "", "dispatch"),
      summary: "",
    });
  });

  it("refuses a dispatch without rehearsed_by in drill mode", async () => {
    expect(await runGate({ EVENT: "workflow_dispatch", RELEASE_MODE: "drill" })).toEqual(
      refused(
        "RELEASE_MODE is drill, so a dispatched release needs `rehearsed_by`. Set it to the report of the restore drill that just passed (drills/drill-<stamp>.md), or to 'hotfix: <reason>'. See RUNBOOK.md page 6.",
        "dispatch",
      ),
    );
  });

  it("passes a dispatch that names its drill in drill mode", async () => {
    expect(
      await runGate({
        EVENT: "workflow_dispatch",
        RELEASE_MODE: "drill",
        REHEARSED_BY: "drills/drill-20270104T020000Z.md",
      }),
    ).toEqual({ code: 0, said: "", output: decided(true, "", "dispatch"), summary: "" });
  });

  it.each(EVERY_TRIGGER)(
    "refuses an unknown RELEASE_MODE for a $trigger",
    async ({ trigger, env }) => {
      expect(await runGate({ ...env, RELEASE_MODE: "weekly" })).toEqual(
        refused(
          "RELEASE_MODE is 'weekly', so nothing was released. Set it to per-merge, nightly or drill (for example, gh variable set RELEASE_MODE --body nightly), or delete the variable to use per-merge.",
          trigger,
        ),
      );
    },
  );
});

const READ_KEY = "hcr_read_only_key_for_tests";

/** GitHub often starts the 02:35 schedule hours late, at about this time. */
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

const runBackupFresh = async (
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

/** The dead-man service writes ping times to the second, with an offset instead of `Z`. */
const LAST_HOURS_DUMP = "2026-10-01T08:05:12+00:00";
const TONIGHTS_COPIES = "2026-10-01T02:04:51+00:00";

describe("the backup check before a nightly release", () => {
  it("names the fresh dump and copies the release relies on", async () => {
    expect(
      await runBackupFresh({
        "pg-hourly": { status: "up", last_ping: LAST_HOURS_DUMP },
        nightly: { status: "up", last_ping: TONIGHTS_COPIES },
      }),
    ).toEqual({
      code: 0,
      out: `The backup is fresh: the database dump was verified at ${LAST_HOURS_DUMP}, and the object store and git store copies at ${TONIGHTS_COPIES}.\n`,
      err: "",
    });
  });

  it("refuses a dump whose last run failed", async () => {
    expect(
      await runBackupFresh({
        "pg-hourly": { status: "down", last_ping: LAST_HOURS_DUMP },
        nightly: { status: "up", last_ping: TONIGHTS_COPIES },
      }),
    ).toEqual({
      code: 1,
      out: "",
      err: `::error::The pg-hourly backup is not fresh, so nothing was released. Its check is down and was last pinged at ${LAST_HOURS_DUMP}. It must be up and pinged at or after 2026-10-01T07:55:00Z. Check the backup job on the box, then dispatch \`release\`.\n`,
    });
  });

  it("requires a dump at most 65 minutes before the read", async () => {
    const pinged = async (dump: string) =>
      (
        await runBackupFresh({
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
      await runBackupFresh({
        "pg-hourly": { status: "up", last_ping: LAST_HOURS_DUMP },
        nightly: { status: "up", last_ping: copies },
      }),
    ).toEqual({
      code: 1,
      out: "",
      err: `::error::The nightly backup is not fresh, so nothing was released. Its check is up and was last pinged at ${copies}. It must be up and pinged at or after 2026-10-01T02:00:00Z. Check the backup job on the box, then dispatch \`release\`.\n`,
    });
  });

  it("accepts a dump pinged during the read", async () => {
    expect(
      await runBackupFresh({
        "pg-hourly": { status: "up", last_ping: "2026-10-01T09:00:01+00:00" },
        nightly: { status: "up", last_ping: TONIGHTS_COPIES },
      }),
    ).toMatchObject({ code: 0, err: "" });
  });

  it("accepts the previous night's copies when read before 02:00", async () => {
    const dump = "2026-10-01T01:05:12+00:00";
    const copies = "2026-09-30T02:04:51+00:00";

    expect(
      await runBackupFresh(
        {
          "pg-hourly": { status: "up", last_ping: dump },
          nightly: { status: "up", last_ping: copies },
        },
        READ_KEY,
        "2026-10-01T01:30:00Z",
      ),
    ).toMatchObject({ code: 0, err: "" });
  });

  it("refuses when the service rejects the read key", async () => {
    expect(await runBackupFresh({}, "not-the-key")).toEqual({
      code: 1,
      out: "",
      err: "::error::The dead-man service answered 401 for the pg-hourly check, so the backup could not be checked and nothing was released.\n",
    });
  });

  it("refuses without the read key", async () => {
    expect(await runBackupFresh({}, "")).toEqual({
      code: 1,
      out: "",
      err: "::error::HEALTHCHECKS_READ_KEY is not set in the production environment, so the nightly release cannot check that the backup is fresh. Add the dead-man service's read-only key as that secret (RUNBOOK.md page 6).\n",
    });
  });
});

const API_DIGEST = "sha256:1f2e3d4c5b6a79880a9b8c7d6e5f40312a3b4c5d6e7f8091a2b3c4d5e6f70819";
const WORKER_DIGEST = "sha256:e0d1c2b3a4958677f6e5d4c3b2a19080f7e6d5c4b3a29181a0b1c2d3e4f50617";

type Redeployed = Ran & { readonly heard: readonly Heard[] };

const runRedeploy = async (
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
      RELEASE_DEPLOY_DELAY_SECONDS: "0",
      ...credentials,
    });
    result = { ...done, heard: [...heard] };
  });
  return result;
};

const PULL_STEP = "docker compose pull --policy missing";
const DEPLOYMENT = "dep-1";
const DEPLOYMENT_READ = `/api/v1/deployments/${DEPLOYMENT}`;
const DEPLOYMENTS_LIST = "/api/v1/deployments/applications/uuid-1";

const deploymentIs = (status: string): Answer => ({
  status: 200,
  body: JSON.stringify({ deployment_uuid: DEPLOYMENT, status, logs: "a deployment's whole log" }),
});

const orchestratorAnswering =
  (when: (heard: Heard) => boolean, answer: Answer): ((heard: Heard) => Answer) =>
  (heard) =>
    when(heard) ? answer : orchestrator()(heard);

const readsTheApplication = (heard: Heard): boolean =>
  heard.url === "/api/v1/applications/uuid-1" && heard.method === "GET";

type Orchestrator = {
  readonly pullStep?: string | null;
  readonly listed?: readonly string[];
  readonly reads?: readonly Answer[];
  readonly deploy?: Answer;
};

const orchestrator = ({
  pullStep = null,
  listed = ["finished", "failed"],
  reads = [deploymentIs("finished")],
  deploy = {
    status: 200,
    body: JSON.stringify({
      deployments: [
        {
          message: "Application better-answers deployment queued.",
          resource_uuid: "uuid-1",
          deployment_uuid: DEPLOYMENT,
        },
      ],
    }),
  },
}: Orchestrator = {}): ((heard: Heard) => Answer) => {
  let read = 0;
  return (heard) => {
    if (heard.url === DEPLOYMENT_READ) {
      const next = reads[Math.min(read, reads.length - 1)];
      read += 1;
      return next ?? { status: 404, body: "{}" };
    }
    if (heard.url === DEPLOYMENTS_LIST) {
      const deployments = listed.map((status, index) => ({
        deployment_uuid: `dep-0${index}`,
        status,
      }));
      return { status: 200, body: JSON.stringify({ count: deployments.length, deployments }) };
    }
    if (heard.method === "GET") {
      return {
        status: 200,
        body: JSON.stringify({ uuid: "uuid-1", docker_compose_custom_build_command: pullStep }),
      };
    }
    return heard.method === "POST" ? deploy : { status: 200, body: "{}" };
  };
};

const sent = (heard: Heard) => ({
  method: heard.method,
  url: heard.url,
  body: heard.body,
  token: heard.headers["authorization"],
  access: [heard.headers["cf-access-client-id"], heard.headers["cf-access-client-secret"]],
});

const called = (heard: Heard): string => `${heard.method} ${heard.url}`;

const digestSet = (key: string, value: string): string =>
  `${JSON.stringify({ key, value, is_preview: false, is_buildtime: true, is_runtime: true })}\n`;

describe("the redeploy step of a release", () => {
  it("sets the pull step and digests, deploys, then waits", async () => {
    const redeployed = await runRedeploy(orchestrator());
    const credentialed = { token: "Bearer deploy-token", access: ["access-id", "access-secret"] };

    expect(redeployed.heard.map(sent)).toEqual([
      { method: "GET", url: "/api/v1/applications/uuid-1", body: "", ...credentialed },
      { method: "GET", url: DEPLOYMENTS_LIST, body: "", ...credentialed },
      {
        method: "PATCH",
        url: "/api/v1/applications/uuid-1",
        body: `{"docker_compose_custom_build_command":"${PULL_STEP}"}\n`,
        ...credentialed,
      },
      {
        method: "PATCH",
        url: "/api/v1/applications/uuid-1/envs",
        body: digestSet("API_IMAGE_DIGEST", API_DIGEST),
        ...credentialed,
      },
      {
        method: "PATCH",
        url: "/api/v1/applications/uuid-1/envs",
        body: digestSet("WORKER_IMAGE_DIGEST", WORKER_DIGEST),
        ...credentialed,
      },
      { method: "POST", url: "/api/v1/deploy?uuid=uuid-1&force=false", body: "", ...credentialed },
      { method: "GET", url: DEPLOYMENT_READ, body: "", ...credentialed },
    ]);
    expect({ code: redeployed.code, out: redeployed.out, err: redeployed.err }).toEqual({
      code: 0,
      out: `Set the compose build command to \`${PULL_STEP}\`.\nDeploying production as deployment ${DEPLOYMENT}.\nDeployment ${DEPLOYMENT} finished.\n`,
      err: "",
    });
  });

  it("leaves the pull step alone when already set", async () => {
    const redeployed = await runRedeploy(orchestrator({ pullStep: PULL_STEP }));

    expect({ code: redeployed.code, calls: redeployed.heard.map(called) }).toEqual({
      code: 0,
      calls: [
        "GET /api/v1/applications/uuid-1",
        `GET ${DEPLOYMENTS_LIST}`,
        "PATCH /api/v1/applications/uuid-1/envs",
        "PATCH /api/v1/applications/uuid-1/envs",
        "POST /api/v1/deploy?uuid=uuid-1&force=false",
        `GET ${DEPLOYMENT_READ}`,
      ],
    });
  });

  it("waits through queued and in-progress until finished", async () => {
    const redeployed = await runRedeploy(
      orchestrator({
        reads: [deploymentIs("queued"), deploymentIs("in_progress"), deploymentIs("finished")],
      }),
    );

    expect({
      code: redeployed.code,
      reads: redeployed.heard.filter((heard) => heard.url === DEPLOYMENT_READ).length,
      last: redeployed.out.trimEnd().split("\n").at(-1),
    }).toEqual({ code: 0, reads: 3, last: `Deployment ${DEPLOYMENT} finished.` });
  });

  it("fails the release when the deployment fails, naming it", async () => {
    const redeployed = await runRedeploy(
      orchestrator({ reads: [deploymentIs("in_progress"), deploymentIs("failed")] }),
    );

    expect({ code: redeployed.code, err: redeployed.err }).toEqual({
      code: 1,
      err: `::error::Deployment ${DEPLOYMENT} ended with status failed. Read its log in the orchestrator. If it failed before the line \`Removing old containers.\`, production still runs the previous release.\n`,
    });
  });

  it("fails, naming the deployment, when the wait times out", async () => {
    const started = Date.now();
    const redeployed = await runRedeploy(orchestrator({ reads: [deploymentIs("in_progress")] }), {
      RELEASE_DEPLOY_WAIT_SECONDS: "2",
      RELEASE_DEPLOY_DELAY_SECONDS: "0.2",
    });
    const elapsed = Date.now() - started;

    expect({
      code: redeployed.code,
      read: redeployed.heard.some((heard) => heard.url === DEPLOYMENT_READ),
      waitedItOut: elapsed >= 2000,
      gaveUpPromptly: elapsed < 6000,
      err: redeployed.err,
    }).toEqual({
      code: 1,
      read: true,
      waitedItOut: true,
      gaveUpPromptly: true,
      err: `::error::Deployment ${DEPLOYMENT} did not finish within 2 s of being queued. Its last status was in_progress. It may still replace the production containers later, so read /health before you act.\n`,
    });
  });

  it("writes nothing while a deployment is queued or running", async () => {
    for (const status of ["queued", "in_progress"]) {
      const redeployed = await runRedeploy(orchestrator({ listed: [status, "finished"] }));

      expect({
        code: redeployed.code,
        calls: redeployed.heard.map(called),
        err: redeployed.err,
      }).toEqual({
        code: 1,
        calls: ["GET /api/v1/applications/uuid-1", `GET ${DEPLOYMENTS_LIST}`],
        err: `::error::Production deployment dep-00 is ${status}, so the release changed nothing: a deployment that has not started would pick up the new digests. Wait for it to end, or cancel it in the orchestrator, then run the release again.\n`,
      });
    }
  });

  it("writes nothing when the deployment list is unreadable", async () => {
    const redeployed = await runRedeploy(
      orchestratorAnswering((heard) => heard.url === DEPLOYMENTS_LIST, {
        status: 200,
        body: JSON.stringify({ count: 0 }),
      }),
    );

    expect({ code: redeployed.code, heard: redeployed.heard.length, err: redeployed.err }).toEqual({
      code: 1,
      heard: 2,
      err: `::error::GET ${DEPLOYMENTS_LIST} did not return a list of deployments, so the release cannot tell whether a deployment is queued or running. It changed nothing.\n`,
    });
  });

  it("stops when the orchestrator queues no new deployment", async () => {
    const redeployed = await runRedeploy(
      orchestrator({
        deploy: {
          status: 200,
          body: JSON.stringify({
            deployments: [
              {
                message: "Deployment already queued for this commit.",
                resource_uuid: "uuid-1",
                deployment_uuid: DEPLOYMENT,
              },
            ],
          }),
        },
      }),
    );

    expect({ code: redeployed.code, heard: redeployed.heard.length, err: redeployed.err }).toEqual({
      code: 1,
      heard: 6,
      err: `::error::The orchestrator did not queue a deployment: another production deployment was queued after this release checked, and the returned id ${DEPLOYMENT} does not exist. Both digests are set, so that other deployment uses them if it has not started, but no smoke test or tag follows it. When it ends, read /health, then run the release again.\n`,
    });
  });

  it("names Coolify's read ability when the first read gets 403", async () => {
    const redeployed = await runRedeploy(
      orchestratorAnswering(readsTheApplication, {
        status: 403,
        body: JSON.stringify({ message: "Missing required permissions: read" }),
      }),
    );

    expect({ code: redeployed.code, heard: redeployed.heard.length, err: redeployed.err }).toEqual({
      code: 1,
      heard: 1,
      err: "::error::GET /api/v1/applications/uuid-1 got 403. The response above says which cause applies: the Coolify token is invalid, the token lacks the `read` ability, or Cloudflare Access refused the service token. The Coolify token needs the `read`, `write` and `deploy` abilities.\n",
    });
  });

  it("keeps polling past a failed status read", async () => {
    const redeployed = await runRedeploy(
      orchestrator({ reads: [{ status: 502, body: "" }, deploymentIs("finished")] }),
    );

    expect({
      code: redeployed.code,
      reads: redeployed.heard.filter((heard) => heard.url === DEPLOYMENT_READ).length,
    }).toEqual({ code: 0, reads: 2 });
  });

  it("stops when the edge redirects the application read to sign-in", async () => {
    const redeployed = await runRedeploy(
      orchestratorAnswering((heard) => heard.url === "/api/v1/applications/uuid-1", {
        status: 302,
        body: "",
      }),
    );

    expect(redeployed.code).toBe(1);
    expect(redeployed.heard).toHaveLength(1);
    expect(redeployed.err).toEqual(
      "::error::GET /api/v1/applications/uuid-1 got 302, a redirect to the sign-in page, so the call never reached the orchestrator. The Cloudflare Access service token (CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET) is missing or expired.\n",
    );
  });

  it("stops polling when the edge redirects to sign-in", async () => {
    const redeployed = await runRedeploy(
      orchestrator({ reads: [{ status: 302, body: "" }, deploymentIs("finished")] }),
    );

    expect({ code: redeployed.code, err: redeployed.err }).toEqual({
      code: 1,
      err: `::error::GET ${DEPLOYMENT_READ} got 302, a redirect to the sign-in page, so the call never reached the orchestrator. The Cloudflare Access service token (CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET) is missing or expired.\n`,
    });
  });

  it("stops when the orchestrator refuses the deploy", async () => {
    const redeployed = await runRedeploy(orchestrator({ deploy: { status: 500, body: "{}" } }));

    expect(redeployed.code).toBe(1);
    expect(redeployed.heard).toHaveLength(6);
    expect(redeployed.err).toEqual(
      "::error::POST /api/v1/deploy?uuid=uuid-1&force=false got 500, so the release stopped and sent no further requests. The response above says why.\n",
    );
  });

  it("stops when the deploy answer names no deployment", async () => {
    const redeployed = await runRedeploy(
      orchestrator({ deploy: { status: 200, body: JSON.stringify({ deployments: [] }) } }),
    );

    expect({ code: redeployed.code, heard: redeployed.heard.length, err: redeployed.err }).toEqual({
      code: 1,
      heard: 6,
      err: "::error::POST /api/v1/deploy returned no deployment_uuid, so the release cannot wait for the deployment. Find the deployment in the orchestrator and read /health once it ends.\n",
    });
  });

  it("calls nothing without CF_ACCESS_CLIENT_ID", async () => {
    const redeployed = await runRedeploy(orchestrator(), {
      CF_ACCESS_CLIENT_ID: "",
    });

    expect({ code: redeployed.code, heard: redeployed.heard.length, err: redeployed.err }).toEqual({
      code: 1,
      heard: 0,
      err: "::error::CF_ACCESS_CLIENT_ID is empty, so the release cannot reach the orchestrator. A called workflow reads an environment secret only if its caller passes that secret by name, so check the secrets: block in the workflow that calls release.yml.\n",
    });
  });
});

type Step = z.infer<typeof workflowStepSchema>;

const running = (text: string) => (step: Step) => step.run?.includes(text) ?? false;

const installs = (step: Step): boolean =>
  /setup-node|action-setup|setup-uv/.test(step.uses ?? "") ||
  /\b(pnpm|npm|uv|pip)\b/.test(step.run ?? "");

const jobOf = (name: string): ReleaseJob => {
  const job = release().jobs[name];
  if (job === undefined) throw new Error(`release.yml has no \`${name}\` job`);
  return job;
};

describe("how build.yml calls release.yml with its commit", () => {
  it("releases only on main, after the image job succeeds", () => {
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
    const declared = new Set(Object.keys(release().on.workflow_call.secrets).sort());

    expect(passed.filter((name) => !declared.has(name))).toEqual([]);
  });

  it("queues every release in one group, cancelling none", () => {
    expect(release().concurrency).toEqual({
      group: "release-production",
      "cancel-in-progress": false,
      queue: "max",
    });
    expect(release().concurrency.group).not.toEqual(build().concurrency.group);
  });

  it("has only the gate, promote and record jobs", () => {
    expect(Object.keys(release().jobs)).toEqual(["gate", "promote", "record"]);
  });

  it("runs promote only when the gate passes, at its commit", () => {
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

  it("checks the backup, then redeploys, then runs the smoke test", () => {
    const { steps } = jobOf("promote");
    const backup = steps.findIndex(running("deploy/backup-fresh.sh"));
    const redeploy = steps.findIndex(running("deploy/release-redeploy.sh"));
    const smoke = steps.findIndex(running("deploy/await-release.sh"));

    expect(steps[backup]?.if).toEqual("needs.gate.outputs.trigger == 'nightly'");
    expect([backup >= 0, backup < redeploy, redeploy < smoke]).toEqual([true, true, true]);
  });

  it("times out ten minutes after the redeploy and smoke would", () => {
    const defaultOf = (script: string, name: string): number => {
      const text = readFileSync(path.join(repositoryRoot, "deploy", script), "utf8");
      const found = new RegExp(`\\$\\{${name}:-(\\d+)\\}`).exec(text)?.[1];
      assert(found !== undefined, `${script} sets no default for ${name}`);
      return Number(found);
    };
    const smokeReadSeconds = 5;
    const smoke =
      defaultOf("await-release.sh", "AWAIT_RELEASE_POLLS") *
      (smokeReadSeconds + defaultOf("await-release.sh", "AWAIT_RELEASE_DELAY_SECONDS"));
    const wait = defaultOf("release-redeploy.sh", "RELEASE_DEPLOY_WAIT_SECONDS");

    expect(jobOf("promote")["timeout-minutes"] * 60).toBeGreaterThanOrEqual(wait + smoke + 600);
  });

  it("reads the RELEASE_MODE variable that the runbook says to set", () => {
    const ask = jobOf("gate").steps.find((step) => step.id === "ask");
    const runbook = readFileSync(path.join(repositoryRoot, "docs/operations/RUNBOOK.md"), "utf8");

    expect(ask?.env?.["RELEASE_MODE"]).toEqual("${{ vars.RELEASE_MODE }}");
    expect(runbook).toContain("gh variable set RELEASE_MODE --body nightly");
  });

  it("is not referenced by check.yml", () => {
    const check = readFileSync(path.join(repositoryRoot, ".github/workflows/check.yml"), "utf8");

    expect(check).not.toMatch(/release\.yml|workflow_run/);
  });
});

describe("how a release records its tag", () => {
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

  it("tags promote's head after /health reports its digest", () => {
    const { steps } = jobOf("record");
    const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    const health = steps.findIndex(running("deploy/await-release.sh"));
    const push = steps.findIndex(running('git push origin "refs/tags/${tag}"'));

    expect(checkout?.with?.["ref"]).toEqual("${{ needs.promote.outputs.head }}");
    expect(steps[health]?.env?.["API_DIGEST"]).toEqual("${{ needs.promote.outputs.api_digest }}");
    expect([health >= 0, health < push]).toEqual([true, true]);
  });

  it("installs nothing in the record job, which has write access", () => {
    const { steps } = jobOf("record");

    expect(steps.filter(installs)).toEqual([]);
  });

  it("runs record only after promote and its smoke succeed", () => {
    const record = jobOf("record");

    expect({ needs: record.needs, if: record.if }).toEqual({ needs: "promote", if: undefined });
  });

  it("tells the owner to hand-tag only a healthy release", () => {
    const said = [jobOf("promote"), jobOf("record")]
      .flatMap((job) => job.steps)
      .filter((step) => step.if === "failure()")
      .map((step) => step.run);

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
  it("reads the tag, message and head from promote's outputs", () => {
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

const scheduledTimesOf = (file: string): readonly string[] =>
  (readWorkflow(file, scheduledSchema).on.schedule ?? []).map((entry) =>
    entry.cron.split(" ").slice(0, 2).join(" "),
  );

const cronOf = (spec: string): { readonly minute: number; readonly hour: number } => {
  const [minute = "", hour = ""] = spec.split(" ");
  return { minute: Number(minute), hour: Number(hour) };
};

describe("when the nightly release runs", () => {
  it("runs after the box's nightly copy and the hourly dump", () => {
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
      .flatMap(scheduledTimesOf);

    expect(schedules.filter((time, index) => schedules.indexOf(time) !== index)).toEqual([]);
    expect(schedules).toContain("35 2");
  });
});
