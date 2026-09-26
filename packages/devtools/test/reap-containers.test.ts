import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { containerState, holdAContainer, removeContainers } from "./held-containers.ts";

const repositoryRoot = path.join(import.meta.dirname, "../../..");
const script = path.join(repositoryRoot, "scripts/reap-containers.mjs");

const scratch = mkdtempSync(path.join(tmpdir(), "reap-containers-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

type Run = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

const reap = (argv: readonly string[], env: Readonly<Record<string, string>> = {}): Run => {
  const ran = spawnSync(process.execPath, [script, ...argv], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
};

type Listed = {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly session?: string;
  readonly ryuk?: string;
};

/** The lines `docker ps` answers the reaper's format with. */
const listing = (listed: readonly Listed[]): string =>
  listed.map((one) => `${JSON.stringify({ session: "", ryuk: "", ...one })}\n`).join("");

type Daemon = { readonly env: Readonly<Record<string, string>>; readonly calls: () => string[] };

/**
 * A logging `docker` ahead of the real one on PATH: it refuses to remove an id starting `refused`
 * and has already lost one starting `vanished`.
 */
const daemonAnswering = (name: string, psOutput: string, psExit = 0): Daemon => {
  const bin = path.join(scratch, `${name}-bin`);
  const canned = path.join(scratch, `${name}-ps.txt`);
  const log = path.join(scratch, `${name}.log`);
  mkdirSync(bin);
  writeFileSync(canned, psOutput);
  const docker = path.join(bin, "docker");
  writeFileSync(
    docker,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
case "$1" in
  ps) cat "${canned}"; exit ${String(psExit)} ;;
  rm)
    case "$4" in
      refused*) echo "Error response from daemon: removal of $4 is already in progress" >&2; exit 1 ;;
      vanished*) echo "Error response from daemon: No such container: $4" >&2; exit 1 ;;
    esac ;;
esac
exit 0
`,
  );
  chmodSync(docker, 0o755);
  return {
    env: { PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}` },
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter((line) => line !== "")
        : [],
  };
};

const removals = (daemon: Daemon): string[] =>
  daemon.calls().filter((call) => call.startsWith("rm "));

describe("reap-containers", () => {
  it("removes only stopped containers no running Ryuk still serves", () => {
    const daemon = daemonAnswering(
      "mixed",
      listing([
        {
          id: "a1",
          name: "testcontainers-ryuk-live",
          state: "running",
          session: "live",
          ryuk: "true",
        },
        { id: "a2", name: "warm_postgres", state: "exited", session: "live" },
        { id: "b1", name: "killed_garage", state: "exited", session: "gone" },
        { id: "b2", name: "unreaped_postgres", state: "running", session: "gone" },
        {
          id: "c1",
          name: "testcontainers-ryuk-stopped",
          state: "exited",
          session: "stopped",
          ryuk: "true",
        },
        { id: "c2", name: "stopped_postgres", state: "dead", session: "stopped" },
        { id: "d1", name: "testcontainers-ryuk-5b0c-python", state: "running" },
        { id: "d2", name: "worker_postgres", state: "exited", session: "5b0c-python" },
        { id: "e1", name: "reused_postgres", state: "exited" },
      ]),
    );

    const run = reap([], daemon.env);

    expect(run).toMatchObject({ status: 0, stderr: "" });
    expect(removals(daemon)).toEqual([
      "rm --force --volumes b1",
      "rm --force --volumes c1",
      "rm --force --volumes c2",
    ]);
    expect(run.stdout).toContain("3 removed, 6 spared");
  });

  it("removes nothing on a dry run", () => {
    const daemon = daemonAnswering(
      "dry",
      listing([{ id: "b1", name: "killed_garage", state: "exited", session: "gone" }]),
    );

    const run = reap(["--dry-run"], daemon.env);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("would remove b1 killed_garage (session gone, exited)");
    expect(removals(daemon)).toEqual([]);
  });

  it("counts a vanished container gone and a refused removal failed", () => {
    const daemon = daemonAnswering(
      "refusing",
      listing([
        { id: "refused1", name: "stuck_postgres", state: "exited", session: "gone" },
        { id: "vanished1", name: "raced_garage", state: "exited", session: "gone" },
      ]),
    );

    const run = reap([], daemon.env);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("removed vanished1 raced_garage");
    expect(run.stdout).toContain("1 removed, 0 spared");
    expect(run.stderr).toContain("could not remove refused1 stuck_postgres");
  });

  it("removes nothing when the daemon cannot list its containers", () => {
    const daemon = daemonAnswering(
      "unlisted",
      listing([{ id: "b1", name: "killed_garage", state: "exited", session: "gone" }]),
      1,
    );

    const run = reap([], daemon.env);

    expect(run.status).toBe(1);
    expect(removals(daemon)).toEqual([]);
  });

  it("removes nothing from a listing it cannot read", () => {
    const daemon = daemonAnswering("unreadable", "b1 killed_garage exited gone\n");

    const run = reap([], daemon.env);

    expect(run.status).toBe(1);
    expect(removals(daemon)).toEqual([]);
  });

  it("refuses an argument it does not know", () => {
    const daemon = daemonAnswering("unknown", "");

    const run = reap(["--all"], daemon.env);

    expect(run.status).toBe(2);
    expect(daemon.calls()).toEqual([]);
  });

  it("spares a live run's container and names an ended run's", async () => {
    const live = holdAContainer();
    // With Ryuk off, nothing clears the container once its process is gone and it has stopped.
    const ended = holdAContainer({ TESTCONTAINERS_RYUK_DISABLED: "true" });
    const settled = await Promise.allSettled([live.container, ended.container]);
    const held = settled.flatMap((one) => (one.status === "fulfilled" ? [one.value] : []));
    try {
      const [liveContainer, endedContainer] = await Promise.all([live.container, ended.container]);
      ended.process.kill("SIGKILL");
      spawnSync("docker", ["stop", "--time", "0", endedContainer], { encoding: "utf8" });

      const run = reap(["--dry-run"]);

      expect(run.status).toBe(0);
      expect(run.stdout).toContain(`would remove ${endedContainer.slice(0, 12)} `);
      expect(run.stdout).not.toContain(liveContainer.slice(0, 12));
      expect(containerState(endedContainer)).toBe("exited");
    } finally {
      live.process.kill("SIGKILL");
      ended.process.kill("SIGKILL");
      removeContainers(held);
    }
  });
});
