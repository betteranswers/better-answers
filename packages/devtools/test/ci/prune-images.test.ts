import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { deployScript, PATH_ONLY, type Ran, ran, scratchDirectory } from "./script-stand-ins.ts";

const scratch = scratchDirectory("prune-images-");

const STUB_DOCKER = readFileSync(path.join(import.meta.dirname, "docker-stand-in.sh"), "utf8");

const STUB_DATE = "#!/usr/bin/env bash\nprintf '2026-10-22T01:30:00Z\\n'\n";
const STUB_DF =
  "#!/usr/bin/env bash\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/vda1 120791536 49526530 71265006 41%% /\\n'\n";

const API = "ghcr.io/betteranswers/api";
const WORKER = "ghcr.io/betteranswers/worker";
const BACKUP = "ghcr.io/betteranswers/backup";
const POSTGRES = "docker.io/pgvector/pgvector";

const id = (hex: string): string => `sha256:${hex.repeat(64)}`;
const short = (hex: string): string => hex.repeat(12);

type Image = {
  readonly repository: string;
  readonly tag: string;
  readonly hex: string;
  readonly created: string;
};
type Container = {
  readonly name: string;
  readonly hex: string;
  readonly ref: string;
  readonly state: string;
};

const IMAGES: readonly Image[] = [
  { repository: API, tag: "<none>", hex: "f", created: "2026-10-21 10:37:50 +0000 UTC" },
  { repository: API, tag: "<none>", hex: "2", created: "2026-10-21 02:48:04 +0000 UTC" },
  { repository: API, tag: "<none>", hex: "3", created: "2026-10-20 18:34:34 +0000 UTC" },
  { repository: API, tag: "<none>", hex: "4", created: "2026-10-19 08:01:12 +0000 UTC" },
  { repository: API, tag: "<none>", hex: "5", created: "2026-10-10 09:15:00 +0000 UTC" },
  { repository: API, tag: "sha-5a5a5a5", hex: "5", created: "2026-10-10 09:15:00 +0000 UTC" },
  { repository: WORKER, tag: "<none>", hex: "6", created: "2026-10-21 00:26:45 +0000 UTC" },
  { repository: WORKER, tag: "<none>", hex: "7", created: "2026-10-20 19:15:05 +0000 UTC" },
  { repository: WORKER, tag: "<none>", hex: "8", created: "2026-10-01 07:00:00 +0000 UTC" },
  { repository: BACKUP, tag: "<none>", hex: "9", created: "2026-10-01 13:49:38 +0000 UTC" },
  { repository: POSTGRES, tag: "0.8.4-pg18", hex: "a", created: "2026-08-01 00:00:00 +0000 UTC" },
  { repository: POSTGRES, tag: "0.8.5-pg18", hex: "b", created: "2026-09-01 00:00:00 +0000 UTC" },
  { repository: POSTGRES, tag: "0.8.6-pg18", hex: "c", created: "2026-10-01 00:00:00 +0000 UTC" },
];

const CONTAINERS: readonly Container[] = [
  { name: "api", hex: "2", ref: `${API}@${id("2")}`, state: "running" },
  { name: "migrate", hex: "6", ref: `${WORKER}@${id("6")}`, state: "exited" },
  { name: "backup", hex: "9", ref: `${BACKUP}@${id("9")}`, state: "running" },
];

const HELPER: Container = {
  name: "tcuvd10cyf5siqc1vxggqlwl",
  hex: "d",
  ref: "coollabsio/coolify-helper:1.0.16",
  state: "running",
};

type Box = { readonly state: string; readonly env: Readonly<Record<string, string>> };

