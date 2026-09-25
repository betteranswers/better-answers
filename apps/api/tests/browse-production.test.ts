import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { writeUnder } from "@better-answers/devtools/throwaway-tree";

import { freePort, type Held, heldPort, released } from "./loopback-port.ts";
import {
  recordsItsArgv,
  repositoryHolding,
  scratchRoot,
  stubsOnPath,
  worktreeUnder,
} from "./worktree-hooks.ts";

const helper = path.resolve(import.meta.dirname, "../../../deploy/browse-production.sh");

const scratch = scratchRoot("browse-production");

const TARGET = "operator@vpc1.example.invalid";
const PUBLISHED_PORT = "5999";
const key = path.join(scratch, "id_vpc1");
writeFileSync(key, "not a real key\n");

const estateText = (lines: readonly string[]): string =>
  [
    "# Coolify — the estate's own half",
    "",
    "## Browsing production",
    "",
    "```",
    ...lines,
    "```",
    "",
  ].join("\n");

const estateFile = (name: string, lines: readonly string[]): string => {
  const file = path.join(scratch, `${name}.md`);
  writeFileSync(file, estateText(lines));
  return file;
};

const everyValue = estateFile("every-value", [
  `VPC1_SSH_TARGET=${TARGET}`,
  `VPC1_SSH_KEY=${key}`,
  `VPC1_DATABASE_PORT=${PUBLISHED_PORT}`,
]);

type Run = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly sshArgv: string | undefined;
};

let runs = 0;

