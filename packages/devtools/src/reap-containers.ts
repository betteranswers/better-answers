import { spawnSync } from "node:child_process";

import { z } from "zod";

const USAGE = "usage: reap-containers [--dry-run]";

const SESSION_LABEL = "org.testcontainers.session-id";
const RYUK_LABEL = "org.testcontainers.ryuk";

/** The Python library labels its Ryuk with neither label above, so only the name gives its session. */
const RYUK_NAME = /^testcontainers-ryuk-(?<session>.+)$/;

/**
 * A running container may be a live run's with Ryuk turned off, and a running Ryuk may yet clear
 * its session.
 */
const STOPPED = new Set(["exited", "dead"]);

const SHORT_ID = 12;

const FORMAT = `{"id":{{json .ID}},"name":{{json .Names}},"state":{{json .State}},"session":{{json (.Label "${SESSION_LABEL}")}},"ryuk":{{json (.Label "${RYUK_LABEL}")}}}`;

const listedRow = z.object({
  id: z.string().min(1),
  name: z.string(),
  state: z.string(),
  session: z.string(),
  ryuk: z.string(),
});

type Listed = z.infer<typeof listedRow>;

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const complain = (line: string): void => {
  process.stderr.write(`reap-containers: ${line}\n`);
};

const isRyuk = (row: Listed): boolean => row.ryuk === "true" || RYUK_NAME.test(row.name);

const sessionOf = (row: Listed): string | undefined =>
  row.session === "" ? RYUK_NAME.exec(row.name)?.groups?.["session"] : row.session;

const listed = (): readonly Listed[] | undefined => {
  const ran = spawnSync(
    "docker",
    ["ps", "--all", "--no-trunc", "--filter", "label=org.testcontainers=true", "--format", FORMAT],
    { encoding: "utf8" },
  );
  if (ran.error !== undefined || ran.status !== 0) {
    complain(`docker could not list the containers: ${ran.error?.message ?? ran.stderr}`);
    return undefined;
  }
  try {
    return ran.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => listedRow.parse(JSON.parse(line)));
  } catch (cause) {
    complain(`docker listed the containers in a shape this cannot read: ${String(cause)}`);
    return undefined;
  }
};

/** Ryuk leaves once its session's last process has, so no Ryuk up means no run left to clear it. */
const endedIn = (rows: readonly Listed[]): readonly Listed[] => {
  const served = new Set(
    rows.filter((row) => isRyuk(row) && !STOPPED.has(row.state)).map((row) => sessionOf(row)),
  );
  return rows.filter((row) => {
    const session = sessionOf(row);
    return STOPPED.has(row.state) && session !== undefined && !served.has(session);
  });
};

const described = (row: Listed): string =>
  `${row.id.slice(0, SHORT_ID)} ${row.name} (session ${sessionOf(row) ?? "none"}, ${row.state})`;

const removeOrComplain = (row: Listed): boolean => {
  const ran = spawnSync("docker", ["rm", "--force", "--volumes", row.id], { encoding: "utf8" });
  if (ran.status === 0 || /No such container/i.test(ran.stderr)) {
    say(`removed ${described(row)}`);
    return true;
  }
  complain(`docker could not remove ${described(row)}: ${ran.error?.message ?? ran.stderr}`);
  return false;
};

const dryRunFrom = (argv: readonly string[]): boolean | undefined => {
  if (argv.length === 0) return false;
  if (argv.length === 1 && argv[0] === "--dry-run") return true;
  return undefined;
};

/**
 * Removes stopped testcontainers containers no Ryuk serves; `--dry-run` only names them. Exits 0
 * when done, 2 on a usage error, 1 when docker fails.
 */
export const reapContainers = (argv: readonly string[]): number => {
  const dryRun = dryRunFrom(argv);
  if (dryRun === undefined) {
    complain(USAGE);
    return 2;
  }
  const rows = listed();
  if (rows === undefined) return 1;
  const ended = endedIn(rows);
  const spared = String(rows.length - ended.length);
  if (dryRun) {
    for (const row of ended) say(`would remove ${described(row)}`);
    say(`${String(ended.length)} to remove, ${spared} spared`);
    return 0;
  }
  let failed = 0;
  for (const row of ended) {
    if (!removeOrComplain(row)) failed += 1;
  }
  say(`${String(ended.length - failed)} removed, ${spared} spared`);
  return failed === 0 ? 0 : 1;
};
