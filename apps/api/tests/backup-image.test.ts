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

const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

const serverMajor = (): string => {
  const major = /-pg(\d+)-/.exec(POSTGRES_IMAGE)?.[1];
  if (major === undefined) throw new Error(`no server major in ${POSTGRES_IMAGE}`);
  return major;
};

const clientMajor = (reported: string): string | undefined =>
  /\(PostgreSQL\)\s+(\d+)\./.exec(reported)?.[1];

const scriptPath = (): string => {
  const destination = /^COPY\s+backup\.sh\s+(\S+)\s*$/m.exec(read("deploy/backup.Dockerfile"))?.[1];
  if (destination === undefined) {
    throw new Error("deploy/backup.Dockerfile no longer COPYs backup.sh to a path this can read");
  }
  return destination;
};

const scriptModes = (): readonly string[] => {
  const script = read("deploy/backup.sh");
  const block = script.slice(script.indexOf('case "${1:-}" in'), script.indexOf("\nesac"));
  const modes = [...block.matchAll(/^ {2}([a-z]+)\)/gm)].map((match) => match[1] ?? "");
  if (modes.length === 0) throw new Error("deploy/backup.sh no longer has a `case` this can read");
  return modes.sort();
};

const REQUIRED_TOOLS = [
  "rclone",
  "age",
  "git",
  "ssh",

  "jq",

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

// String.raw keeps \t and \n as the characters printf interprets; a plain literal makes
// them a real tab and newline.
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
        { tier: leg.tier, dockerfile: leg.dockerfile, context: leg.context },
        { command: ["sh", "-c", probe], environment: { PROBE_SCRIPT: scriptPath() } },
      ),
    );
  }, IMAGE_PROBE_ALLOWANCE);

  it("answers with a `pg_dump` of the database's own major version, so a restore is never refused", () => {
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
    expect(contents.scriptIsThere).toBe(true);
    expect(contents.scriptIsExecutable).toBe(true);

    expect(contents.cronEntries.length).toBeGreaterThan(0);
    expect(contents.cronEntries.every((entry) => entry.includes(scriptPath()))).toBe(true);
  });

  it("schedules exactly the jobs the script answers to, and each of them once", () => {
    const scheduled = contents.cronEntries
      .map((entry) => /backup\.sh\s+(\w+)/.exec(entry)?.[1] ?? "")
      .sort();

    expect(contents.cronIsThere).toBe(true);

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
