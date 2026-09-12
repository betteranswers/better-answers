import type { Pool } from "pg";

import {
  GRAPH_MAINTENANCE,
  graphCounts,
  RECONCILER,
  reconcile,
  sweepGraph,
} from "@better-answers/core/concepts";
import {
  ERASURE,
  rehearseErasure,
  replayErasures,
  seedSyntheticSubject,
  type RehearsalRefusal,
} from "@better-answers/core/erasure";
import { err, ok, type Clock, type Result } from "@better-answers/core/kernel";
import { enqueueJob, JOB_IS_OVER, jobById, type RebuildReason } from "@better-answers/core/runs";
import { openGit, type GitDoor } from "@better-answers/core/store/git";
import type { ObjectDoor } from "@better-answers/core/store/objects";
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
  /**
   * The object store's door, for the two erasure commands: the replay lists the copies a
   * restored database may predate, and the routine both of them run writes one. Optional for
   * `gitStoreDir`'s reason — the same image runs `migrate`, whose environment is the database
   * alone — and injected rather than opened here so the seam stays a seam: a suite hands its
   * own Garage in, and the one place the environment is read is `config.ts`.
   */
  readonly objects?: ObjectDoor | undefined;
  /**
   * Where `--report <file>` is written. Injected for the reason `stdin` is: a command that
   * called `node:fs` inside itself could not be run by a test that then asserts what it wrote,
   * and the report is the one artefact of a rehearsal an operator keeps.
   */
  readonly writeReport?: ((path: string, body: string) => Promise<void>) | undefined;
  /**
   * This one-shot process's Clock (ADR 0040): `reconcile-watermark`'s replay reads it for
   * each landing instant, and `--wait`'s job poller for its deadline.
   */
  readonly clock: Clock;
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
 * minutes per workspace and the drill's report times it against that, so two minutes is the
 * default: a rebuild not over by then has missed the promise, and the command refuses rather
 * than masking the miss by waiting on. An estate whose worker is slower, or an operator who
 * knows why this one is, says so explicitly with `--wait-seconds <n>`; the default is never
 * longer than the budget it stands for.
 */
const WAIT_SECONDS = 120;
const WAIT_POLL_MS = 2_000;

const USAGE_TEXT = `usage: pnpm ops <command> [options]
  replay-erasures --since <dump stamp | ISO instant>      re-apply every erasure completed after a dump (mandatory in every restore)
  graph-rebuild --workspace <id> [--reason <word>] [--wait | --wait-seconds <n>]   the map made again by the worker (ADR 0023, 0032)
    --reason  one of ${REBUILD_REASONS.join(" · ")} (default ${REBUILD_DEFAULT_REASON})
    --wait    poll the job until it is over, ${WAIT_SECONDS} seconds — the per-workspace budget (ADR 0032)
    --wait-seconds <n>  the same, for a whole number of seconds an operator names instead
  graph-sweep --workspace <id>                              delete every generation of the map but the live one
  graph-counts --workspace <id>                             nodes per label and edges, as JSON, for the drill's diff
  reconcile-watermark --workspace <id>                      recovery order step 2: replay the commits the rows missed (ADR 0012)
  object-store-orphans --workspace <id> [--list]            recovery order step 5
  smoke --url <origin> [--workspace <id>] [--find] [--guide] [--ask]
  erasure-rehearsal --workspace <id> --synthetic --seed      phase one: the synthetic subject, its tokens on the last line
  erasure-rehearsal --workspace <id> --synthetic --run --report <file>   phase two: erase them, write the report, print the tokens again
  dump-grep --tokens <a,b,…>                                stdin: a plain-SQL dump; per token, which COPY section holds it and in how many lines — never a line
exit codes: ${DONE} done · ${REFUSED} refused, stop · ${USAGE} usage · ${NOT_BUILT} the slice this needs has no tables yet`;

/**
 * The four doors an erasure runs over, or the one sentence saying which of them is missing.
 *
 * Both erasure commands need all four, and both must say *which* one an operator has to go
 * and fix: a restore stops on this line, and "refused" with no noun in it sends somebody
 * reading logs instead of setting a variable. Nothing is read from the environment here —
 * the roots and the door arrive on `OpsIo`, as everything else in this module does.
 */
type ErasureDoors = {
  readonly git: GitDoor;
  readonly postgres: PostgresDoor;
  readonly objects: ObjectDoor;
  readonly clock: Clock;
};

