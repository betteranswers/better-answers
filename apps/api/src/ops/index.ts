import type { Pool } from "pg";

import {
  GRAPH_MAINTENANCE,
  graphCounts,
  RECONCILER,
  reconcile,
  sweepGraph,
} from "@better-answers/core/concepts";
import { enqueueJob, JOB_IS_OVER, jobById, type RebuildReason } from "@better-answers/core/runs";
import { openGit } from "@better-answers/core/store/git";
import {
  openPostgres,
  tablesPresent,
  type PostgresDoor,
} from "@better-answers/core/store/postgres";
import { FULL_REBUILD_KIND, REBUILD_REASONS } from "@better-answers/schema";

/**
 * The `pnpm ops` commands the estate's restore scripts call (ADR 0022; `restore-drill.sh`,
 * `restore-production.sh`): one dispatcher, one contract, held by `tests/ops.test.ts`.
 *
 * **The contract.** A command answers over the schema it finds, and it says which of
 * three things is true rather than guessing:
 *
 * - exit `0` — it did the thing, or proved there was nothing to do;
 * - exit `1` — it refused, and the caller must stop (a restore's replay is the one
 *   that matters: an erasure the dump predates must be re-applied before `api`
 *   starts, and a schema that holds erasures this process cannot replay is a restore
 *   that must not turn healthy);
 * - exit `3` (`NOT_BUILT`) — the store the command needs has no tables in this
 *   schema, because the slice that owns them has not landed. The drill records that
 *   line and carries on; it is not a failure, and it is never silent.
 *
 * What each command does today is exactly what the schema allows today, and no more.
 * The tables named per command are the ones its slice's ADR names; when a slice lands,
 * its command is filled in here and the drill exercises it with no script change.
 * Nothing here reads the environment: the pool and every value come in as arguments.
 */

/**
 * The contract's exit codes, by name: the scripts read them, so they are stated once. Only
 * `NOT_BUILT` is named outside this module — the drill's test asserts a command answers with
 * it — and the other three are exported the day something outside asks for them by name.
 */
const DONE = 0;
const REFUSED = 1;
const USAGE = 2;
export const NOT_BUILT = 3;

export type OpsIo = {
  /** A fetch the smoke test speaks through: `globalThis.fetch` in the process, `server.request` in a test. */
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Everything on stdin, for `dump-grep`. */
  readonly stdin: () => Promise<string>;
  readonly say: (line: string) => void;
  /** The app hostname the smoke test sends as `Host` when it is reached on the loopback. */
  readonly appHostname?: string | undefined;
  /**
   * The bare repositories' root (`GIT_STORE_DIR`), for `reconcile-watermark`: the one
   * command that opens a bundle. Absent, it refuses rather than guessing a path.
   */
  readonly gitStoreDir?: string | undefined;
};

