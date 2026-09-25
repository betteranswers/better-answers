import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { POSTGRES_IMAGE } from "@better-answers/schema";

import {
  fileFromTheWorkspace,
  IMAGE_PROBE_ALLOWANCE,
  type ImageUnderTest,
  legFor,
  nothingToProbeHere,
  readTheImage,
  repositoryRoot,
  type StartedContainer,
  startTheImage,
} from "./image-probe.ts";

const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

const backupImage = (): ImageUnderTest => {
  const { tier, dockerfile, context } = legFor("backup");
  return { tier, dockerfile, context };
};

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
  "psql",
  "pg_dumpall",
  "pg_restore",
  "rclone",
  "age",
  "git",
  "ssh",
  "curl",
  "jq",
  "cron",
  "pgrep",
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
 * String.raw keeps \t and \n as the characters printf interprets; a plain literal makes them a
 * real tab and newline.
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

const fieldsOf = (line: string): readonly [string, string, string] => {
  const [key = "", first = "", second = ""] = line.split("\t");
  return [key, first, second];
};

const readContents = (stdout: string): ImageContents => {
  const resolved: Record<string, string> = {};
  const cronEntries: string[] = [];
  const single: Record<string, string> = {};
  for (const line of stdout.split("\n").filter((candidate) => candidate.length > 0)) {
    const [key, first, second] = fieldsOf(line);
    if (key === "resolved") resolved[first] = second;
    else if (key === "cronEntries") cronEntries.push(first);
    else single[key] = first;
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
    contents = readContents(
      await readTheImage(backupImage(), {
        command: ["sh", "-c", probe],
        environment: { PROBE_SCRIPT: scriptPath() },
      }),
    );
  }, IMAGE_PROBE_ALLOWANCE);

  it("carries a `pg_dump` of the database's own major version", () => {
    expect(clientMajor(contents.pgDump)).toEqual(serverMajor());
  });

  it("resolves every non-base tool the jobs, check and restore call", () => {
    const missing = Object.entries(contents.resolved)
      .filter(([, where]) => where === "")
      .map(([tool]) => tool);

    expect(Object.keys(contents.resolved).sort()).toEqual([...REQUIRED_TOOLS].sort());
    expect(missing).toEqual([]);
  });

  it("carries the backup script, executable, where its schedule looks", () => {
    expect(contents.scriptIsThere).toBe(true);
    expect(contents.scriptIsExecutable).toBe(true);

    expect(contents.cronEntries.length).toBeGreaterThan(0);
    expect(contents.cronEntries.every((entry) => entry.includes(scriptPath()))).toBe(true);
  });

  it("schedules exactly the script's jobs, each once", () => {
    const scheduled = contents.cronEntries
      .map((entry) => /backup\.sh\s+(\w+)/.exec(entry)?.[1] ?? "")
      .sort();

    expect(contents.cronIsThere).toBe(true);

    expect(scheduled).toEqual(scriptModes());
  });
});

const composeSchema = z.object({
  services: z.object({
    backup: z.object({ environment: z.record(z.string(), z.unknown()) }),
  }),
});

const handedToTheBackup = (): readonly string[] =>
  Object.keys(
    composeSchema.parse(parse(read("deploy/stores.compose.yaml"))).services.backup.environment,
  ).sort();

/**
 * The orchestrator hands a stack's containers every variable of its resource, and the resource's
 * variables are the ones the compose file interpolates.
 */
const storesResourceVariables = (): readonly string[] =>
  [
    ...new Set(
      [...read("deploy/stores.compose.yaml").matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)].map(
        (match) => match[1] ?? "",
      ),
    ),
  ].sort();

const JOB_PROBE_DIRECTORY = "/run/job-probe";

const jobProbe = String.raw`#!/bin/sh
{
  env | while IFS= read -r pair; do printf 'env\t%s\n' "$pair"; done
  for tool in rclone age pg_dump; do
    printf 'resolves\t%s\t%s\n' "$tool" "$(command -v "$tool" || true)"
  done
} > "${JOB_PROBE_DIRECTORY}/$1.partial"
mv "${JOB_PROBE_DIRECTORY}/$1.partial" "${JOB_PROBE_DIRECTORY}/$1"
`;