const erasureDoors = (pool: Pool, io: OpsIo): Result<ErasureDoors, string> => {
  if (io.gitStoreDir === undefined) {
    return err(
      "no repositories' root is configured (GIT_STORE_DIR), so the bundles an erasure rewrites cannot be opened; the estate sets it to /data/git on the api service",
    );
  }
  const git = openGit(io.gitStoreDir);
  if (!git.ok) {
    return err(`the repositories' root is ${git.error} (GIT_STORE_DIR=${io.gitStoreDir})`);
  }
  if (io.objects === undefined) {
    return err(
      "no object store is configured (S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY on the api service), so the replay copies an erasure leaves cannot be read",
    );
  }
  return ok({ git: git.value, postgres: openPostgres(pool), objects: io.objects, clock: io.clock });
};

/**
 * **Recovery order: every erasure the dump undid, done again** (ADR 0020, ADR 0022).
 *
 * The one command whose refusal stops a restore. A dump taken before an erasure carries the
 * person the erasure removed, so restoring it puts them back; the set of erasures owed is the
 * restored rows and the replay copies in the object store together, and the erasure slice
 * decides it and runs it. What is here is the wiring and the lines an operator reads: the api
 * tier is transports, and a tenant read belongs to `packages/core` (ADR 0029).
 *
 * It runs after the object store and the git store are back and before `api` is up, because
 * it needs both and because `api` must never turn healthy over an erasure that was undone.
 */
const replayErasuresCommand = async (pool: Pool, flags: Flags, io: OpsIo): Promise<number> => {
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
    // Answered before the doors are opened, because a database no erasure was ever
    // recorded in owes nothing whether or not the other two stores came back.
    io.say(
      `replayed 0 erasures since ${since.toISOString()}: no erasure_request table exists in this schema, so no erasure has ever been recorded here`,
    );
    return DONE;
  }
  const doors = erasureDoors(pool, io);
  if (!doors.ok) {
    io.say(`replay-erasures: REFUSED — ${doors.error}; do not start api`);
    return REFUSED;
  }
  const replayed = await replayErasures(ERASURE, doors.value, { since });
  if (!replayed.ok) {
    // The slice stops at the first request it cannot run and its error names that request
    // and how many ran before it, so the operator restarting the restore knows where it got
    // to. The routine is idempotent, so restarting means running this command again.
    io.say(`replay-erasures: REFUSED — ${replayed.error.message}; do not start api`);
    return REFUSED;
  }
  for (const erasure of replayed.value) {
    io.say(
      `replay-erasures: ${erasure.erasureRequestId} in workspace ${erasure.workspaceId} — ` +
        `completed ${erasure.completedAt.toISOString()}, ` +
        `${erasure.fromReplayCopy ? "re-created from its replay copy" : "read from the restored rows"}`,
    );
  }
  io.say(
    `replay-erasures: done — replayed ${counted(replayed.value.length, "erasure")} since ${since.toISOString()}`,
  );
  return DONE;
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

/** Where a hit was that no `COPY` section claimed — schema, a function body, a comment. */
const OUTSIDE_ANY_SECTION = "";

