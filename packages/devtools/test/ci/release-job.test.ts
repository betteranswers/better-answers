import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
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
      secrets: z.record(z.string(), z.string()),
    }),
  }),
});

const scheduledSchema = z.object({
  on: z.object({ schedule: z.array(z.object({ cron: z.string() })).optional() }),
});

const release = () => readWorkflow("release.yml", releaseWorkflowSchema);
const build = () => readWorkflow("build.yml", buildWorkflowSchema);
const deployScript = (name: string): string => path.join(repositoryRoot, "deploy", name);

const scratch = mkdtempSync(path.join(tmpdir(), "release-job-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

type Ran = { readonly code: number | null; readonly out: string; readonly err: string };

const ran = (
  script: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<Ran> =>
  new Promise((resolve, reject) => {
    const child = spawn("bash", [script, ...args], { env: { ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
  });

type Heard = {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
};
type Answer = { readonly status: number; readonly body: string };

/** A stand-in for a service the release calls, answering each request as `answer` says. */
const listening = async (
  answer: (heard: Heard) => Answer,
  work: (origin: string, heard: readonly Heard[]) => Promise<void>,
): Promise<void> => {
  const heard: Heard[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      const one = {
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body,
      };
      heard.push(one);
      const { status, body: sent } = answer(one);
      response.writeHead(status, { "content-type": "application/json" });
      response.end(sent);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port to listen on");
    await work(`http://127.0.0.1:${String(address.port)}`, heard);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const PATH_ONLY = { PATH: process.env["PATH"] ?? "" };

const HEAD = "5c1b9e0f2a7d4c3b8e6f1a0d9c2b7e4f3a8d6c1b";
const OLDER = "0e7a3c5b9d1f2e4a6c8b0d2f4e6a8c0b2d4f6e8a";
const OLDEST = "9a8b7c6d5e4f30211203f4e5d6c7b8a9f0e1d2c3";
const REPOSITORY = "betteranswers/better-answers";
const tagOf = (commit: string): string =>
  `refs/tags/release/20260926T023514Z-${commit.slice(0, 7)}`;

/** Answers only the calls the gate makes, so a changed call fails as unread. */
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

const refused = (said: string): GateRun => ({
  code: 1,
  said: `::error::${said}\n`,
  output: "",
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
      ),
    );
  });

  it("refuses a commit that is not a full sha", async () => {
    expect(await gateRan({ COMMIT: HEAD.slice(0, 7), EVENT: "push" })).toEqual(
      refused("commit is not a full commit sha (40 hex characters)"),
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
      refused("none of main's last 100 commits has a green build, so nothing is released tonight"),
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

  it.each([
    { trigger: "merge", env: { COMMIT: HEAD, EVENT: "push" } },
    { trigger: "nightly", env: { EVENT: "schedule" } },
    { trigger: "dispatch", env: { EVENT: "workflow_dispatch" } },
  ])("fails closed on an unknown mode, for a $trigger", async ({ env }) => {
    expect(await gateRan({ ...env, RELEASE_MODE: "weekly" })).toEqual(
      refused(
        "RELEASE_MODE is 'weekly', which is not per-merge, nightly or drill, so nothing is released. Set one (gh variable set RELEASE_MODE --body nightly), or delete it for per-merge",
      ),
    );
  });
});

/** The dead-man service's own form: seconds, and an offset rather than `Z`. */
const pingedMinutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString().replace(/\.\d+Z$/, "+00:00");

const READ_KEY = "hcr_read_only_key_for_tests";

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
): Promise<Ran> => {
  let result: Ran = { code: null, out: "", err: "" };
  await listening(checksAnswer(checks), async (origin) => {
    result = await ran(deployScript("backup-fresh.sh"), [], {
      ...PATH_ONLY,
      HEALTHCHECKS_API_URL: origin,
      HEALTHCHECKS_READ_KEY: key,
    });
  });
  return result;
};

describe("the backup a nightly release rides on", () => {
  it("names the dump and copies it rides, both fresh", async () => {
    const dump = pingedMinutesAgo(30);
    const copies = pingedMinutesAgo(35);

    expect(
      await freshnessRead({
        "pg-hourly": { status: "up", last_ping: dump },
        nightly: { status: "up", last_ping: copies },
      }),
    ).toEqual({
      code: 0,
      out: `the box's own backup: the database dump verified at ${dump}, the object and git store copies at ${copies}\n`,
      err: "",
    });
  });

  it("refuses a dump whose last run failed", async () => {
    const dump = pingedMinutesAgo(30);

    expect(
      await freshnessRead({
        "pg-hourly": { status: "down", last_ping: dump },
        nightly: { status: "up", last_ping: pingedMinutesAgo(35) },
      }),
    ).toEqual({
      code: 1,
      out: "",
      err: `::error::the pg-hourly backup is not fresh: its check is down, last pinged ${dump}, 30 minutes ago, where 65 is the most allowed, so nothing is released\n`,
    });
  });

  it("refuses a copy older than the night's", async () => {
    const copies = pingedMinutesAgo(200);

    expect(
      await freshnessRead({
        "pg-hourly": { status: "up", last_ping: pingedMinutesAgo(30) },
        nightly: { status: "up", last_ping: copies },
      }),
    ).toEqual({
      code: 1,
      out: "",
      err: `::error::the nightly backup is not fresh: its check is up, last pinged ${copies}, 200 minutes ago, where 180 is the most allowed, so nothing is released\n`,
    });
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

const stepIndex = (
  steps: readonly z.infer<typeof workflowStepSchema>[],
  found: (step: z.infer<typeof workflowStepSchema>) => boolean,
): number => steps.findIndex(found);

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

  it("promotes only what the gate passes, at the gate's commit", () => {
    const { gate, promote } = release().jobs;
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

  it("checks the backup first, and tags only after the smoke", () => {
    const { steps } = release().jobs.promote;
    const backup = stepIndex(
      steps,
      (step) => step.run?.includes("deploy/backup-fresh.sh") ?? false,
    );
    const redeploy = stepIndex(
      steps,
      (step) => step.run?.includes("deploy/release-redeploy.sh") ?? false,
    );
    const smoke = stepIndex(
      steps,
      (step) => step.run?.includes("deploy/await-release.sh") ?? false,
    );
    const tag = stepIndex(steps, (step) => step.run?.includes("git push origin") ?? false);

    expect(steps[backup]?.if).toEqual("needs.gate.outputs.trigger == 'nightly'");
    expect([backup >= 0, backup < redeploy, redeploy < smoke, smoke < tag]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("reads the switch the runbook tells the owner to set", () => {
    const ask = release().jobs.gate.steps.find((step) => step.id === "ask");

    expect(ask?.env?.["RELEASE_MODE"]).toEqual("${{ vars.RELEASE_MODE }}");
    expect(readFileSync(path.join(repositoryRoot, "docs/operations/RUNBOOK.md"), "utf8")).toContain(
      "gh variable set RELEASE_MODE --body nightly",
    );
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