const box = (containers: readonly Container[] = CONTAINERS): Box => {
  const state = mkdtempSync(path.join(scratch, "box-"));
  const bin = path.join(state, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "docker"), STUB_DOCKER, { mode: 0o755 });
  writeFileSync(path.join(bin, "date"), STUB_DATE, { mode: 0o755 });
  writeFileSync(path.join(bin, "df"), STUB_DF, { mode: 0o755 });
  writeFileSync(
    path.join(state, "images"),
    [...IMAGES]
      .reverse()
      .map((image) => `${image.repository}\t${image.tag}\t${id(image.hex)}\t${image.created}\n`)
      .join(""),
  );
  writeFileSync(
    path.join(state, "containers"),
    containers
      .map(
        (container) =>
          `${container.name}\t${id(container.hex)}\t${container.ref}\t${container.state}\n`,
      )
      .join(""),
  );
  writeFileSync(path.join(state, "calls"), "");
  writeFileSync(path.join(state, "removed"), "");
  return { state, env: { PATH: `${bin}:${PATH_ONLY.PATH}`, STUB_STATE: state } };
};

const prune = (on: Box, args: readonly string[] = []): Promise<Ran> =>
  ran(deployScript("prune-images.sh"), args, on.env);

const removed = (on: Box): string => readFileSync(path.join(on.state, "removed"), "utf8");
const calls = (on: Box): string => readFileSync(path.join(on.state, "calls"), "utf8");
const lines = (...entries: readonly string[]): string =>
  entries.map((entry) => `${entry}\n`).join("");

describe("the nightly image prune", () => {
  it("keeps images in use and two newest unused per repository", async () => {
    const on = box();

    expect(await prune(on)).toEqual({
      code: 0,
      out: `2026-10-22T01:30:00Z prune-images: kept 7 and removed 2 (api@${short("4")} api@${short("5")}), disk 41% -> 41%\n`,
      err: "",
    });
    expect(removed(on)).toBe(lines(id("4"), id("5")));
  });

  it("keeps as many unused images as --keep names", async () => {
    const on = box();

    expect((await prune(on, ["--keep", "1"])).code).toBe(0);
    expect(removed(on)).toBe(lines(id("3"), id("4"), id("5"), id("8")));
  });

  it("prints the plan and removes nothing on a dry run", async () => {
    const on = box();
    const row = (action: string, repository: string, hex: string, reason?: string): string =>
      [action, repository, id(hex), IMAGES.find((image) => image.hex === hex)?.created, reason]
        .filter((field) => field !== undefined)
        .join("\t");

    expect(await prune(on, ["--dry-run"])).toEqual({
      code: 0,
      out: lines(
        row("keep", API, "f", "recent"),
        row("keep", API, "2", "in use"),
        row("keep", API, "3", "recent"),
        row("remove", API, "4"),
        row("remove", API, "5"),
        row("keep", BACKUP, "9", "in use"),
        row("keep", WORKER, "6", "in use"),
        row("keep", WORKER, "7", "recent"),
        row("keep", WORKER, "8", "recent"),
        `2026-10-22T01:30:00Z prune-images: dry run: would keep 7 and remove 2 (api@${short("4")} api@${short("5")}), disk 41%`,
      ),
      err: "",
    });
    expect(removed(on)).toBe("");
  });

  it("skips the night while a Coolify deployment runs", async () => {
    const on = box([...CONTAINERS, HELPER]);

    expect(await prune(on)).toEqual({
      code: 0,
      out: "2026-10-22T01:30:00Z prune-images: skipped: a Coolify deployment is running, so its images may not be in use yet\n",
      err: "",
    });
    expect(removed(on)).toBe("");
  });

  it("removes nothing on a second run", async () => {
    const on = box();
    await prune(on);
    writeFileSync(path.join(on.state, "removed"), "");

    expect(await prune(on)).toEqual({
      code: 0,
      out: "2026-10-22T01:30:00Z prune-images: kept 7 and removed 0 (none), disk 41% -> 41%\n",
      err: "",
    });
    expect(removed(on)).toBe("");
  });

  it("refuses a --keep that is not a whole number", async () => {
    const on = box();

    expect(await prune(on, ["--keep", "two"])).toEqual({
      code: 2,
      out: "",
      err: "usage: prune-images.sh [--dry-run] [--keep <unused images kept per repository, default 2>]\n",
    });
    expect(calls(on)).toBe("");
  });
});