/** `COPY <table> (…) FROM stdin;` — the table is whatever stands between the verb and the columns. */
const SECTION_OPENS = /^COPY\s+([^\s(]+)/;

/** Enough of a token for a reader to recognise it, never enough to be the value itself. */
const maskToken = (token: string): string =>
  token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-2)}` : token;

/**
 * One pass over the dump: per token, how many lines hold it in each `COPY` section.
 *
 * A plain-SQL dump is sections of rows (`COPY <table> (…) FROM stdin;` … `\.`) with schema
 * between them, so the section a line falls in is the table the value is *in*. While a section
 * is open only `\.` closes it — a row whose first field happens to read `COPY something` is data,
 * not a header — and the header line itself is skipped, because its column names are the schema
 * of the table rather than a row of it.
 */
const perSectionHits = (
  text: string,
  tokens: readonly string[],
): ReadonlyMap<string, ReadonlyMap<string, number>> => {
  const hits = new Map<string, Map<string, number>>(
    tokens.map((token) => [token, new Map<string, number>()]),
  );
  let table: string | undefined;
  for (const line of text.split("\n")) {
    const opened = table === undefined ? SECTION_OPENS.exec(line)?.[1] : undefined;
    if (opened !== undefined) {
      table = opened;
      continue;
    }
    if (table !== undefined && line === "\\.") {
      table = undefined;
      continue;
    }
    for (const token of tokens) {
      if (!line.includes(token)) continue;
      const counted = hits.get(token);
      const where = table ?? OUTSIDE_ANY_SECTION;
      counted?.set(where, (counted.get(where) ?? 0) + 1);
    }
  }
  return hits;
};

/**
 * **Which table holds a token, and in how many of its lines** — read on stdin, a plain-SQL dump.
 *
 * The drill's erasure rehearsal greps the same database before and after the routine and decides
 * from these lines whether an erasure erased (`deploy/restore-drill.sh`). *Absent* is not the
 * reading it expects afterwards: `subject_request` and `suppression` keep the subject's
 * identifier set by design, because a restore from a dump older than the request re-creates the
 * suppressions from it, so a whole-database dump taken after the routine still holds the address
 * and the display name — in those two tables and nowhere else. A report that said only that
 * *something* holds the value could not tell that apart from an erasure that missed a store.
 *
 * The line itself is never said, whatever it holds: a dump is personal data and this output is
 * what a regulator reads. The token is masked for the same reason.
 */
const dumpGrep = async (flags: Flags, io: OpsIo): Promise<number> => {
  const tokens = (flagValue(flags, "tokens") ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    io.say("dump-grep: --tokens <a,b,…> is required");
    return USAGE;
  }
  const hits = perSectionHits(await io.stdin(), tokens);
  for (const token of tokens) {
    const counted = hits.get(token);
    if (counted === undefined || counted.size === 0) {
      io.say(`${maskToken(token)}: absent`);
      continue;
    }
    for (const [where, lines] of counted) {
      const place =
        where === OUTSIDE_ANY_SECTION ? "outside any COPY section" : `of table ${where}`;
      io.say(`${maskToken(token)}: present in ${lines} line(s) ${place}`);
    }
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
  if (command === "erasure-rehearsal") return erasureRehearsal(pool, workspaceId, flags, io);
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
 * The wait, in its two flags: a bare `--wait` is the budget, and `--wait-seconds <n>` is a
 * whole number of seconds an operator names instead. Nothing at all means do not wait;
 * `"malformed"` is a `--wait` carrying a value or a `--wait-seconds` that is not a count.
 */
const waitSecondsOf = (flags: Flags): number | "malformed" | undefined => {
  const bare = flags.get("wait");
  const named = flags.get("wait-seconds");
  if (bare === undefined && named === undefined) return undefined;
  if (bare !== undefined && bare !== true) return "malformed";
  if (named === undefined) return WAIT_SECONDS;
  const seconds = Number(named);
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
 * the queue when the budget runs out, because a worker that has not claimed a rebuild in the
 * two minutes the promise allows is the thing an operator has to look at.
 */
const waitForJob = async (
  door: PostgresDoor,
  workspaceId: string,
  jobId: string,
  seconds: number,
  io: OpsIo,
): Promise<number> => {
  const deadline = io.clock.now().getTime() + seconds * 1_000;
  const pollMs = Math.min(WAIT_POLL_MS, seconds * 1_000);
  let job = await jobById(GRAPH_MAINTENANCE, door, { workspaceId, jobId });
  while (job.ok && !JOB_IS_OVER.includes(job.value.status) && io.clock.now().getTime() < deadline) {
    await after(Math.min(pollMs, Math.max(deadline - io.clock.now().getTime(), 0)));
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
    io.say("graph-rebuild: --wait takes no value; --wait-seconds takes a whole number of seconds");
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
  const git = openGit(io.gitStoreDir);
  if (!git.ok) {
    io.say(
      `reconcile-watermark: REFUSED — the repositories' root is ${git.error} (GIT_STORE_DIR=${io.gitStoreDir})`,
    );
    return REFUSED;
  }
  const doors = { git: git.value, postgres: openPostgres(pool), clock: io.clock };
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

/**
 * The rehearsal's own refusals, as an operator reads them. `malformed` is left as the word
 * `refused` keys on, so a `--workspace` that is not an id answers usage there rather than
 * refusing here; the other one is a sentence, because *not-seeded* on a drill day means the
 * two phases were run out of order or against different workspaces, and that is what to say.
 */
const rehearsalReason = (reason: RehearsalRefusal | Error): string | Error =>
  reason === "not-seeded"
    ? "no synthetic subject stands in this workspace — phase one (--seed) has not been run here, or its subject has already been erased"
    : reason;