const browse = (env: Readonly<Record<string, string>>, script: string = helper): Run => {
  runs += 1;
  const log = path.join(scratch, `ssh-${String(runs)}.log`);
  const bin = stubsOnPath(path.join(scratch, `bin-${String(runs)}`), {
    ssh: recordsItsArgv(log),
  });
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}`, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    sshArgv: existsSync(log) ? readFileSync(log, "utf8").trim() : undefined,
  };
};

describe("the production browsing helper", () => {
  let port: number;
  let opened: Run;

  beforeAll(async () => {
    port = await freePort();
    opened = browse({ ESTATE_FILE: everyValue, BROWSE_PORT: String(port) });
  });

  it("opens a loopback SSH forward to the database, with keepalives", () => {
    expect({ status: opened.status, stderr: opened.stderr }).toEqual({ status: 0, stderr: "" });
    const argv = opened.sshArgv ?? "";
    expect(argv).toContain(`-L 127.0.0.1:${String(port)}:127.0.0.1:5999`);
    expect(argv).toContain("-N");
    expect(argv).toContain("-o ServerAliveInterval=15 -o ServerAliveCountMax=4");
    expect(argv).toContain("-o ExitOnForwardFailure=yes");
    expect(argv).toContain(`-o IdentitiesOnly=yes -i ${key}`);
    expect(argv.endsWith(" operator@vpc1.example.invalid")).toBe(true);
  });

  it("says where a GUI points and that Ctrl-C closes it", () => {
    expect(opened.stdout).toContain(`127.0.0.1:${String(port)}`);
    expect(opened.stdout).toContain("browse_ro");
    expect(opened.stdout).toContain("better_answers");
    expect(opened.stdout).toContain("Ctrl-C closes it");
  });

  it("states neither the address, SSH user, key nor published port", () => {
    const said = `${opened.stdout}${opened.stderr}`;
    const stated = ["vpc1.example.invalid", "operator", key].filter((value) =>
      said.includes(value),
    );
    expect({ stated, port: new RegExp(`\\b${PUBLISHED_PORT}\\b`).test(said) }).toEqual({
      stated: [],
      port: false,
    });
  });

  it("leaves the key to ssh when the file names none", async () => {
    const run = browse({
      ESTATE_FILE: estateFile("no-key", [
        `VPC1_SSH_TARGET=${TARGET}`,
        `VPC1_DATABASE_PORT=${PUBLISHED_PORT}`,
      ]),
      BROWSE_PORT: String(await freePort()),
    });
    expect(run.status).toBe(0);
    expect(run.sshArgv).not.toContain("-i ");
    expect(run.sshArgv).not.toContain("IdentitiesOnly");
  });

  it("defaults to the main checkout's private file, even in worktrees", async () => {
    const checkout = repositoryHolding(path.join(scratch, "checkout"), {
      "deploy/browse-production.sh": readFileSync(helper, "utf8"),
    });
    writeUnder(
      checkout,
      ".planning/estate/coolify.md",
      estateText([`VPC1_SSH_TARGET=${TARGET}`, `VPC1_DATABASE_PORT=${PUBLISHED_PORT}`]),
    );
    const worktree = worktreeUnder(scratch, checkout, "browse");
    const reached = [];
    for (const tree of [checkout, worktree]) {
      const run = browse(
        { BROWSE_PORT: String(await freePort()) },
        path.join(tree, "deploy/browse-production.sh"),
      );
      reached.push({ status: run.status, target: run.sshArgv?.endsWith(` ${TARGET}`) ?? false });
    }
    expect(reached).toEqual([
      { status: 0, target: true },
      { status: 0, target: true },
    ]);
  });

  describe("what it refuses before any SSH is started", () => {
    let taken: Held;

    beforeAll(async () => {
      taken = await heldPort();
    });

    afterAll(async () => {
      await released(taken);
    });

    it("refuses a local port something already listens on, naming it", () => {
      const run = browse({ ESTATE_FILE: everyValue, BROWSE_PORT: String(taken.port) });
      expect({ status: run.status, ssh: run.sshArgv }).toEqual({ status: 1, ssh: undefined });
      expect(run.stderr).toContain(`127.0.0.1:${String(taken.port)} is taken`);
    });

    it("refuses a missing private file, naming where it looked", async () => {
      const nowhere = path.join(scratch, "no-such-estate.md");
      const run = browse({ ESTATE_FILE: nowhere, BROWSE_PORT: String(await freePort()) });
      expect({ status: run.status, ssh: run.sshArgv }).toEqual({ status: 1, ssh: undefined });
      expect(run.stderr).toContain(nowhere);
    });

    it("refuses a missing value by name, leaking nothing else", async () => {
      const run = browse({
        ESTATE_FILE: estateFile("no-port", [`VPC1_SSH_TARGET=${TARGET}`, `VPC1_SSH_KEY=${key}`]),
        BROWSE_PORT: String(await freePort()),
      });
      expect({ status: run.status, ssh: run.sshArgv }).toEqual({ status: 1, ssh: undefined });
      expect(run.stderr).toContain("VPC1_DATABASE_PORT");
      expect(run.stderr).not.toContain("vpc1.example.invalid");
    });

    it("refuses a value written twice, as either could be meant", async () => {
      const run = browse({
        ESTATE_FILE: estateFile("twice", [
          `VPC1_SSH_TARGET=${TARGET}`,
          "VPC1_SSH_TARGET=someone@elsewhere.example.invalid",
          `VPC1_DATABASE_PORT=${PUBLISHED_PORT}`,
        ]),
        BROWSE_PORT: String(await freePort()),
      });
      expect({ status: run.status, ssh: run.sshArgv }).toEqual({ status: 1, ssh: undefined });
      expect(run.stderr).toContain("VPC1_SSH_TARGET");
      expect(run.stderr).not.toContain("elsewhere");
    });

    it("refuses a value of the wrong shape, naming the value", async () => {
      const shapes = [
        ["VPC1_DATABASE_PORT", [`VPC1_SSH_TARGET=${TARGET}`, "VPC1_DATABASE_PORT=5999; true"]],
        ["VPC1_DATABASE_PORT", [`VPC1_SSH_TARGET=${TARGET}`, "VPC1_DATABASE_PORT=70000"]],
        ["VPC1_SSH_TARGET", ["VPC1_SSH_TARGET=vpc1.example.invalid", "VPC1_DATABASE_PORT=5999"]],
        [
          "VPC1_SSH_KEY",
          [
            `VPC1_SSH_TARGET=${TARGET}`,
            `VPC1_SSH_KEY=${path.join(scratch, "no-such-key")}`,
            "VPC1_DATABASE_PORT=5999",
          ],
        ],
      ] as const;
      const port = await freePort();
      const refused = shapes.map(([named, lines], index) => {
        const run = browse({
          ESTATE_FILE: estateFile(`shape-${String(index)}`, lines),
          BROWSE_PORT: String(port),
        });
        return { named, status: run.status, ssh: run.sshArgv, names: run.stderr.includes(named) };
      });
      expect(refused).toEqual(
        shapes.map(([named]) => ({ named, status: 1, ssh: undefined, names: true })),
      );
    });

    it("refuses a local port that is not a port", () => {
      const run = browse({ ESTATE_FILE: everyValue, BROWSE_PORT: "55433x" });
      expect({ status: run.status, ssh: run.sshArgv }).toEqual({ status: 1, ssh: undefined });
      expect(run.stderr).toContain("BROWSE_PORT");
    });
  });
});
