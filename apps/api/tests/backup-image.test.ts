import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { POSTGRES_IMAGE } from "@better-answers/schema";

import {
  fileFromTheWorkspace,
  IMAGE_PROBE_ALLOWANCE,
  legFor,
  nothingToProbeHere,
  readTheImage,
  repositoryRoot,
} from "./image-probe.ts";

/**
 * The backup image's contents, asserted through a container started from it (`T-084`).
 *
 * **Why this image is probed at all, and why the probe is here rather than in
 * `deploy-tree.test.ts`.** That file already holds facts about `deploy/backup.Dockerfile`
 * — including that it is built `FROM ${POSTGRES_IMAGE}` so `pg_dump` never skews from the
 * server — but every one of them is *text about a Dockerfile*, and its own header says
 * "nothing here runs a box". Putting a `docker build` in it would falsify that sentence
 * for a reader who relies on it. So the text half stays there and the built half is here,
 * and each names the other.
 *
 * **What probing it costs, since that is the argument against.** This is the least
 * cacheable build in the repository: `apt-get update`, an rclone zip from
 * downloads.rclone.org and an age tarball from GitHub releases, all over the network at
 * build time. Cold and uncached it measured 16.9s on a laptop (08/09/2026, Docker 29.4.0,
 * arm64), and its base image is `POSTGRES_IMAGE` — the one image every Testcontainers test
 * already pulls, so a machine that has run `check` once pays no pull for it. That is what
 * `check` pays to hold the two claims below; T-084's Progress carries the measurement.
 *
 * **What it catches that the build does not.** Most of this image arrives through commands
 * that fail loudly — a missing apt package, a zip whose glob matches nothing, a tar member
 * that is not there — so the build is already a probe for "a tool is absent". What the
 * build cannot see is the pair that costs a restore: the major version `pg_dump` actually
 * answers with against the major of the one pinned database image, and a `cron` entry
 * pointing at a path this image does not have.
 */

const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

/** `pgvector/pgvector:0.8.6-pg18-trixie@sha256:…` → `18`, the server's major (`[DEPS2]`). */
const serverMajor = (): string => {
  const major = /-pg(\d+)-/.exec(POSTGRES_IMAGE)?.[1];
  if (major === undefined) throw new Error(`no server major in ${POSTGRES_IMAGE}`);
  return major;
};

/** `pg_dump (PostgreSQL) 18.6 (Debian …)` → `18`, the client's major. */
const clientMajor = (reported: string): string | undefined =>
  /\(PostgreSQL\)\s+(\d+)\./.exec(reported)?.[1];

/**
 * Where the Dockerfile puts `backup.sh`, read off its `COPY` rather than written here:
 * the destination, the `chmod` and the two `cron` entries are three statements of one
 * path, and a probe that spelled it out would agree with a fourth.
 */
const scriptPath = (): string => {
  const destination = /^COPY\s+backup\.sh\s+(\S+)\s*$/m.exec(read("deploy/backup.Dockerfile"))?.[1];
  if (destination === undefined) {
    throw new Error("deploy/backup.Dockerfile no longer COPYs backup.sh to a path this can read");
  }
  return destination;
};

/**
 * The modes `deploy/backup.sh` answers to, read off its own `case`. The cron entries are
 * held to this set both ways below: a job the script would refuse is a job that logs a
 * usage line at 02:00 and backs nothing up, and a mode the script grew that nothing
 * schedules is a job that never runs.
 */
const scriptModes = (): readonly string[] => {
  const script = read("deploy/backup.sh");
  const block = script.slice(script.indexOf('case "${1:-}" in'), script.indexOf("\nesac"));
  const modes = [...block.matchAll(/^ {2}([a-z]+)\)/gm)].map((match) => match[1] ?? "");
  if (modes.length === 0) throw new Error("deploy/backup.sh no longer has a `case` this can read");
  return modes.sort();
};

/** The tools the image is for, each named where the image's job description names it. */
const REQUIRED_TOOLS = [
  // `backup.sh nightly` mirrors the object store and pushes git bundles to VPC 2 (ADR 0024).
  "rclone",
  "age",
  "git",
  "ssh",
  // `backup.sh` reads the object store's answers and writes its `backup_run` row with it.
  "jq",
  // The image's own `CMD` is `cron -f`; without it the container starts and schedules nothing.
  "cron",
] as const;

const contentsSchema = z.object({
  pgDump: z.string(),
  resolved: z.record(z.string(), z.string()),
  scriptIsThere: z.boolean(),
  scriptIsExecutable: z.boolean(),
  cronIsThere: z.boolean(),
  cronEntries: z.array(z.string()),
});

type ImageContents = z.infer<typeof contentsSchema>;