/**
 * **The drill's proof that an erasure erases** (ADR 0022; the S0 spec, *The two ops commands*).
 *
 * Two phases, because the drill takes a `pg_dump` between them: phase one puts a synthetic
 * subject in the workspace and phase two erases them, and the dump in the middle is what
 * `dump-grep` looks for the subject in, before and after. The phases share no state but the
 * workspace id — phase two finds the subject from the rows — so this command hands the second
 * nothing the first knew, and the tokens are printed **on the last line** of each so the
 * script can read them off with `tail -1` and pass them straight to `--tokens`.
 *
 * Both phases write through the erasure slice under the platform's own principal; what is
 * here is the flags, the report's file and the lines.
 */
const erasureRehearsal = async (
  pool: Pool,
  workspaceId: string,
  flags: Flags,
  io: OpsIo,
): Promise<number> => {
  if (flags.get("synthetic") !== true) {
    // The only subject this creates is a synthetic one and the only thing it does to them is
    // erase them, so the flag is the operator saying out loud that this workspace is one
    // where that is allowed. A drill runs against staging; nothing stops this image being
    // the production one.
    io.say(
      "erasure-rehearsal: --synthetic is required — this command creates a synthetic subject and then erases them, and the flag is the caller saying this workspace is somewhere that may happen",
    );
    return USAGE;
  }
  const seeding = flags.get("seed") === true;
  const running = flags.get("run") === true;
  if (seeding === running) {
    io.say(
      "erasure-rehearsal: exactly one of --seed (phase one) or --run --report <file> (phase two); the drill takes a dump between them",
    );
    return USAGE;
  }
  const reportPath = flagValue(flags, "report");
  if (running && reportPath === undefined) {
    io.say(
      "erasure-rehearsal: --run needs --report <file> — the report is what the drill keeps, and a run whose report went nowhere proved nothing",
    );
    return USAGE;
  }
  const doors = erasureDoors(pool, io);
  if (!doors.ok) {
    io.say(`erasure-rehearsal: REFUSED — ${doors.error}`);
    return REFUSED;
  }

  if (seeding) {
    const seeded = await seedSyntheticSubject(ERASURE, doors.value, { workspaceId });
    if (!seeded.ok) {
      return refused("erasure-rehearsal", workspaceId, rehearsalReason(seeded.error), io);
    }
    io.say(
      `erasure-rehearsal: done — the synthetic subject of ${workspaceId} is seeded (a user row, an Admin membership and one concept file naming them); take the dump, then run phase two`,
    );
    io.say(seeded.value.tokens.join(","));
    return DONE;
  }

  const rehearsed = await rehearseErasure(ERASURE, doors.value, { workspaceId });
  if (!rehearsed.ok) {
    return refused("erasure-rehearsal", workspaceId, rehearsalReason(rehearsed.error), io);
  }
  const written = await writeTheReport(reportPath ?? "", rehearsed.value.report, io);
  if (written !== undefined) {
    // The erasure has happened — this is the report failing to land, which is a refusal
    // because the drill's whole output is that file, and it says so rather than implying
    // the routine did not run.
    io.say(
      `erasure-rehearsal: REFUSED — the erasure ran and completed at ${rehearsed.value.completedAt.toISOString()}, but its report could not be written to ${reportPath ?? ""}: ${written}`,
    );
    return REFUSED;
  }
  io.say(
    `erasure-rehearsal: done — erased the synthetic subject of ${workspaceId} under request ${rehearsed.value.subjectRequestId}; the report is at ${reportPath ?? ""}`,
  );
  io.say(rehearsed.value.tokens.join(","));
  return DONE;
};

/** The report written through the injected writer; the reason it could not be, or nothing. */
const writeTheReport = async (
  path: string,
  body: string,
  io: OpsIo,
): Promise<string | undefined> => {
  if (io.writeReport === undefined) {
    return "this process has no way to write a file, which is a wiring fault and not an operator's";
  }
  try {
    await io.writeReport(path, body);
    return undefined;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
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
  if (command === "replay-erasures") return replayErasuresCommand(pool, flags, io);
  if (command === "smoke") return smoke(flags, io);
  if (command === "dump-grep") return dumpGrep(flags, io);
  if (isSliceCommand(command)) return sliceCommand(command, pool, flags, io);
  io.say(`unknown command: ${command}\n${USAGE_TEXT}`);
  return USAGE;
};