/** `pg-20260903T020500Z` (a dump stamp) or any ISO 8601 instant, as a Date. */
export const parseSince = (value: string): Date | undefined => {
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  const iso =
    stamp === null
      ? value
      : `${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:${stamp[6]}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/** `--name value` → value; a bare `--name` → true. The scripts pass both shapes. */
type Flags = ReadonlyMap<string, string | true>;

const parseFlags = (argv: readonly string[]): Flags => {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (!argument.startsWith("--")) continue;
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(argument.slice(2), next);
      index += 1;
    } else {
      flags.set(argument.slice(2), true);
    }
  }
  return flags;
};

const flagValue = (flags: Flags, name: string): string | undefined => {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
};

/** The tables each slice-owned command needs before it can mean anything. */
const NEEDS = {
  // The rebuild needs the queue as well as the map: it is the worker that makes the map
  // again, and this command puts the job on the queue and waits for the row to say so.
  "graph-rebuild": ["graph_generation", "graph_node", "graph_edge", "job"],
  "graph-sweep": ["graph_generation", "graph_node", "graph_edge"],
  "graph-counts": ["graph_generation", "graph_node", "graph_edge"],
  "reconcile-watermark": ["concept_index", "bundle_commit"],
  "object-store-orphans": ["source_document"],
  "erasure-rehearsal": ["erasure_request", "suppression"],
} as const;

type SliceCommand = keyof typeof NEEDS;

/**
 * The rebuild's reason when the caller names none. The restore drill is this command's
 * caller, and ADR 0023 asks every rebuild to say which of six things it happened for; a
 * command that guessed *first-sync* or left the column empty would put a false reason in a
 * row an operator reads later.
 */
const REBUILD_DEFAULT_REASON = "drill";

/**
 * How long `--wait` waits, and how often it looks. ADR 0032 promises the rebuild in two
 * minutes and the drill's report times it against that; ten minutes is the point past which
 * an operator should be reading the worker's own rows rather than this line, so it is a
 * refusal and not a longer wait. An estate whose worker is slower says `--wait <seconds>`,
 * which is the flag's other shape and not a second constant.
 */
const WAIT_SECONDS = 600;
const WAIT_POLL_MS = 2_000;

const USAGE_TEXT = `usage: pnpm ops <command> [options]
  replay-erasures --since <dump stamp | ISO instant>      re-apply every erasure completed after a dump (mandatory in every restore)
  graph-rebuild --workspace <id> [--reason <word>] [--wait [seconds]]   the map made again by the worker (ADR 0023, 0032)
    --reason  one of ${REBUILD_REASONS.join(" · ")} (default ${REBUILD_DEFAULT_REASON})
    --wait    poll the job until it is over, ${WAIT_SECONDS} seconds unless another number is given
  graph-sweep --workspace <id>                              delete every generation of the map but the live one
  graph-counts --workspace <id>                             nodes per label and edges, as JSON, for the drill's diff
  reconcile-watermark --workspace <id>                      recovery order step 2: replay the commits the rows missed (ADR 0012)
  object-store-orphans --workspace <id> [--list]            recovery order step 5
  smoke --url <origin> [--workspace <id>] [--find] [--guide] [--ask]
  erasure-rehearsal --workspace <id> --synthetic --report <file>
  dump-grep --tokens <a,b,…>                                stdin: a plain-SQL dump; reports present/absent per token, never a line
exit codes: ${DONE} done · ${REFUSED} refused, stop · ${USAGE} usage · ${NOT_BUILT} the slice this needs has no tables yet`;

const replayErasures = async (pool: Pool, flags: Flags, io: OpsIo): Promise<number> => {
  const sinceArgument = flagValue(flags, "since");
  const since = sinceArgument === undefined ? undefined : parseSince(sinceArgument);
  if (since === undefined) {
    io.say("replay-erasures: --since <dump stamp or ISO instant> is required");
    return USAGE;
  }
  const present = await tablesPresent(openPostgres(pool), ["erasure_request"]);
  if (present.length === 0) {
    // Absence is proof, not silence: no erasure_request table means no erasure has ever
    // been recorded in this database, so there is nothing a restore could have undone.
    io.say(
      `replayed 0 erasures since ${since.toISOString()}: no erasure_request table exists in this schema, so no erasure has ever been recorded here`,
    );
    return DONE;
  }
  // The table exists and the replay is the erasure slice's to write (ADR 0020). Until it
  // is, a restore over a schema that may hold erasures completed after the dump must
  // stop here rather than turn healthy over data a subject was told is beyond use.
  io.say(
    `REFUSED: erasure_request exists in this schema and the replay is not implemented in this image — do not start api; the erasure slice's task (ADR 0020) fills this command in`,
  );
  return REFUSED;
};

const smoke = async (flags: Flags, io: OpsIo): Promise<number> => {
  const url = flagValue(flags, "url");
  if (url === undefined) {
    io.say("smoke: --url <origin> is required (http://127.0.0.1:3000 inside the stack)");
    return USAGE;
  }
  const origin = url.replace(/\/$/, "");
  // On the loopback the fence carries /health alone (T-030): everything else is asked for
  // as the app hostname, which is what the tunnel would have sent.
  const asApp: RequestInit =
    io.appHostname === undefined ? {} : { headers: { host: io.appHostname } };
  let failed = 0;
  const check = async (
    name: string,
    request: () => Promise<Response>,
    expect: (response: Response) => Promise<boolean>,
  ): Promise<void> => {
    try {
      const response = await request();
      const ok = await expect(response);
      io.say(`${ok ? "ok  " : "FAIL"} ${name} → ${response.status}`);
      if (!ok) failed += 1;
    } catch (cause) {
      io.say(`FAIL ${name} → ${cause instanceof Error ? cause.message : String(cause)}`);
      failed += 1;
    }
  };

  await check(
    "/health answers healthy",
    () => io.fetch(`${origin}/health`),
    async (response) => response.status === 200,
  );
  await check(
    "/.well-known/oauth-protected-resource/mcp names the MCP surface",
    () => io.fetch(`${origin}/.well-known/oauth-protected-resource/mcp`, asApp),
    async (response) => {
      if (response.status !== 200) return false;
      const document: unknown = await response.json();
      return (
        typeof document === "object" &&
        document !== null &&
        "resource" in document &&
        typeof document.resource === "string" &&
        document.resource.endsWith("/mcp")
      );
    },
  );
  await check(
    "/mcp without a bearer is refused with a challenge",
    () => io.fetch(`${origin}/mcp`, { ...asApp, method: "POST" }),
    async (response) =>
      response.status === 401 && (response.headers.get("www-authenticate") ?? "") !== "",
  );
  await check(
    "/ serves the shell",
    () => io.fetch(`${origin}/`, asApp),
    async (response) =>
      response.status === 200 && (response.headers.get("content-type") ?? "").includes("text/html"),
  );
  for (const entry of ["find", "guide", "ask"] as const) {
    if (flags.get(entry) !== true) continue;
    // Each needs a token a client obtained through consent, and no script mints one: the
    // entry is proved by hand through claude.ai on the drill day (T-045's re-prove is the
    // procedure) until a service principal exists (ticket 79 SEC4).
    io.say(`note ${entry}: needs a minted token — proved by hand through the connector, not here`);
  }
  return failed === 0 ? DONE : REFUSED;
};

