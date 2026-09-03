import type { Pool } from "pg";

import { openPostgres, tablesPresent } from "@better-answers/core/store/postgres";

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
 * Nothing here reads the environment: the pool and every value come in as arguments
 * (`[SEC1]`, `[APP2]`).
 */

/** The contract's exit codes, by name: the scripts read them, so they are stated once. */
export const DONE = 0;
export const REFUSED = 1;
export const USAGE = 2;
export const NOT_BUILT = 3;

export type OpsIo = {
  /** A fetch the smoke test speaks through: `globalThis.fetch` in the process, `server.request` in a test. */
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Everything on stdin, for `dump-grep`. */
  readonly stdin: () => Promise<string>;
  readonly say: (line: string) => void;
  /** The app hostname the smoke test sends as `Host` when it is reached on the loopback. */
  readonly appHostname?: string | undefined;
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
  "graph-rebuild": ["graph_node", "graph_edge"],
  "graph-sweep": ["graph_node", "graph_edge"],
  "graph-counts": ["graph_node", "graph_edge"],
  "reconcile-watermark": ["concept_index"],
  "object-store-orphans": ["source_document"],
  "erasure-rehearsal": ["erasure_request", "suppression"],
} as const;

type SliceCommand = keyof typeof NEEDS;

const USAGE_TEXT = `usage: pnpm ops <command> [options]
  replay-erasures --since <dump stamp | ISO instant>      re-apply every erasure completed after a dump (mandatory in every restore)
  graph-rebuild | graph-sweep --workspace <id> [--wait]    the graph as a repair path (ADR 0023, 0032)
  graph-counts --workspace <id>                             nodes per label and edges, as JSON, for the drill's diff (the graph slice's)
  reconcile-watermark --workspace <id>                      recovery order step 2
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
  // The tables exist, so the slice has landed and its own query module answers this —
  // never SQL written here: the api tier is transports, and a tenant read belongs to
  // `packages/core` (ADR 0029). Until that module is wired in, refusing is the honest answer.
  io.say(
    `${command}: REFUSED — its tables exist but this image carries no implementation; the slice's task fills it in`,
  );
  return REFUSED;
};

const isSliceCommand = (command: string): command is SliceCommand => command in NEEDS;

export const runOps = async (argv: readonly string[], pool: Pool, io: OpsIo): Promise<number> => {
  const [command, ...rest] = argv;
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
