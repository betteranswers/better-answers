import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";

const scratch = mkdtempSync(path.join(tmpdir(), "environment-gate-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const ORCHESTRATOR = {
  HOME: "/home/node",
  TZ: "UTC",
  LC_ALL: "C.UTF-8",
  DATABASE_URL: "postgres://app:x@db:5432/ba",
  MIGRATE_DATABASE_URL: "postgres://owner:x@db:5432/ba",
  WORKER_DATABASE_URL: "postgres://worker:x@db:5432/ba",
  KEK: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  AUTH_SECRET: "authsecretauthsecretauthsecret12",
  S3_SECRET_KEY: "dummysecret",
  OBJECTSTORE_ROOT_SECRET: "dummysecret",
  NODE_ENV: "production",
  UPLOAD_SWEEP: "list",
  HF_HOME: "/data/worker/hf-cache",
  LMDB_DIR: "/data/worker/lmdb",
  SERVICE_FQDN_API: "app.example.com",
};

/** macOS adds `__CF_USER_TEXT_ENCODING` to every process it starts, so the gate never sees it. */
const keysPrinted = (stdout: string): string[] =>
  z
    .array(z.string())
    .parse(JSON.parse(stdout))
    .filter((key) => key !== "__CF_USER_TEXT_ENCODING")
    .sort();

describe("apps/api/src/environment-gate.ts", () => {
  const spy = path.join(scratch, "spy.mjs");
  writeFileSync(
    spy,
    `if (!process.argv[1].endsWith("environment-gate.ts")) {
  process.stdout.write(JSON.stringify([...Object.keys(process.env), ...process.argv.slice(2).map((arg) => "argv " + arg)]));
  process.exit(0);
}
`,
  );

  const started = (...named: string[]) =>
    spawnSync(process.execPath, ["apps/api/src/environment-gate.ts", ...named], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...ORCHESTRATOR, PATH: process.env["PATH"], NODE_OPTIONS: `--import=${spy}` },
    });

  it("starts migrate with readBootstrap's keys and the runtime's", () => {
    const run = started("migrate");

    expect(run.stderr).toBe("");
    expect(keysPrinted(run.stdout)).toEqual([
      "DATABASE_URL",
      "HOME",
      "LC_ALL",
      "NODE_ENV",
      "NODE_OPTIONS",
      "PATH",
      "TZ",
    ]);
  });

  it("starts the api with every reader's keys and no others", () => {
    const run = started("api");

    expect(run.stderr).toBe("");
    expect(keysPrinted(run.stdout)).toEqual([
      "AUTH_SECRET",
      "DATABASE_URL",
      "HOME",
      "KEK",
      "LC_ALL",
      "NODE_ENV",
      "NODE_OPTIONS",
      "PATH",
      "S3_SECRET_KEY",
      "TZ",
      "UPLOAD_SWEEP",
    ]);
  });

  it("starts ops with its readers' keys and its arguments", () => {
    const run = started("ops", "map-sweep", "--workspace", "w1");

    expect(run.stderr).toBe("");
    expect(keysPrinted(run.stdout)).toEqual([
      "AUTH_SECRET",
      "DATABASE_URL",
      "HOME",
      "KEK",
      "LC_ALL",
      "NODE_ENV",
      "NODE_OPTIONS",
      "PATH",
      "S3_SECRET_KEY",
      "TZ",
      "argv --workspace",
      "argv map-sweep",
      "argv w1",
    ]);
  });

  it("refuses a process the tier does not start", () => {
    const run = started("seed");

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("one of api, migrate, ops");
  });
});

describe("better_answers_worker.environment_gate", () => {
  const workspace = path.join(repositoryRoot, "apps", "worker");
  const python = execFileSync(
    "uv",
    ["run", "--frozen", "python", "-I", "-c", "import sys; print(sys.executable)"],
    { cwd: workspace, encoding: "utf8" },
  ).trim();
  const bin = path.join(scratch, "bin");
  const spy = `#!${python}\nimport json, os\nprint(json.dumps(list(os.environ)))\n`;
  mkdirSync(bin);
  for (const name of ["better-answers-worker", "python"]) {
    const file = path.join(bin, name);
    writeFileSync(file, spy);
    chmodSync(file, 0o755);
  }

  const started = (named: string) =>
    spawnSync(python, ["-m", "better_answers_worker.environment_gate", named], {
      cwd: workspace,
      encoding: "utf8",
      env: { ...ORCHESTRATOR, PATH: bin },
    });

  const WORKER_SEES = [
    "DATABASE_URL",
    "HF_HOME",
    "HOME",
    "LC_ALL",
    "LMDB_DIR",
    "PATH",
    "S3_SECRET_KEY",
    "TZ",
  ];

  it("starts the worker with its keys and its libraries' keys", () => {
    const run = started("worker");

    expect(run.stderr).toBe("");
    expect(keysPrinted(run.stdout)).toEqual(WORKER_SEES);
  });

  it("starts the health probe with the same keys", () => {
    const run = started("health");

    expect(run.stderr).toBe("");
    expect(keysPrinted(run.stdout)).toEqual(WORKER_SEES);
  });

  it("refuses a process the tier does not start", () => {
    const run = started("migrate");

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("one of worker, health");
  });
});