const dumpGrep = async (flags: Flags, io: OpsIo): Promise<number> => {
  const tokens = (flagValue(flags, "tokens") ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    io.say("dump-grep: --tokens <a,b,…> is required");
    return USAGE;
  }
  const text = await io.stdin();
  const lines = text.split("\n");
  for (const token of tokens) {
    // Never the line: a dump is personal data and the report is what a regulator reads.
    const hits = lines.filter((line) => line.includes(token)).length;
    io.say(
      `${token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-2)}` : token}: ${hits === 0 ? "absent" : `present in ${hits} line(s)`}`,
    );
  }
  return 0;
};

const sliceCommand = async (
  command: SliceCommand,
  pool: Pool,
  flags: Flags,
  io: OpsIo,
): Promise<number> => {
  const workspaceId = flagValue(flags, "workspace");
  if (workspaceId === undefined) {
    io.say(`${command}: --workspace <id> is required`);
    return USAGE;
  }
  const needed = NEEDS[command];
  const present = await tablesPresent(openPostgres(pool), needed);
  if (present.length < needed.length) {
    io.say(
      `${command}: not built — ${needed.filter((name) => !present.includes(name)).join(", ")} absent from this schema; the slice that owns them has not landed`,
    );
    return NOT_BUILT;
  }
  if (command === "reconcile-watermark") return reconcileWatermark(pool, workspaceId, io);
  if (command === "graph-rebuild") return graphRebuildCommand(pool, workspaceId, flags, io);
  if (command === "graph-counts") return graphCountsCommand(pool, workspaceId, io);
  if (command === "graph-sweep") return graphSweepCommand(pool, workspaceId, io);
  // The tables exist, so the slice has landed and its own query module answers this —
  // never SQL written here: the api tier is transports, and a tenant read belongs to
  // `packages/core` (ADR 0029). Until that module is wired in, refusing is the honest answer.
  io.say(
    `${command}: REFUSED — its tables exist but this image carries no implementation; the slice's task fills it in`,
  );
  return REFUSED;
};

/**
 * A refusal's word, or a store's own failure, as one line says it — the ops commands' and
 * the reconciler tick's alike, so the two say a slice's refusal the same way.
 */
export const reasonOf = (reason: string | Error): string =>
  typeof reason === "string" ? reason : reason.message;

/**
 * A slice-backed command's refusal, said the one way for all of them: a `--workspace` the
 * boundary will not read as a workspace id is the caller's mistake and answers usage,
 * before the command is blamed for it; every other refusal is one the operator has to look
 * at, and stops the restore.
 */
const refused = (
  command: SliceCommand,
  workspaceId: string,
  reason: string | Error,
  io: OpsIo,
): number => {
  if (reason === "malformed") {
    io.say(`${command}: --workspace ${workspaceId} is not a workspace id`);
    return USAGE;
  }
  io.say(`${command}: REFUSED — ${reasonOf(reason)}`);
  return REFUSED;
};

/**
 * The map by the numbers (T-006 spec, *Ops and the budget*): the live generation, and how
 * many nodes and edges wear each label — the live generation's and the source entities'
 * beside them, which is the set a read binds (ADR 0023).
 *
 * **One line of JSON and nothing else**, because the drill redirects this to a file and
 * diffs it against the counts production's last good sync run stamped (`restore-drill.sh`
 * step 6): a second line would be a difference in every diff. A workspace nobody has
 * mapped answers zero of everything and is *done* — the tables are there, the map is
 * empty, and a restore over an empty map is a restore that worked.
 */
