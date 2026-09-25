import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import {
  type ImageStep,
  matrixLegs,
  readWorkflow,
  repositoryRoot,
  workflowStepSchema,
} from "./image-probe.ts";

const permissionsSchema = z.record(z.string(), z.string());

const scheduleSchema = z.object({
  on: z.object({ schedule: z.array(z.object({ cron: z.string() })) }),
});

const scanWorkflowSchema = z.object({
  on: z.record(z.string(), z.unknown()),
  permissions: permissionsSchema,
  jobs: z.object({
    tiers: z.object({
      permissions: permissionsSchema.optional(),
      steps: z.array(workflowStepSchema),
    }),
    trivy: z.object({
      needs: z.string(),
      permissions: permissionsSchema,
      strategy: z.object({
        "fail-fast": z.boolean(),
        matrix: z.object({ tier: z.string() }),
      }),
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

const scanStepUsing = (action: string): ImageStep => {
  const found = scanWorkflow().jobs.trivy.steps.find((step) =>
    (step.uses ?? "").startsWith(`${action}@`),
  );
  if (found === undefined) throw new Error(`scan.yml's trivy job runs no \`${action}\``);
  return found;
};

const input = (step: ImageStep, name: string): unknown => step.with?.[name];

const recordSchema = z.record(z.string(), z.unknown());

/** The two forms of yq path the tiers job uses, `.key` and `.key[]`, and nothing wider. */
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
          return Array.isArray(child) ? child : [];
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

/** The step's own script under bash, with `gh` answering from the pages given, or refusing. */
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

/**
 * Read from the api package: an image, then the two manifests its provenance push wrote after it.
 */
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
    const build = parse(
      readFileSync(path.join(repositoryRoot, ".github/workflows/build.yml"), "utf8"),
    );

    expect(matrixLegs().length).toBeGreaterThan(2);
    expect(valuesAt(build, tiers.env?.[TIERS_VARIABLE] ?? "")).toEqual(
      matrixLegs().map((leg) => leg.tier),
    );
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

  it("scans the resolved digest, which no later push moves", () => {
    expect(input(scanStepUsing("aquasecurity/trivy-action"), "image-ref")).toEqual(
      "ghcr.io/${{ github.repository_owner }}/${{ matrix.tier }}@${{ steps.image.outputs.digest }}",
    );
  });

  it("holds the scan's three permissions on its own job alone", () => {
    expect(scanWorkflow().permissions).toEqual({ contents: "read" });
    expect(scanWorkflow().jobs.tiers.permissions).toBeUndefined();
    expect(scanWorkflow().jobs.trivy.permissions).toEqual({
      contents: "read",
      packages: "read",
      "security-events": "write",
    });
  });

  it("reports to code scanning and gates nothing, exiting zero", () => {
    const trivy = scanStepUsing("aquasecurity/trivy-action");
    const upload = scanStepUsing("github/codeql-action/upload-sarif");

    expect(Object.keys(scanWorkflow().on).sort()).toEqual(["schedule", "workflow_dispatch"]);
    expect(input(trivy, "exit-code")).toEqual("0");
    expect(input(trivy, "format")).toEqual("sarif");
    expect(input(trivy, "output")).toEqual("${{ matrix.tier }}.sarif");
    expect(input(upload, "sarif_file")).toEqual("${{ matrix.tier }}.sarif");
    expect(input(upload, "category")).toEqual("image-${{ matrix.tier }}");
  });

  it("runs each night after the mutation run has started", () => {
    expect(cronOf("scan.yml")).toBeGreaterThan(cronOf("mutation.yml"));
  });

  it("names the scanner's release rather than taking the action's default", () => {
    expect(input(scanStepUsing("aquasecurity/trivy-action"), "version")).toMatch(
      /^v\d+\.\d+\.\d+$/,
    );
  });
});
