/* jscpd:ignore-start */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assert, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";
import {
  type ImageStep,
  matrixLegs,
  readWorkflow,
  workflowStepSchema,
} from "@better-answers/devtools/workflows";
/* jscpd:ignore-end */

const scheduleSchema = z.object({
  on: z.object({ schedule: z.array(z.object({ cron: z.string() })) }),
});

const scanWorkflowSchema = z.object({
  jobs: z.object({
    tiers: z.object({
      steps: z.array(workflowStepSchema),
    }),
    trivy: z.object({
      needs: z.string(),
      strategy: z.object({
        "fail-fast": z.boolean(),
        matrix: z.object({ tier: z.string() }),
      }),
      steps: z.array(workflowStepSchema),
    }),
    alerts: z.object({
      needs: z.string(),
      if: z.string(),
      permissions: z.record(z.string(), z.string()),
      steps: z.array(workflowStepSchema),
    }),
  }),
});

const scanWorkflow = () => readWorkflow("scan.yml", scanWorkflowSchema);

const TIERS_VARIABLE = "TIERS";
const NEWEST_BUILD_VARIABLE = "NEWEST_BUILD";

const carrying = (steps: readonly ImageStep[], variable: string): ImageStep => {
  const found = steps.find((step) => step.env?.[variable] !== undefined);
  if (found === undefined) throw new Error(`scan.yml has no step carrying \`${variable}\``);
  return found;
};

const tiersStep = () => carrying(scanWorkflow().jobs.tiers.steps, TIERS_VARIABLE);
const resolveStep = () => carrying(scanWorkflow().jobs.trivy.steps, NEWEST_BUILD_VARIABLE);

const recordSchema = z.record(z.string(), z.unknown());

const valuesAt = (document: unknown, yqPath: string): readonly unknown[] =>
  yqPath
    .split(".")
    .filter((segment) => segment !== "")
    .reduce<readonly unknown[]>(
      (values, segment) =>
        values.flatMap((value) => {
          const iterates = segment.endsWith("[]");
          const key = iterates ? segment.slice(0, -2) : segment;
          const record = recordSchema.safeParse(value);
          const child = record.success ? record.data[key] : undefined;
          if (!iterates) return [child];
          return z.array(z.unknown()).catch([]).parse(child);
        }),
      [document],
    );

type Resolved = {
  readonly status: number | null;
  readonly asked: string;
  readonly output: string;
  readonly summary: string;
  readonly log: string;
};