const graphCountsCommand = async (pool: Pool, workspaceId: string, io: OpsIo): Promise<number> => {
  const counted = await graphCounts(GRAPH_MAINTENANCE, openPostgres(pool), { workspaceId });
  if (!counted.ok) return refused("graph-counts", workspaceId, counted.error, io);
  const { liveGen, nodes, edges } = counted.value;
  io.say(JSON.stringify({ live_gen: liveGen, nodes, edges }));
  return DONE;
};

/** `--reason <word>` read as one of ADR 0023's six, or nothing at all. */
const rebuildReasonOf = (flags: Flags): RebuildReason | undefined => {
  const given = flagValue(flags, "reason") ?? REBUILD_DEFAULT_REASON;
  return REBUILD_REASONS.find((reason) => reason === given);
};

/**
 * `--wait` in its two shapes: bare, which is the default budget, or a whole number of
 * seconds. Nothing at all means do not wait; `"malformed"` is a value that is neither.
 */
const waitSecondsOf = (flags: Flags): number | "malformed" | undefined => {
  const given = flags.get("wait");
  if (given === undefined) return undefined;
  if (given === true) return WAIT_SECONDS;
  const seconds = Number(given);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : "malformed";
};

const after = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * `--wait`: the job polled until it is over or the budget runs out. A rebuild is claimed by
 * whichever worker is free and runs in that process, so there is nothing here to hold open
 * and nothing to be notified through — the row is the only place the outcome appears.
 *
 * *Done* is the one status that is done. **Failed and poisoned are refusals**, because the
 * drill's next step diffs this workspace's counts against production's and a map that was
 * never rebuilt would fail that comparison for the wrong reason; and so is a job still on
 * the queue when the budget runs out, because a worker that has not claimed a rebuild in ten
 * minutes is the thing an operator has to look at.
 */
const waitForJob = async (
  door: PostgresDoor,
  workspaceId: string,
  jobId: string,
  seconds: number,
  io: OpsIo,
): Promise<number> => {
  const deadline = Date.now() + seconds * 1_000;
  const pollMs = Math.min(WAIT_POLL_MS, seconds * 1_000);
  let job = await jobById(GRAPH_MAINTENANCE, door, { workspaceId, jobId });
  while (job.ok && !JOB_IS_OVER.includes(job.value.status) && Date.now() < deadline) {
    await after(Math.min(pollMs, Math.max(deadline - Date.now(), 0)));
    job = await jobById(GRAPH_MAINTENANCE, door, { workspaceId, jobId });
  }
  if (!job.ok) return refused("graph-rebuild", workspaceId, job.error, io);
  const { status, attempts } = job.value;
  if (status === "done") {
    io.say(`graph-rebuild: done — job ${jobId} rebuilt the map on ${counted(attempts, "attempt")}`);
    return DONE;
  }
  const ending = JOB_IS_OVER.includes(status)
    ? `${status} after ${counted(attempts, "attempt")}; the job's own row says what it found`
    : `still ${status} after ${counted(seconds, "second")}, so nothing has rebuilt this map`;
  io.say(`graph-rebuild: REFUSED — job ${jobId} is ${ending}`);
  return REFUSED;
};

/**
 * The map made again (ADR 0023's full rebuild; recovery order step 3). The work is the
 * worker's and this command does not do it: it puts a `full-rebuild` job on the queue
 * through the runs slice and answers the id, so the api tier writes no SQL against another
 * module's table and the rebuild runs in the tier that owns it.
 */
const graphRebuildCommand = async (
  pool: Pool,
  workspaceId: string,
  flags: Flags,
  io: OpsIo,
): Promise<number> => {
  const reason = rebuildReasonOf(flags);
  if (reason === undefined) {
    io.say(`graph-rebuild: --reason must be one of ${REBUILD_REASONS.join(", ")}`);
    return USAGE;
  }
  const wait = waitSecondsOf(flags);
  if (wait === "malformed") {
    io.say("graph-rebuild: --wait takes no value, or a whole number of seconds");
    return USAGE;
  }
  const door = openPostgres(pool);
  const enqueued = await enqueueJob(GRAPH_MAINTENANCE, door, {
    workspaceId,
    kind: FULL_REBUILD_KIND,
    reason,
  });
  if (!enqueued.ok) return refused("graph-rebuild", workspaceId, enqueued.error, io);
  const { jobId } = enqueued.value;
  if (wait === undefined) {
    io.say(`graph-rebuild: done — enqueued ${jobId}`);
    return DONE;
  }
  return waitForJob(door, workspaceId, jobId, wait, io);
};