/**
 * Read by the image's own shell. Tab-separated lines rather than JSON: the container has
 * no interpreter that builds JSON without one of the tools under test, and a probe that
 * asked `jq` to report whether `jq` is there would answer its own question.
 *
 * `String.raw` so that `\t` and `\n` reach `printf` as the two characters it interprets.
 * A plain template literal turns them into a real tab and a real newline before `sh` ever
 * sees them, and the format string then only survives because the newline happens to fall
 * inside a single-quoted word — a property of this text rather than of the code.
 */
const probe = String.raw`
printf 'pgDump\t%s\n' "$(pg_dump --version 2>&1)"
for tool in ${REQUIRED_TOOLS.join(" ")}; do
  printf 'resolved\t%s\t%s\n' "$tool" "$(command -v "$tool" || echo '')"
done
printf 'scriptIsThere\t%s\n' "$(test -f "$PROBE_SCRIPT" && echo yes || echo no)"
printf 'scriptIsExecutable\t%s\n' "$(test -x "$PROBE_SCRIPT" && echo yes || echo no)"
printf 'cronIsThere\t%s\n' "$(test -f /etc/cron.d/backup && echo yes || echo no)"
if [ -f /etc/cron.d/backup ]; then
  while IFS= read -r entry; do
    if [ -n "$entry" ]; then printf 'cronEntries\t%s\n' "$entry"; fi
  done < /etc/cron.d/backup
fi
`;

const readContents = (stdout: string): ImageContents => {
  const resolved: Record<string, string> = {};
  const cronEntries: string[] = [];
  const single: Record<string, string> = {};
  for (const line of stdout.split("\n").filter((candidate) => candidate.length > 0)) {
    const [key, first, second] = line.split("\t");
    if (key === "resolved") resolved[first ?? ""] = second ?? "";
    else if (key === "cronEntries") cronEntries.push(first ?? "");
    else single[key ?? ""] = first ?? "";
  }
  return contentsSchema.parse({
    pgDump: single["pgDump"],
    resolved,
    scriptIsThere: single["scriptIsThere"] === "yes",
    scriptIsExecutable: single["scriptIsExecutable"] === "yes",
    cronIsThere: single["cronIsThere"] === "yes",
    cronEntries,
  });
};

describe.skipIf(nothingToProbeHere)("the backup image", () => {
  let contents: ImageContents;

  beforeAll(async () => {
    const leg = legFor("backup");
    contents = readContents(
      await readTheImage(
        { dockerfile: leg.dockerfile, context: leg.context },
        { command: ["sh", "-c", probe], environment: { PROBE_SCRIPT: scriptPath() } },
      ),
    );
  }, IMAGE_PROBE_ALLOWANCE);

  it("answers with a `pg_dump` of the database's own major version, so a restore is never refused", () => {
    // The failure this exists for is silent until the day of a restore: `pg_dump` refuses
    // a server newer than itself, and a dump taken by an older client is a dump that was
    // never going to come back. `deploy-tree.test.ts` holds the Dockerfile's `FROM` to the
    // same constant; this holds the binary that `FROM` was chosen to deliver.
    expect(clientMajor(contents.pgDump)).toEqual(serverMajor());
  });

  it("resolves every tool the backup jobs run", () => {
    const missing = Object.entries(contents.resolved)
      .filter(([, where]) => where === "")
      .map(([tool]) => tool);

    expect(Object.keys(contents.resolved).sort()).toEqual([...REQUIRED_TOOLS].sort());
    expect(missing).toEqual([]);
  });

  it("carries the backup script itself, executable, where its schedule looks for it", () => {
    // Baked in, never bind-mounted: an image by digest that read its job from the checkout
    // beside it would be half an image (`deploy/backup.Dockerfile`, ADR 0022).
    expect(contents.scriptIsThere).toBe(true);
    expect(contents.scriptIsExecutable).toBe(true);
    // `every` over nothing is true, and an image with no cron file at all would otherwise
    // satisfy the line below rather than fail it.
    expect(contents.cronEntries.length).toBeGreaterThan(0);
    expect(contents.cronEntries.every((entry) => entry.includes(scriptPath()))).toBe(true);
  });

  it("schedules exactly the jobs the script answers to, and each of them once", () => {
    const scheduled = contents.cronEntries
      .map((entry) => /backup\.sh\s+(\w+)/.exec(entry)?.[1] ?? "")
      .sort();

    expect(contents.cronIsThere).toBe(true);
    // [TEST7] both ways in one comparison: a scheduled mode the script would refuse, and a
    // mode the script grew that nothing schedules, are each a difference between these.
    expect(scheduled).toEqual(scriptModes());
  });
});

describe("the backup leg of the image job", () => {
  it("names this file as its probe, so the file cannot move without the workflow", () => {
    const backup = legFor("backup");

    expect(backup.probe).toContain("@better-answers/api");
    expect(backup.probe).toContain(fileFromTheWorkspace(import.meta.url, "apps/api"));
  });
});