const resolveAgainst = (pages: unknown): Resolved => {
  const step = resolveStep();
  const directory = mkdtempSync(path.join(tmpdir(), "scan-resolve-"));
  const file = (name: string) => path.join(directory, name);
  try {
    writeFileSync(file("pages.json"), JSON.stringify(pages ?? null));
    for (const written of ["asked", "output", "summary"]) writeFileSync(file(written), "");
    writeFileSync(
      file("gh"),
      pages === undefined
        ? "#!/bin/sh\necho 'HTTP 403: Resource not accessible by integration' >&2\nexit 1\n"
        : `#!/bin/sh\nprintf '%s\\n' "$*" > '${file("asked")}'\ncat '${file("pages.json")}'\n`,
      { mode: 0o755 },
    );
    const ran = spawnSync(
      "bash",
      ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", step.run ?? ""],
      {
        encoding: "utf8",
        env: {
          PATH: `${directory}${path.delimiter}${process.env["PATH"] ?? ""}`,
          OWNER: "betteranswers",
          TIER: "api",
          [NEWEST_BUILD_VARIABLE]: step.env?.[NEWEST_BUILD_VARIABLE] ?? "",
          GITHUB_OUTPUT: file("output"),
          GITHUB_STEP_SUMMARY: file("summary"),
        },
      },
    );
    expect(ran.error, "bash did not start").toBeUndefined();
    return {
      status: ran.status,
      asked: readFileSync(file("asked"), "utf8").trim(),
      output: readFileSync(file("output"), "utf8"),
      summary: readFileSync(file("summary"), "utf8"),
      log: ran.stdout + ran.stderr,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const version = (name: string, createdAt: string, tags: readonly string[]) => ({
  name,
  created_at: createdAt,
  updated_at: createdAt,
  metadata: { package_type: "container", container: { tags } },
});

const IMAGE = version(
  "sha256:317ef2837f4ce3105d418849237c9e914477b44e6b5b9767671ca49bc2fdc173",
  "2026-09-23T15:29:50Z",
  ["sha-3f5f107"],
);
const UNTAGGED = version(
  "sha256:cb437198fee9954d371074dd317847bb00a1b182cc496d0bc12909f1942c0751",
  "2026-09-23T15:29:55Z",
  [],
);
const REFERRER = version(
  "sha256:498926eded031e5e6fcd2f2b8328d4fd23da6ddce83293bbda78c986b1ae24e8",
  "2026-09-23T15:29:56Z",
  ["sha256-317ef2837f4ce3105d418849237c9e914477b44e6b5b9767671ca49bc2fdc173"],
);
const IMAGE_BEFORE = version(
  "sha256:b243c9d4b1c0e31b86fbc3f98ae3d0525b6adf91fafa807007c89bfda308df7e",
  "2026-09-23T15:03:39Z",
  ["sha-b4b0865"],
);

const minuteOfTheDay = (cron: string): number => {
  const fields = /^(?<minute>\d+) (?<hour>\d+) \* \* \*$/.exec(cron)?.groups;
  if (fields === undefined) throw new Error(`\`${cron}\` is not a once-a-day schedule`);
  return Number(fields["hour"]) * 60 + Number(fields["minute"]);
};

const cronOf = (file: string): number => {
  const [first] = readWorkflow(file, scheduleSchema).on.schedule;
  if (first === undefined) throw new Error(`${file} has no schedule`);
  return minuteOfTheDay(first.cron);
};

describe("the nightly scan of the images build.yml pushes", () => {
  it("scans one leg per image, reading the tiers from build.yml", () => {
    const tiers = tiersStep();
    const build: unknown = parse(
      readFileSync(path.join(repositoryRoot, ".github/workflows/build.yml"), "utf8"),
    );

    expect(matrixLegs().length).toBeGreaterThan(2);
    const tiersAt = tiers.env?.[TIERS_VARIABLE];
    assert(tiersAt !== undefined, `the tiers step sets ${TIERS_VARIABLE}`);
    expect(valuesAt(build, tiersAt)).toEqual(matrixLegs().map((leg) => leg.tier));
    expect(tiers.run).toContain(`\${${TIERS_VARIABLE}}`);
    expect(tiers.run).toContain(".github/workflows/build.yml");

    const trivy = scanWorkflow().jobs.trivy;
    expect(trivy.needs).toEqual("tiers");
    expect(trivy.strategy.matrix.tier).toEqual("${{ fromJSON(needs.tiers.outputs.tiers) }}");
    expect(trivy.strategy["fail-fast"]).toBe(false);
  });

  it("scans each package's newest sha-tagged version, not its signature", () => {
    const newestFirst = resolveAgainst([[REFERRER, UNTAGGED, IMAGE], [IMAGE_BEFORE]]);
    const oldestFirst = resolveAgainst([[IMAGE_BEFORE], [UNTAGGED, IMAGE, REFERRER]]);

    expect(newestFirst.status, `the step went red: ${newestFirst.log}`).toBe(0);
    expect(newestFirst.asked).toEqual(
      "api --paginate --slurp orgs/betteranswers/packages/container/api/versions?per_page=100",
    );
    expect(newestFirst.output).toEqual(
      "digest=sha256:317ef2837f4ce3105d418849237c9e914477b44e6b5b9767671ca49bc2fdc173\n",
    );
    expect(newestFirst.summary).toContain("`sha-3f5f107`");
    expect(oldestFirst.output).toEqual(newestFirst.output);
  });

  it("refuses a package with no sha-tagged version, scanning nothing", () => {
    const resolved = resolveAgainst([[REFERRER, UNTAGGED]]);

    expect(resolved.status).toBe(1);
    expect(resolved.output).toEqual("");
    expect(resolved.log).toContain("holds no sha- tagged version");
  });

  it("goes red, naming the package, when listing its versions fails", () => {
    const resolved = resolveAgainst(undefined);

    expect(resolved.status).toBe(1);
    expect(resolved.output).toEqual("");
    expect(resolved.log).toContain("ghcr.io/betteranswers/api's versions");
  });

  it("runs each night after the mutation run has started", () => {
    expect(cronOf("scan.yml")).toBeGreaterThan(cronOf("mutation.yml"));
  });
});

const publishedSchema = z.object({
  run: z.string(),
  open: z.array(z.object({ number: z.number(), severity: z.string(), message: z.string() })),
  fixable: z.array(z.object({ number: z.number() })),
});

type Published = {
  readonly status: number | null;
  readonly calls: readonly string[];
  readonly alerts: z.infer<typeof publishedSchema>;
  readonly commit: unknown;
  readonly log: string;
};

const alert = (
  number: number,
  location: string,
  fixedVersion: string,
  fixedAt: string | null = null,
) => ({
  number,
  created_at: "2026-10-25T08:42:19Z",
  state: "dismissed",
  fixed_at: fixedAt,
  dismissed_comment: "Unreachable (none): nothing runs it",
  html_url: `https://github.com/betteranswers/better-answers/security/code-scanning/${number}`,
  rule: { id: `CVE-2026-${number}`, security_severity_level: "high" },
  most_recent_instance: {
    category: "image-api",
    location: { path: location },
    message: { text: `Package: openssl\nSeverity: HIGH\nFixed Version: ${fixedVersion}\n` },
  },
});

const OPEN = { ...alert(7, "betteranswers/api", ""), state: "open" };
const FIXABLE_DEBIAN = alert(11, "betteranswers/api", "3.5.4-1~deb13u2");
const FIXABLE_PIN = alert(12, "app/node_modules/undici/package.json", "7.24.0");
const NO_FIX = alert(13, "betteranswers/api", "");
const BINARY = alert(14, "usr/bin/rclone", "1.72.0");
const ALREADY_FIXED = alert(15, "betteranswers/api", "3.5.4-1~deb13u2", "2026-10-20T03:50:00Z");

const publishWith = (branchExists: boolean): Published => {
  const [step] = scanWorkflow().jobs.alerts.steps;
  assert(step !== undefined, "the alerts job has a step");
  const directory = mkdtempSync(path.join(tmpdir(), "scan-alerts-"));
  const file = (name: string) => path.join(directory, name);
  try {
    writeFileSync(file("open-pages.json"), JSON.stringify([[OPEN]]));
    writeFileSync(
      file("dismissed-pages.json"),
      JSON.stringify([
        [FIXABLE_DEBIAN, NO_FIX],
        [FIXABLE_PIN, BINARY, ALREADY_FIXED],
      ]),
    );
    writeFileSync(file("calls"), "");
    writeFileSync(file("summary"), "");
    writeFileSync(
      file("gh"),
      [
        "#!/bin/sh",
        `printf '%s\\n' "$*" >> '${file("calls")}'`,
        'case "$*" in',
        `  *state=open*) cat '${file("open-pages.json")}' ;;`,
        `  *state=dismissed*) cat '${file("dismissed-pages.json")}' ;;`,
        `  *git/trees*) cat > '${file("tree.json")}'; echo tree-sha ;;`,
        `  *git/commits*) cat > '${file("commit.json")}'; echo commit-sha ;;`,
        `  *git/ref/heads/*) ${branchExists ? "exit 0" : "echo 'HTTP 404: Not Found' >&2; exit 1"} ;;`,
        "esac",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const ran = spawnSync(
      "bash",
      ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", step.run ?? ""],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...step.env,
          PATH: `${directory}${path.delimiter}${process.env["PATH"] ?? ""}`,
          REPO: "betteranswers/better-answers",
          RUN: "https://github.com/betteranswers/better-answers/actions/runs/1",
          GITHUB_STEP_SUMMARY: file("summary"),
        },
      },
    );
    expect(ran.error, "bash did not start").toBeUndefined();
    const tree = z
      .object({ tree: z.array(z.object({ path: z.string(), content: z.string() })) })
      .parse(JSON.parse(readFileSync(file("tree.json"), "utf8")));
    expect(tree.tree.map((entry) => entry.path)).toEqual(["alerts.json"]);
    return {
      status: ran.status,
      calls: readFileSync(file("calls"), "utf8").trim().split("\n"),
      alerts: publishedSchema.parse(JSON.parse(tree.tree[0]?.content ?? "null")),
      commit: JSON.parse(readFileSync(file("commit.json"), "utf8")),
      log: ran.stdout + ran.stderr + readFileSync(file("summary"), "utf8"),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe("the alerts branch the weekly triage reads", () => {
  it("runs after every scan leg, able to read code scanning", () => {
    const job = scanWorkflow().jobs.alerts;

    expect(job.needs).toEqual("trivy");
    expect(job.if).toEqual("${{ !cancelled() }}");
    expect(job.permissions).toEqual({ contents: "write", "security-events": "read" });
  });

  it("publishes open alerts and dismissed ones a fix now closes", () => {
    const published = publishWith(false);

    expect(published.status, `the step went red: ${published.log}`).toBe(0);
    expect(published.alerts.open.map((each) => each.number)).toEqual([7]);
    expect(published.alerts.open[0]?.severity).toEqual("high");
    expect(published.alerts.open[0]?.message).toContain("Package: openssl");
    expect(published.alerts.fixable.map((each) => each.number)).toEqual([11, 12]);
    expect(published.alerts.run).toEqual(
      "https://github.com/betteranswers/better-answers/actions/runs/1",
    );
    expect(published.commit).toMatchObject({ tree: "tree-sha", parents: [] });
    expect(published.log).toContain("1 open alerts and 2 dismissed ones");
  });

  it("creates the branch the first night", () => {
    const published = publishWith(false);

    expect(published.calls).toContain(
      "api repos/betteranswers/better-answers/git/refs -f ref=refs/heads/security/alerts -f sha=commit-sha --silent",
    );
  });

  it("replaces the branch's one commit every night after", () => {
    const published = publishWith(true);

    expect(published.status, `the step went red: ${published.log}`).toBe(0);
    expect(published.calls).toContain(
      "api -X PATCH repos/betteranswers/better-answers/git/refs/heads/security/alerts -f sha=commit-sha -F force=true --silent",
    );
  });
});