/** The drill's report is read by a person, so a noun agrees with what it counts. */
const plural = (many: number, noun: string): string => `${noun}${many === 1 ? "" : "s"}`;
const counted = (many: number, noun: string): string => `${many} ${plural(many, noun)}`;

/**
 * The generations a finished rebuild left behind, deleted (ADR 0032: generations exist for
 * full rebuilds, and the flip is one row update). Never the live one and never the
 * source-entity partition; a workspace with nothing to sweep is *done*, and so is one whose
 * map is only its live generation — an empty sweep is proof, not a silence.
 */
const graphSweepCommand = async (pool: Pool, workspaceId: string, io: OpsIo): Promise<number> => {
  const swept = await sweepGraph(GRAPH_MAINTENANCE, openPostgres(pool), { workspaceId });
  if (!swept.ok) return refused("graph-sweep", workspaceId, swept.error, io);
  if (swept.value.length === 0) {
    io.say("graph-sweep: done — nothing to sweep");
    return DONE;
  }
  const generations = swept.value.map((generation) => generation.gen).join(", ");
  const nodes = swept.value.reduce((total, generation) => total + generation.nodes, 0);
  const edges = swept.value.reduce((total, generation) => total + generation.edges, 0);
  io.say(
    `graph-sweep: done — swept ${plural(swept.value.length, "generation")} ${generations} (${counted(nodes, "node")}, ${counted(edges, "edge")})`,
  );
  return DONE;
};

/**
 * The reconciler on demand — the restore path (ADR 0012, amended 2026-09-06; T-006 spec,
 * *Ops and the budget*): after a database is restored from a dump, the repository is ahead
 * of it, and this replays what the rows missed through the same slice function the app's
 * periodic head check runs. Under the reconciler's own principal and never a person's:
 * the command takes no actor, because recovery is booked to nobody.
 *
 * *Done* is the rows and the bundle agreeing when the run ends, with what it took to get
 * there in the line. *Refused* is anything else the operator has to look at: no root to open
 * the bundle from, a bundle that is not there or whose history the rows disagree with, or a
 * commit the index would not take — the run lands everything before that commit, stops,
 * names it, and that workspace is stuck behind it until a person acts (ADR 0012, amended
 * 2026-09-07). It is never skipped, so a stop is a refusal and the drill halts on it.
 */
const reconcileWatermark = async (pool: Pool, workspaceId: string, io: OpsIo): Promise<number> => {
  if (io.gitStoreDir === undefined) {
    io.say(
      "reconcile-watermark: REFUSED — no repositories' root is configured (GIT_STORE_DIR), so the bundle cannot be opened; the estate sets it to /data/git on the api service",
    );
    return REFUSED;
  }
  const doors = { git: openGit(io.gitStoreDir), postgres: openPostgres(pool) };
  const run = await reconcile(RECONCILER, doors, { workspaceId });
  if (!run.ok) return refused("reconcile-watermark", workspaceId, run.error, io);
  const { head, watermark, replayed, skipped, stopped } = run.value;
  const found = `head ${head ?? "none"}, watermark ${watermark ?? "none"}, replayed ${replayed.length}, already landed ${skipped.length}`;
  if (stopped !== undefined) {
    io.say(
      `reconcile-watermark: REFUSED — stopped at ${stopped.sha} (${reasonOf(stopped.reason)}); ${found}; every commit before it landed and nothing after it was attempted, and this workspace stays behind that commit until a person acts (ADR 0012)`,
    );
    return REFUSED;
  }
  io.say(`reconcile-watermark: done — ${found}`);
  return DONE;
};

const isSliceCommand = (command: string): command is SliceCommand => command in NEEDS;

export const runOps = async (argv: readonly string[], pool: Pool, io: OpsIo): Promise<number> => {
  // pnpm inserts a literal `--` when it forwards arguments through the workspace `ops`
  // script (`pnpm ops replay-erasures` arrives as `-- replay-erasures`; first drill,
  // 04/09/2026) — a separator, never a command. Stripped here, inside the tested seam.
  const [command, ...rest] = argv[0] === "--" ? argv.slice(1) : argv;
  const flags = parseFlags(rest);
  if (command === undefined || command === "--help" || command === "help") {
    io.say(USAGE_TEXT);
    return command === undefined ? USAGE : DONE;
  }
  if (command === "replay-erasures") return replayErasures(pool, flags, io);
  if (command === "smoke") return smoke(flags, io);
  if (command === "dump-grep") return dumpGrep(flags, io);
  if (isSliceCommand(command)) return sliceCommand(command, pool, flags, io);
  io.say(`unknown command: ${command}\n${USAGE_TEXT}`);
  return USAGE;
};