const installTheProbe = String.raw`
set -eu
mkdir -p "${JOB_PROBE_DIRECTORY}"
printf '%s' "$JOB_PROBE" > "${JOB_PROBE_DIRECTORY}/job"
chmod 0755 "${JOB_PROBE_DIRECTORY}/job"
printf '%s\n' "$CRONTAB" > /tmp/crontab
chmod 0644 /tmp/crontab
mv /tmp/crontab /etc/cron.d/backup
`;

const CRON_WAIT_SECONDS = 90;

const awaitTheJobs = String.raw`
all_ran() {
  for mode in $MODES; do [ -f "${JOB_PROBE_DIRECTORY}/$mode" ] || return 1; done
}
waited=0
until all_ran || [ "$waited" -ge ${CRON_WAIT_SECONDS} ]; do sleep 1; waited=$((waited + 1)); done
for mode in $MODES; do
  [ -f "${JOB_PROBE_DIRECTORY}/$mode" ] || continue
  printf 'job\t%s\n' "$mode"
  cat "${JOB_PROBE_DIRECTORY}/$mode"
done
`;

const copiesOnDisk = String.raw`
printf '%s\n' "$VALUES" > "${JOB_PROBE_DIRECTORY}/values"
find / -xdev -path "${JOB_PROBE_DIRECTORY}" -prune -o -type f -print0 \
  | xargs -0 grep -lFf "${JOB_PROBE_DIRECTORY}/values" -- || true
`;

const SCHEDULE = /^(?:[\d*,/-]+\s+){5}/;

const everyMinuteThroughTheProbe = (crontab: string, script: string, probe: string): string =>
  crontab
    .split("\n")
    .map((line) => {
      if (!SCHEDULE.test(line)) return line;
      if (!line.includes(script)) throw new Error(`a scheduled line starts no ${script}: ${line}`);
      return line.replace(SCHEDULE, "* * * * * ").replace(script, probe);
    })
    .join("\n");

const wrapperIn = (crontab: string, script: string): readonly string[] => {
  const words = (crontab.split("\n").find((line) => SCHEDULE.test(line)) ?? "")
    .replace(SCHEDULE, "")
    .trim()
    .split(/\s+/);
  const at = words.indexOf(script);
  if (at === -1) throw new Error(`no scheduled line starts ${script}`);
  return words.slice(1, at);
};

const environmentOf = (lines: readonly string[]): Record<string, string> =>
  Object.fromEntries(
    lines
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );

interface WhatAJobSaw {
  readonly environment: Record<string, string>;
  readonly resolves: Record<string, string>;
}

const noteWhatAJobSaw = (saw: WhatAJobSaw, key: string, rest: string): void => {
  if (key === "env") {
    Object.assign(saw.environment, environmentOf([rest]));
  } else if (key === "resolves") {
    const [tool, where] = fieldsOf(rest);
    saw.resolves[tool] = where;
  }
};

const readWhatJobsSaw = (stdout: string): ReadonlyMap<string, WhatAJobSaw> => {
  const seen = new Map<string, WhatAJobSaw>();
  let current: WhatAJobSaw | undefined;
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    const key = line.slice(0, tab);
    const rest = line.slice(tab + 1);
    if (key === "job") {
      current = { environment: {}, resolves: {} };
      seen.set(rest, current);
    } else if (current !== undefined) {
      noteWhatAJobSaw(current, key, rest);
    }
  }
  return seen;
};

const jobVariables = (): readonly string[] => {
  const list = /^readonly JOB_VARIABLES=\(\n([\s\S]*?)\n\)$/m.exec(
    read("deploy/backup-env.sh"),
  )?.[1];
  if (list === undefined) {
    throw new Error("deploy/backup-env.sh no longer has a JOB_VARIABLES list this can read");
  }
  return list
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
};

const pick = (
  from: Readonly<Record<string, string>>,
  names: readonly string[],
): Record<string, string | undefined> =>
  Object.fromEntries(names.map((name) => [name, from[name]]));

describe.skipIf(nothingToProbeHere)("the backup image, started as compose starts it", () => {
  const handed = handedToTheBackup();
  const restOfTheResource = storesResourceVariables().filter((name) => !handed.includes(name));
  const standIns: Readonly<Record<string, string>> = Object.fromEntries(
    [...handed, ...restOfTheResource].map((name) => [name, randomUUID()]),
  );
  let container: StartedContainer | undefined;
  let seen: ReadonlyMap<string, WhatAJobSaw> = new Map();
  let byHand: Readonly<Record<string, string>> = {};
  let copies: readonly string[] = [];
  let logged = "";

  beforeAll(async () => {
    container = await startTheImage(backupImage(), standIns);
    const crontab = await container.exec(["cat", "/etc/cron.d/backup"]);
    await container.exec(["sh", "-c", installTheProbe], {
      JOB_PROBE: jobProbe,
      CRONTAB: everyMinuteThroughTheProbe(
        crontab.trimEnd(),
        scriptPath(),
        `${JOB_PROBE_DIRECTORY}/job`,
      ),
    });
    byHand = environmentOf(
      (await container.exec([...wrapperIn(crontab, scriptPath()), "env"])).split("\n"),
    );
    seen = readWhatJobsSaw(
      await container.exec(["sh", "-c", awaitTheJobs], { MODES: scriptModes().join(" ") }),
    );
    copies = (
      await container.exec(["sh", "-c", copiesOnDisk], {
        VALUES: Object.values(standIns).join("\n"),
      })
    )
      .split("\n")
      .filter((line) => line.length > 0);
    logged = await container.logs();
  }, IMAGE_PROBE_ALLOWANCE);

  afterAll(async () => {
    await container?.stop();
  }, IMAGE_PROBE_ALLOWANCE);

  it("runs every scheduled job within the minute it is due", () => {
    expect([...seen.keys()].sort()).toEqual(scriptModes());
  });

  it("gives each cron job compose's variables and a tool-finding PATH", () => {
    for (const [mode, saw] of seen) {
      expect({ mode, handed: pick(saw.environment, handed) }).toEqual({
        mode,
        handed: pick(standIns, handed),
      });
      expect({ mode, resolves: saw.resolves }).toEqual({
        mode,
        resolves: {
          rclone: "/usr/local/bin/rclone",
          age: "/usr/local/bin/age",
          pg_dump: "/usr/bin/pg_dump",
        },
      });
    }
  });

  it("keeps the stores resource's other variables from every job", () => {
    expect(restOfTheResource).toEqual(
      expect.arrayContaining(["TUNNEL_TOKEN", "GARAGE_ADMIN_TOKEN", "GARAGE_RPC_SECRET"]),
    );
    for (const [mode, saw] of seen) {
      expect({
        mode,
        reached: restOfTheResource.filter((name) => name in saw.environment),
      }).toEqual({
        mode,
        reached: [],
      });
    }
  });

  it("gives a manual wrapper run the jobs' variables alone", () => {
    expect(pick(byHand, handed)).toEqual(pick(standIns, handed));
    expect(restOfTheResource.filter((name) => name in byHand)).toEqual([]);
  });

  it("leaves no variable's value in a file or the log", () => {
    expect(copies).toEqual([]);
    expect(Object.values(standIns).filter((value) => logged.includes(value))).toEqual([]);
  });
});

describe("the backup jobs' allow-list", () => {
  it("passes exactly compose's backup variables, with PATH and HOME", () => {
    expect(jobVariables()).toEqual([...handedToTheBackup(), "HOME", "PATH"].sort());
  });
});

const WORKSPACE = "ws-probe";
const LEFT_BY_A_FAILED_RUN = "/staging/globals-20260904T143652Z.sql.age";
/** The stores stack's init hands /data/git to this uid, the one the api writes as. */
const API_UID = 1000;

const nightlyRun = (script: string): string => String.raw`
set -eu
mkdir -p /data/git /staging /objectstore/uploads /buckets
git init --quiet --initial-branch=main /tmp/workspace
git -C /tmp/workspace -c user.name=probe -c user.email=probe@example.invalid \
  commit --quiet --allow-empty --message "a workspace's first commit"
git clone --quiet --bare /tmp/workspace "/data/git/${WORKSPACE}.git"
chown -R ${API_UID}:${API_UID} /data/git
printf 'an upload\n' > /objectstore/uploads/one
touch -d '2 days ago' "${LEFT_BY_A_FAILED_RUN}"
age-keygen -o /tmp/identity 2>/dev/null
BACKUP_AGE_RECIPIENT=$(age-keygen -y /tmp/identity) "${script}" nightly > /tmp/nightly.log 2>&1 || true
while IFS= read -r line; do printf 'log\t%s\n' "$line"; done < /tmp/nightly.log
find /buckets /staging -type f | while IFS= read -r file; do printf 'file\t%s\n' "$file"; done
`;

const NIGHTLY_ENVIRONMENT = {
  DATABASE_URL: "postgresql://backup@127.0.0.1:9/betteranswers",
  BACKUP_DUMPS_BUCKET: "dumps",
  BACKUP_MIRROR_BUCKET: "mirror",
  RCLONE_CONFIG_DUMPS_TYPE: "alias",
  RCLONE_CONFIG_DUMPS_REMOTE: "/buckets",
  RCLONE_CONFIG_SRC_TYPE: "alias",
  RCLONE_CONFIG_SRC_REMOTE: "/objectstore",
  GIT_MIRROR_SSH_TARGET: "mirror@127.0.0.1:/data/mirror",
  HEALTHCHECKS_PING_URL_PG_HOURLY: "http://127.0.0.1:9/pg-hourly",
  HEALTHCHECKS_PING_URL_NIGHTLY: "http://127.0.0.1:9/nightly",
};

describe.skipIf(nothingToProbeHere)("the backup image's nightly job", () => {
  let log: readonly string[] = [];
  let files: readonly string[] = [];

  beforeAll(async () => {
    const lines = (
      await readTheImage(backupImage(), {
        command: ["bash", "-c", nightlyRun(scriptPath())],
        environment: NIGHTLY_ENVIRONMENT,
      })
    ).split("\n");
    const tagged = (tag: string): readonly string[] =>
      lines.filter((line) => line.startsWith(`${tag}\t`)).map((line) => line.slice(tag.length + 1));
    log = tagged("log");
    files = tagged("file");
  }, IMAGE_PROBE_ALLOWANCE);

  it("writes, verifies and uploads a bundle of an api-owned repository", () => {
    const bundles = files.filter((file) => file.startsWith(`/buckets/dumps/git/${WORKSPACE}/`));

    // The log rides along so a failure shows where the run stopped.
    expect({ bundles, log }).toMatchObject({
      bundles: [
        expect.stringMatching(
          new RegExp(
            `^/buckets/dumps/git/${WORKSPACE}/${WORKSPACE}-\\d{8}T\\d{6}Z\\.bundle\\.age$`,
          ),
        ),
      ],
    });
  });

  it("clears what an earlier failed run left in staging", () => {
    expect(files.filter((file) => file.startsWith("/staging/"))).toEqual([]);
  });

  it("logs nothing of the workspace when its bundle passes", () => {
    expect(log.filter((line) => line.includes(WORKSPACE))).toEqual([]);
  });

  it("ends its log with the words its ping carries", () => {
    // No mirror host answers here, so the run fails at the push, after the bundles.
    expect(log.at(-1)).toBe("backup.sh nightly: fail bytes=0 took=0");
  });
});

describe("the backup leg of the image job", () => {
  it("names this file as its probe", () => {
    const backup = legFor("backup");

    expect(backup.probe).toContain("@better-answers/api");
    expect(backup.probe).toContain(fileFromTheWorkspace(import.meta.url, "apps/api"));
  });
});
