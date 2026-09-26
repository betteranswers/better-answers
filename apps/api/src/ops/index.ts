import type { Logger } from "pino";

import type { Sensitivity } from "@better-answers/core/access";
import {
  GRAPH_MAINTENANCE,
  graphCounts,
  IMPORT_SENSITIVITY_DEFAULT,
  importBundle,
  RECONCILER,
  rebuildGraph,
  reconcile,
  sweepGraph,
  type BundleImported,
  type BundleTree,
  type ConceptRewritten,
  type ImportBundleRefusal,
  type UnsoundReason,
} from "@better-answers/core/concepts";
import {
  ERASURE,
  rehearseErasure,
  replayErasures,
  seedSyntheticSubject,
  type ErasureDoors,
  type ErasureLog,
  type RehearsalRefusal,
} from "@better-answers/core/erasure";
import {
  attempt,
  err,
  ok,
  type PlatformPrincipal,
  type RefusalClass,
  type Result,
} from "@better-answers/core/kernel";
import {
  JOB_IS_OVER,
  jobById,
  type JobStatus,
  type RebuildReason,
} from "@better-answers/core/runs";
import {
  ORPHANED_UPLOAD_GRACE_HOURS,
  sweepOrphanedUploads,
  UPLOAD_SWEEP,
} from "@better-answers/core/sources";
import { initRepository, type GitDoor } from "@better-answers/core/store/git";
import { tablesPresent, type PostgresDoor } from "@better-answers/core/store/postgres";
import { SWEEPS, withSweepLock } from "@better-answers/core/sweeps";
import {
  addMember,
  BOOTSTRAP,
  personIdByEmail,
  principalOfMember,
  provisionWorkspace,
  renameWorkspace,
  setOperatorMark,
  type AddMemberRefusal,
  type ProvisionRefusal,
  type RenameRefusal,
} from "@better-answers/core/workspaces";
import { REBUILD_REASONS, ROLES, SENSITIVITIES, ulid } from "@better-answers/schema";

import { doorTold, type Doors } from "../doors.ts";
import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import { isRefusalWord, refusalOf } from "../refusal.ts";

const DONE = 0;
const REFUSED = 1;
const USAGE = 2;
export const NOT_BUILT = 3;

/**
 * A wrapper reads the code alone, so a precondition it can wait on never shares one with a fault.
 */
export const EXIT_OF_CLASS = {
  malformed: USAGE,
  unauthenticated: 4,
  forbidden: 5,
  absent: 6,
  inapplicable: 7,
  conflict: 8,
  precondition: 9,
} as const satisfies Readonly<Record<RefusalClass, number>>;

export type OpsIo = {
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;

  readonly stdin: () => Promise<string>;
  readonly say: (line: string) => void;

  readonly logger: Logger;

  /** The smoke test sends the app hostname as its `host`; absent, it sends none. */
  readonly appHostname?: string | undefined;

  readonly writeReport?: ((path: string, body: string) => Promise<void>) | undefined;

  readonly readTree?: ((directory: string) => Promise<BundleTree>) | undefined;
};

/** Takes a dump stamp (`20260601T120000Z`) or any instant `Date` reads; `undefined` is neither. */
export const parseSince = (value: string): Date | undefined => {
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  const iso =
    stamp === null
      ? value
      : `${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:${stamp[6]}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

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

const NEEDS = {
  "graph-rebuild": ["graph_generation", "graph_node", "graph_edge", "job"],
  "graph-sweep": ["graph_generation", "graph_node", "graph_edge"],
  "graph-counts": ["graph_generation", "graph_node", "graph_edge"],
  "reconcile-watermark": ["concept_index", "bundle_commit"],
  "object-store-orphans": ["source_document"],
  "erasure-rehearsal": ["erasure_request", "suppression"],
  "import-bundle": ["concept_index", "bundle_commit", "concept_verification"],
} as const;

type SliceCommand = keyof typeof NEEDS;

const isSliceCommand = (command: string): command is SliceCommand => Object.hasOwn(NEEDS, command);

export const SLICE_COMMANDS: readonly SliceCommand[] = Object.keys(NEEDS).filter(isSliceCommand);

const REBUILD_DEFAULT_REASON = "drill";

const WAIT_SECONDS = 120;
const WAIT_POLL_MS = 2_000;

const USAGE_TEXT = `usage: pnpm ops <command> [options]
  replay-erasures --since <dump stamp | ISO instant>      re-apply every erasure completed after a dump (mandatory in every restore)
  graph-rebuild --workspace <id> [--reason <word>] [--wait | --wait-seconds <n>]   the map made again by the worker
    --reason  one of ${REBUILD_REASONS.join(" · ")} (default ${REBUILD_DEFAULT_REASON})
    --wait    poll the job until it is over, ${WAIT_SECONDS} seconds — the rebuild's own budget
    --wait-seconds <n>  the same, for a whole number of seconds an operator names instead
  graph-sweep --workspace <id>                              delete every generation of the map but the live one
  graph-counts --workspace <id>                             nodes per label and edges, as JSON, for the drill's diff
  reconcile-watermark --workspace <id>                      recovery order step 2: replay the commits the rows missed
  object-store-orphans --workspace <id> [--list]            recovery order step 5: remove the originals a failed bind or a lost race left, past a ${ORPHANED_UPLOAD_GRACE_HOURS}-hour grace, that no document row names
    --list         say how many there are, removing none
  smoke --url <origin> [--workspace <id>] [--find] [--guide] [--ask]
  erasure-rehearsal --workspace <id> --synthetic --seed [--wait-seconds <n>]
                                                            phase one: the synthetic subject and a document naming them, waited on until indexed; its tokens on the last line
    --wait-seconds <n>  how long to wait for the document's index job (default ${WAIT_SECONDS})
  erasure-rehearsal --workspace <id> --synthetic --run --report <file>   phase two: erase them, write the report, print the tokens again
  dump-grep --tokens <a,b,…>                                stdin: a plain-SQL dump; per token, which COPY section holds it and in how many lines — never a line
  provision-workspace --name <name> --slug <slug> --admin <email>
                                                            a client's workspace with its first Admin, a person who has signed in; the id it minted is first on the done line
  add-member --workspace <id> --email <email> --role <${ROLES.join("|")}>
                                                            a signed-in person made a member of the workspace; a repeat is refused and never changes a role
  rename-workspace --workspace <id> [--name <name>] [--slug <slug>]
                                                            the workspace's name, its slug, or both; at least one is named, and the other kept
  operator --email <email> --grant|--revoke                 a signed-in person made the platform's operator, or no longer; each change on the identity-set audit log
  import-bundle --workspace <id> --from <directory> --as <member email> [--sensitivity <class>] [--dry-run]
                                                            the company's bundle landed through the governed write, its checks imported, its links rewritten to iris
    --sensitivity  one of ${SENSITIVITIES.join(" · ")} (default ${IMPORT_SENSITIVITY_DEFAULT})
    --dry-run      validate the tree and say what a run would do, writing nothing
exit codes: ${DONE} done · ${REFUSED} refused in no registered word, stop · ${USAGE} usage, or a malformed argument · ${NOT_BUILT} the slice this needs has no tables yet
  a refusal in a registered word exits with its class's code: ${Object.entries(EXIT_OF_CLASS)
    .map(([refusalClass, code]) => `${code} ${refusalClass}`)
    .join(" · ")}`;

const bundleStore = (doors: Doors, purpose: string): Result<GitDoor, string> =>
  doorTold(
    doors.git,
    `no repositories' root is configured (GIT_STORE_DIR), so ${purpose}; the estate sets it to /data/git on the api service`,
  );

const erasureDoors = (doors: Doors, log: ErasureLog): Result<ErasureDoors, string> => {
  const git = bundleStore(doors, "the bundles an erasure rewrites cannot be opened");
  if (!git.ok) return err(git.error);
  const objects = doorTold(
    doors.objects,
    "no object store is configured (S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY on the api service), so the replay copies an erasure leaves cannot be read",
  );
  if (!objects.ok) return err(objects.error);
  return ok({
    git: git.value,
    postgres: doors.postgres,
    objects: objects.value,
    clock: doors.clock,
    log,
  });
};

const replayErasuresCommand = async (doors: Doors, flags: Flags, io: OpsIo): Promise<number> => {
  const sinceArgument = flagValue(flags, "since");
  const since = sinceArgument === undefined ? undefined : parseSince(sinceArgument);
  if (since === undefined) {
    io.say("replay-erasures: --since <dump stamp or ISO instant> is required");
    return USAGE;
  }
  const present = await tablesPresent(doors.postgres, ["erasure_request"]);
  if (present.length === 0) {
    io.say(
      `replayed 0 erasures since ${since.toISOString()}: no erasure_request table exists in this schema, so no erasure has ever been recorded here`,
    );
    return DONE;
  }
  const opened = erasureDoors(doors, io.logger);
  if (!opened.ok) {
    io.say(`replay-erasures: REFUSED — ${opened.error}; do not start api`);
    return REFUSED;
  }
  const replayed = await replayErasures(ERASURE, opened.value, { since });
  if (!replayed.ok) {
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

    io.say(`note ${entry}: needs a minted token — proved by hand through the connector, not here`);
  }
  return failed === 0 ? DONE : REFUSED;
};

const OUTSIDE_ANY_SECTION = "";

const SECTION_OPENS = /^COPY\s+([^\s(]+)/;

const maskToken = (token: string): string =>
  token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-2)}` : token;

type ScannedLine = { readonly table: string | undefined; readonly countable: boolean };

const scanLine = (table: string | undefined, line: string): ScannedLine => {
  if (table === undefined) {
    const opened = SECTION_OPENS.exec(line)?.[1];
    return { table: opened, countable: opened === undefined };
  }
  return line === "\\." ? { table: undefined, countable: false } : { table, countable: true };
};

const countTokens = (
  hits: ReadonlyMap<string, Map<string, number>>,
  tokens: readonly string[],
  line: string,
  where: string,
): void => {
  for (const token of tokens) {
    if (!line.includes(token)) continue;
    const counted = hits.get(token);
    counted?.set(where, (counted.get(where) ?? 0) + 1);
  }
};

const perSectionHits = (
  text: string,
  tokens: readonly string[],
): ReadonlyMap<string, ReadonlyMap<string, number>> => {
  const hits = new Map<string, Map<string, number>>(
    tokens.map((token) => [token, new Map<string, number>()]),
  );
  let table: string | undefined;
  for (const line of text.split("\n")) {
    const scanned = scanLine(table, line);
    table = scanned.table;
    if (scanned.countable) countTokens(hits, tokens, line, table ?? OUTSIDE_ANY_SECTION);
  }
  return hits;
};

const dumpGrep = async (flags: Flags, io: OpsIo): Promise<number> => {
  const tokens = [
    ...new Set(
      (flagValue(flags, "tokens") ?? "")
        .split(",")
        .map((token) => token.trim())
        .filter((token) => token.length > 0),
    ),
  ];
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
  doors: Doors,
  flags: Flags,
  io: OpsIo,
): Promise<number> => {
  const workspaceId = flagValue(flags, "workspace");
  if (workspaceId === undefined) {
    io.say(`${command}: --workspace <id> is required`);
    return USAGE;
  }
  const needed = NEEDS[command];
  const present = await tablesPresent(doors.postgres, needed);
  if (present.length < needed.length) {
    io.say(
      `${command}: not built — ${needed.filter((name) => !present.includes(name)).join(", ")} absent from this schema; the slice that owns them has not landed`,
    );
    return NOT_BUILT;
  }
  return SLICE_RUNNERS[command](doors, workspaceId, flags, io);
};

export const reasonOf = (reason: string | Error): string =>
  typeof reason === "string" ? reason : reason.message;

const refused = (
  command: string,
  workspaceId: string,
  reason: string | Error,
  io: OpsIo,
): number => {
  if (!isRefusalWord(reason)) {
    io.say(`${command}: REFUSED — ${reasonOf(reason)}`);
    return REFUSED;
  }
  const refusal = refusalOf(reason);
  const about =
    refusal.word === "malformed" ? `: --workspace ${workspaceId} is not a workspace id` : "";
  io.say(`${command}: REFUSED — ${refusal.word}${about}`);
  return EXIT_OF_CLASS[refusal.class];
};

const graphCountsCommand = async (
  doors: Doors,
  workspaceId: string,
  io: OpsIo,
): Promise<number> => {
  const counted = await graphCounts(GRAPH_MAINTENANCE, doors.postgres, { workspaceId });
  if (!counted.ok) return refused("graph-counts", workspaceId, counted.error, io);
  const { liveGen, nodes, edges } = counted.value;
  io.say(JSON.stringify({ live_gen: liveGen, nodes, edges }));
  return DONE;
};

const rebuildReasonOf = (flags: Flags): RebuildReason | undefined => {
  const given = flagValue(flags, "reason") ?? REBUILD_DEFAULT_REASON;
  return REBUILD_REASONS.find((reason) => reason === given);
};

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

const jobAfterWaiting = async (
  platform: PlatformPrincipal,
  doors: Doors,
  job: { readonly workspaceId: string; readonly jobId: string },
  seconds: number,
) => {
  const deadline = doors.clock.now().getTime() + seconds * 1_000;
  const pollMs = Math.min(WAIT_POLL_MS, seconds * 1_000);
  let read = await jobById(platform, doors.postgres, job);
  while (
    read.ok &&
    !JOB_IS_OVER.includes(read.value.status) &&
    doors.clock.now().getTime() < deadline
  ) {
    await after(Math.min(pollMs, Math.max(deadline - doors.clock.now().getTime(), 0)));
    read = await jobById(platform, doors.postgres, job);
  }
  return read;
};

const unfinished = (
  job: { readonly status: JobStatus; readonly attempts: number },
  seconds: number,
  consequence: string,
): string =>
  JOB_IS_OVER.includes(job.status)
    ? `${job.status} after ${counted(job.attempts, "attempt")}; the job's own row says what it found`
    : `still ${job.status} after ${counted(seconds, "second")}, so ${consequence}`;

const waitForJob = async (
  doors: Doors,
  workspaceId: string,
  jobId: string,
  seconds: number,
  io: OpsIo,
): Promise<number> => {
  const job = await jobAfterWaiting(GRAPH_MAINTENANCE, doors, { workspaceId, jobId }, seconds);
  if (!job.ok) return refused("graph-rebuild", workspaceId, job.error, io);
  if (job.value.status === "done") {
    io.say(
      `graph-rebuild: done — job ${jobId} rebuilt the map on ${counted(job.value.attempts, "attempt")}`,
    );
    return DONE;
  }
  io.say(
    `graph-rebuild: REFUSED — job ${jobId} is ${unfinished(job.value, seconds, "nothing has rebuilt this map")}`,
  );
  return REFUSED;
};

const graphRebuildCommand = async (
  doors: Doors,
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
  const enqueued = await rebuildGraph(GRAPH_MAINTENANCE, doors.postgres, { workspaceId, reason });
  if (!enqueued.ok) return refused("graph-rebuild", workspaceId, enqueued.error, io);
  const { jobId } = enqueued.value;
  if (wait === undefined) {
    io.say(`graph-rebuild: done — enqueued ${jobId}`);
    return DONE;
  }
  return waitForJob(doors, workspaceId, jobId, wait, io);
};

const plural = (many: number, noun: string): string => `${noun}${many === 1 ? "" : "s"}`;
const counted = (many: number, noun: string): string => `${many} ${plural(many, noun)}`;

const graphSweepCommand = async (doors: Doors, workspaceId: string, io: OpsIo): Promise<number> => {
  const swept = await withSweepLock(SWEEPS, doors.postgres, () =>
    sweepGraph(GRAPH_MAINTENANCE, doors.postgres, { workspaceId }),
  );
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

const objectStoreOrphans = async (
  doors: Doors,
  workspaceId: string,
  flags: Flags,
  io: OpsIo,
): Promise<number> => {
  const listing = flags.get("list");
  if (listing !== undefined && listing !== true) {
    io.say("object-store-orphans: --list takes no value");
    return USAGE;
  }
  const objects = doorTold(
    doors.objects,
    "no object store is configured (S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY on the api service), so the bytes a failed bind left cannot be reached",
  );
  if (!objects.ok) {
    io.say(`object-store-orphans: REFUSED — ${objects.error}`);
    return REFUSED;
  }
  const swept = await withSweepLock(SWEEPS, doors.postgres, () =>
    sweepOrphanedUploads(
      UPLOAD_SWEEP,
      { postgres: doors.postgres, objects: objects.value },
      { workspaceId, now: doors.clock.now(), dryRun: listing === true },
    ),
  );
  if (!swept.ok) return refused("object-store-orphans", workspaceId, swept.error, io);
  const past = `past the ${ORPHANED_UPLOAD_GRACE_HOURS}-hour grace no document names`;
  io.say(
    listing === true
      ? `object-store-orphans: done — ${counted(swept.value.found, "object")} ${past}, removed none`
      : `object-store-orphans: done — removed ${counted(swept.value.removed, "object")} ${past}`,
  );
  return DONE;
};

const reconcileWatermark = async (
  doors: Doors,
  workspaceId: string,
  io: OpsIo,
): Promise<number> => {
  const git = bundleStore(doors, "the bundle cannot be opened");
  if (!git.ok) {
    io.say(`reconcile-watermark: REFUSED — ${git.error}`);
    return REFUSED;
  }
  const bundle = { git: git.value, postgres: doors.postgres, clock: doors.clock };
  const run = await reconcile(RECONCILER, bundle, { workspaceId });
  if (!run.ok) return refused("reconcile-watermark", workspaceId, run.error, io);
  const { head, watermark, replayed, skipped, stopped } = run.value;
  const found = `head ${head ?? "none"}, watermark ${watermark ?? "none"}, replayed ${replayed.length}, already landed ${skipped.length}`;
  if (stopped !== undefined) {
    io.say(
      `reconcile-watermark: REFUSED — stopped at ${stopped.sha} (${reasonOf(stopped.reason)}); ${found}; every commit before it landed and nothing after it was attempted, and this workspace stays behind that commit until a person acts`,
    );
    return REFUSED;
  }
  io.say(`reconcile-watermark: done — ${found}`);
  return DONE;
};

const UNSOUND_WORDS = {
  "manifest-missing": () => "the tree has no manifest.yaml at its root",
  "manifest-malformed": (about) =>
    `manifest.yaml does not carry the five keys the platform reads (${about})`,
  "does-not-parse": (about) => `does not parse (${about})`,
  "type-or-title-missing": (about) => `has no ${about}`,
  "reserved-path": (about) => `sits at a path the platform keeps for itself (${about})`,
  "path-refused": (about) => `sits at a path the platform cannot hold (${about})`,
  "link-outside-tree": (about) => `links to ${about}, which is not a concept in the tree`,
  "verifier-not-a-member": (about) =>
    `is verified by ${about}, who is not a member of this workspace; invite them first`,
  "merge-key-clash": (about) => `derives the same merge key as ${about}`,
} satisfies Readonly<Record<UnsoundReason, (about: string) => string>>;

const linksOf = (rewritten: readonly ConceptRewritten[]): number =>
  rewritten.reduce((sum, concept) => sum + concept.links, 0);

const importReason = (refusal: ImportBundleRefusal | Error, email: string): string => {
  if (refusal instanceof Error) return refusal.message;
  if (typeof refusal === "string") {
    switch (refusal) {
      case "role-forbids":
        return `${email} is a Viewer of this workspace; the import runs as an Admin or an Editor`;
      case "manifest-taken":
        return "a manifest with another bundle id already stands in this workspace's bundle";
      case "no-such-repository":
        return "this workspace has no bundle repository; provision it first";
      case "class-unreadable":
        return `${email} is not an Admin of this workspace, and a bundle landed Restricted is one only an Admin can read back for its second pass; run the import as an Admin`;
      default:
        return refusal;
    }
  }
  if (refusal.kind === "unsound") {
    return `${refusal.file}: ${UNSOUND_WORDS[refusal.reason](refusal.about)}; nothing was written`;
  }
  const { landed, skipped, checks, rewritten } = refusal.progress;
  return `stopped at ${refusal.file} (${reasonOf(refusal.reason)}); landed ${landed.length}, skipped ${skipped.length}, checks ${checks.recorded} recorded, ${counted(linksOf(rewritten), "link")} rewritten; what landed stays, and a rerun continues from there`;
};

type ImportAsked = {
  readonly from: string;
  readonly email: string;
  readonly sensitivity: Sensitivity;
  readonly dryRun: boolean;
};

const importAskedOf = (flags: Flags): Result<ImportAsked, string> => {
  const from = flagValue(flags, "from");
  const email = flagValue(flags, "as");
  const asked = flagValue(flags, "sensitivity") ?? IMPORT_SENSITIVITY_DEFAULT;
  const sensitivity = SENSITIVITIES.find((word) => word === asked);
  const dryRun = flags.get("dry-run");
  if (from === undefined || email === undefined) {
    return err("--from <directory> and --as <member email> are required");
  }
  if (sensitivity === undefined) {
    return err(`--sensitivity must be one of ${SENSITIVITIES.join(", ")}`);
  }
  if (dryRun !== undefined && dryRun !== true) return err("--dry-run takes no value");
  return ok({ from, email, sensitivity, dryRun: dryRun === true });
};

const treeUnder = async (io: OpsIo, from: string): Promise<Result<BundleTree, string>> => {
  const readTree = io.readTree;
  if (readTree === undefined) {
    return err(
      "this process has no way to read a directory, which is a wiring fault and not an operator's",
    );
  }
  const tree = await attempt(() => readTree(from));
  return tree.ok
    ? ok(tree.value)
    : err(`the directory ${from} could not be read: ${tree.error.message}`);
};

const sayImported = (io: OpsIo, imported: BundleImported, seconds: string): void => {
  const { bundleId, manifest, landed, skipped, checks, rewritten, concepts } = imported;
  const recorded = `${counted(checks.recorded, "check")} recorded (${checks.present} already present)`;
  const links = counted(linksOf(rewritten), "link");
  if (imported.dryRun) {
    const standing = manifest === "standing" ? "already stands" : "would be written first";
    io.say(
      `import-bundle: dry run — the tree is sound: ${counted(concepts, "concept")}, of which ${landed.length} would land and ${skipped.length} already stand; ${recorded.replace(" recorded", " would be recorded")}; ${links} in ${counted(rewritten.length, "concept")} would be rewritten; manifest ${bundleId} ${standing}; nothing was written`,
    );
    return;
  }
  io.say(
    `import-bundle: manifest ${bundleId} ${manifest === "written" ? "written as the bundle's first commit" : "already stands"}`,
  );
  const outcomes = [
    ...landed.map((path) => [path, `landed ${path}`] as const),
    ...skipped.map((path) => [path, `skipped ${path} — already landed`] as const),
  ].toSorted(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0));
  for (const [, line] of outcomes) io.say(`import-bundle: ${line}`);
  for (const concept of rewritten) {
    io.say(`import-bundle: rewrote ${concept.path} — ${counted(concept.links, "link")}`);
  }
  io.say(
    `import-bundle: done — landed ${landed.length}, skipped ${skipped.length}, ${recorded}, ${links} rewritten, ${seconds} seconds`,
  );
};

const importBundleCommand = async (
  doors: Doors,
  workspaceId: string,
  flags: Flags,
  io: OpsIo,
): Promise<number> => {
  const asked = importAskedOf(flags);
  if (!asked.ok) {
    io.say(`import-bundle: ${asked.error}`);
    return USAGE;
  }
  const { from, email, sensitivity, dryRun } = asked.value;
  const git = bundleStore(doors, "the bundle the import writes into cannot be opened");
  if (!git.ok) {
    io.say(`import-bundle: REFUSED — ${git.error}`);
    return REFUSED;
  }
  const tree = await treeUnder(io, from);
  if (!tree.ok) {
    io.say(`import-bundle: REFUSED — ${tree.error}`);
    return REFUSED;
  }
  const postgres = doors.postgres;
  const principal = await principalOfMember(postgres, {
    workspaceId,
    email,
    at: doors.clock.now(),
  });
  if (!principal.ok) {
    const reason =
      principal.error === "not-a-member"
        ? `${email} is not a member of workspace ${workspaceId}; invite them first`
        : principal.error;
    return refused("import-bundle", workspaceId, reason, io);
  }
  const started = doors.clock.now();
  const run = await importBundle(
    principal.value,
    { git: git.value, postgres, clock: doors.clock },
    { tree: tree.value, sensitivity, dryRun },
  );
  const seconds = ((doors.clock.now().getTime() - started.getTime()) / 1_000).toFixed(1);
  if (!run.ok) {
    io.say(`import-bundle: REFUSED — ${importReason(run.error, email)}`);
    return REFUSED;
  }
  sayImported(io, run.value, seconds);
  return DONE;
};

const rehearsalReason = (reason: RehearsalRefusal | Error): string | Error =>
  reason === "not-seeded"
    ? "no synthetic subject stands in this workspace — phase one (--seed) has not been run here, or its subject has already been erased"
    : reason;

const seedingToBeDumped = async (
  doors: Doors,
  erasure: ErasureDoors,
  workspaceId: string,
  waitSeconds: number,
  io: OpsIo,
): Promise<number> => {
  const seeded = await seedSyntheticSubject(ERASURE, erasure, { workspaceId });
  if (!seeded.ok) {
    return refused("erasure-rehearsal", workspaceId, rehearsalReason(seeded.error), io);
  }
  // A dump taken before the worker indexes the document holds no chunk naming the subject,
  // and phase two would then prove nothing about the index.
  const { indexJobId } = seeded.value.document;
  const indexed = await jobAfterWaiting(
    ERASURE,
    doors,
    { workspaceId, jobId: indexJobId },
    waitSeconds,
  );
  if (!indexed.ok) return refused("erasure-rehearsal", workspaceId, indexed.error, io);
  if (indexed.value.status !== "done") {
    io.say(
      `erasure-rehearsal: REFUSED — the synthetic subject's document is not indexed: job ${indexJobId} is ${unfinished(indexed.value, waitSeconds, "no worker has indexed it")}`,
    );
    return REFUSED;
  }
  io.say(
    `erasure-rehearsal: done — the synthetic subject of ${workspaceId} is seeded (a user row, an Admin membership, one concept file and one indexed document naming them); take the dump, then run phase two`,
  );
  io.say(seeded.value.tokens.join(","));
  return DONE;
};

type RehearsalAsked =
  | { readonly phase: "seed"; readonly waitSeconds: number }
  | { readonly phase: "run"; readonly reportPath: string };

const WAIT_SECONDS_MALFORMED = "--wait-seconds takes a whole number of seconds";

const rehearsalAskedOf = (flags: Flags): Result<RehearsalAsked, string> => {
  if (flags.get("synthetic") !== true) {
    return err(
      "--synthetic is required — this command creates a synthetic subject and then erases them, and the flag is the caller saying this workspace is somewhere that may happen",
    );
  }
  const seeding = flags.get("seed") === true;
  if (seeding === (flags.get("run") === true)) {
    return err(
      "exactly one of --seed (phase one) or --run --report <file> (phase two); the drill takes a dump between them",
    );
  }
  const wait = waitSecondsOf(flags);
  if (seeding) {
    return wait === "malformed"
      ? err(WAIT_SECONDS_MALFORMED)
      : ok({ phase: "seed", waitSeconds: wait ?? WAIT_SECONDS });
  }
  const reportPath = flagValue(flags, "report");
  if (reportPath === undefined) {
    return err(
      "--run needs --report <file> — the report is what the drill keeps, and a run whose report went nowhere proved nothing",
    );
  }
  return wait === "malformed" ? err(WAIT_SECONDS_MALFORMED) : ok({ phase: "run", reportPath });
};

const erasedToTheReport = async (
  erasure: ErasureDoors,
  workspaceId: string,
  reportPath: string,
  io: OpsIo,
): Promise<number> => {
  const rehearsed = await rehearseErasure(ERASURE, erasure, { workspaceId });
  if (!rehearsed.ok) {
    return refused("erasure-rehearsal", workspaceId, rehearsalReason(rehearsed.error), io);
  }
  const written = await writeTheReport(reportPath, rehearsed.value.report, io);
  if (written !== undefined) {
    io.say(
      `erasure-rehearsal: REFUSED — the erasure ran and completed at ${rehearsed.value.completedAt.toISOString()}, but its report could not be written to ${reportPath}: ${written}`,
    );
    return REFUSED;
  }
  io.say(
    `erasure-rehearsal: done — erased the synthetic subject of ${workspaceId} under request ${rehearsed.value.subjectRequestId}; the report is at ${reportPath}`,
  );
  io.say(rehearsed.value.tokens.join(","));
  return DONE;
};

const erasureRehearsal = async (
  doors: Doors,
  workspaceId: string,
  flags: Flags,
  io: OpsIo,
): Promise<number> => {
  const asked = rehearsalAskedOf(flags);
  if (!asked.ok) {
    io.say(`erasure-rehearsal: ${asked.error}`);
    return USAGE;
  }
  const opened = erasureDoors(doors, io.logger);
  if (!opened.ok) {
    io.say(`erasure-rehearsal: REFUSED — ${opened.error}`);
    return REFUSED;
  }
  const rehearsal = asked.value;
  if (rehearsal.phase === "seed") {
    return seedingToBeDumped(doors, opened.value, workspaceId, rehearsal.waitSeconds, io);
  }
  return erasedToTheReport(opened.value, workspaceId, rehearsal.reportPath, io);
};

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

const notSignedIn = (email: string): string =>
  `no-such-user: ${email} has not signed in; have them sign in with an email code first, then run this again`;

const noDisplayName = (email: string): string =>
  `no-display-name: ${email} has given no display name; have them sign in and give one, then run this again`;

const noSuchWorkspace = (workspaceId: string): string =>
  `no-such-workspace: ${workspaceId} is not a workspace`;

const provisionReason = (
  refusal: ProvisionRefusal | Error,
  slug: string,
  email: string,
): string => {
  if (refusal instanceof Error) return refusal.message;
  switch (refusal) {
    case "no-display-name":
      return noDisplayName(email);
    case "slug-taken":
      return `slug-taken: another workspace already holds the slug ${slug}`;
    case "malformed":
      return "malformed: the name and the slug must each carry at least one character";
    default:
      return refusal;
  }
};

const signedInPerson = async (
  postgres: PostgresDoor,
  email: string,
): Promise<Result<string, string>> => {
  const person = await personIdByEmail(BOOTSTRAP, postgres, email);
  if (!person.ok) return err(person.error.message);
  return person.value === undefined ? err(notSignedIn(email)) : ok(person.value);
};

/**
 * The repository lives outside the Postgres transaction, so the root is checked before the act
 * and the repository made after it.
 */
const provisionWorkspaceCommand = async (
  doors: Doors,
  flags: Flags,
  io: OpsIo,
): Promise<number> => {
  const name = flagValue(flags, "name");
  const slug = flagValue(flags, "slug");
  const email = flagValue(flags, "admin");
  if (name === undefined || slug === undefined || email === undefined) {
    io.say("provision-workspace: --name <name>, --slug <slug> and --admin <email> are required");
    return USAGE;
  }
  const git = bundleStore(doors, "the workspace's bundle repository cannot be created");
  if (!git.ok) {
    io.say(`provision-workspace: REFUSED — ${git.error}`);
    return REFUSED;
  }
  const postgres = doors.postgres;
  const admin = await signedInPerson(postgres, email);
  if (!admin.ok) {
    io.say(`provision-workspace: REFUSED — ${admin.error}`);
    return REFUSED;
  }
  const id = ulid();
  const provisioned = await provisionWorkspace(BOOTSTRAP, postgres, {
    id,
    name,
    slug,
    adminUserId: admin.value,
  });
  if (!provisioned.ok) {
    io.say(`provision-workspace: REFUSED — ${provisionReason(provisioned.error, slug, email)}`);
    return REFUSED;
  }
  const repository = await attempt(() => initRepository(git.value, id));
  if (!repository.ok) {
    io.say(
      `provision-workspace: REFUSED — workspace ${id} stands with ${email} as its Admin, but its bundle repository could not be created: ${repository.error.message}; a rerun is refused slug-taken, so create the repository by hand before any import`,
    );
    return REFUSED;
  }
  io.say(`provision-workspace: done — ${id}, slug ${slug}, Admin ${email}`);
  return DONE;
};

const memberReason = (
  refusal: AddMemberRefusal | Error,
  workspaceId: string,
  email: string,
): string | Error => {
  if (refusal instanceof Error) return refusal;
  switch (refusal) {
    case "no-such-user":
      return notSignedIn(email);
    case "no-display-name":
      return noDisplayName(email);
    case "no-such-workspace":
      return noSuchWorkspace(workspaceId);
    case "already-a-member":
      return `already-a-member: ${email} is already a member of workspace ${workspaceId}; a role change is the Admin's act on the People screen`;
    default:
      return refusal;
  }
};

const addMemberCommand = async (doors: Doors, flags: Flags, io: OpsIo): Promise<number> => {
  const workspaceId = flagValue(flags, "workspace");
  const email = flagValue(flags, "email");
  const asked = flagValue(flags, "role");
  if (workspaceId === undefined || email === undefined || asked === undefined) {
    io.say(
      `add-member: --workspace <id>, --email <email> and --role <${ROLES.join("|")}> are required`,
    );
    return USAGE;
  }
  const role = ROLES.find((word) => word === asked);
  if (role === undefined) {
    io.say(`add-member: --role must be one of ${ROLES.join(", ")}`);
    return USAGE;
  }
  const added = await addMember(BOOTSTRAP, doors.postgres, { workspaceId, email, role });
  if (!added.ok) {
    return refused("add-member", workspaceId, memberReason(added.error, workspaceId, email), io);
  }
  io.say(`add-member: done — ${email} added to workspace ${workspaceId} as ${role}`);
  return DONE;
};

const renameReason = (refusal: RenameRefusal | Error, workspaceId: string): string => {
  if (refusal instanceof Error) return refusal.message;
  switch (refusal) {
    case "malformed":
      return "malformed: give --workspace a workspace id, and --name, --slug or both a value that is not blank";
    case "no-such-workspace":
      return noSuchWorkspace(workspaceId);
    case "slug-taken":
      return "slug-taken: another workspace already holds that slug";
  }
};

const renameWorkspaceCommand = async (doors: Doors, flags: Flags, io: OpsIo): Promise<number> => {
  const workspaceId = flagValue(flags, "workspace");
  if (workspaceId === undefined) {
    io.say(
      "rename-workspace: --workspace <id> is required, with --name <name>, --slug <slug> or both",
    );
    return USAGE;
  }
  const renamed = await renameWorkspace(BOOTSTRAP, doors.postgres, {
    workspaceId,
    name: flagValue(flags, "name"),
    slug: flagValue(flags, "slug"),
  });
  if (!renamed.ok) {
    io.say(`rename-workspace: REFUSED — ${renameReason(renamed.error, workspaceId)}`);
    return renamed.error === "malformed" ? EXIT_OF_CLASS.malformed : REFUSED;
  }
  const { name, slug } = renamed.value;
  io.say(`rename-workspace: done — workspace ${workspaceId} is named ${name}, slug ${slug}`);
  return DONE;
};

const OPERATOR_USAGE = "operator: --email <email> and one of --grant or --revoke are required";

const MARK_SAID = {
  grant: { changed: "is the operator", unchanged: "was already the operator; nothing written" },
  revoke: {
    changed: "is no longer the operator",
    unchanged: "was not the operator; nothing written",
  },
} as const;

const operatorCommand = async (doors: Doors, flags: Flags, io: OpsIo): Promise<number> => {
  const email = flagValue(flags, "email");
  const granting = flags.has("grant");
  if (email === undefined || granting === flags.has("revoke")) {
    io.say(OPERATOR_USAGE);
    return USAGE;
  }
  const change = granting ? "grant" : "revoke";
  const marked = await setOperatorMark(IDENTITY_PRINCIPAL, doors.postgres, { email, change });
  if (!marked.ok) {
    const reason = marked.error === "no-such-user" ? notSignedIn(email) : marked.error.message;
    io.say(`operator: REFUSED — ${reason}`);
    return REFUSED;
  }
  const said = MARK_SAID[change][marked.value.changed ? "changed" : "unchanged"];
  io.say(`operator: done — ${email} ${said}`);
  return DONE;
};

const SLICE_RUNNERS = {
  "graph-rebuild": graphRebuildCommand,
  "graph-sweep": (doors, workspaceId, _flags, io) => graphSweepCommand(doors, workspaceId, io),
  "graph-counts": (doors, workspaceId, _flags, io) => graphCountsCommand(doors, workspaceId, io),
  "reconcile-watermark": (doors, workspaceId, _flags, io) =>
    reconcileWatermark(doors, workspaceId, io),
  "object-store-orphans": objectStoreOrphans,
  "erasure-rehearsal": erasureRehearsal,
  "import-bundle": importBundleCommand,
} satisfies Readonly<
  Record<
    SliceCommand,
    (doors: Doors, workspaceId: string, flags: Flags, io: OpsIo) => Promise<number>
  >
>;

const SLICELESS_COMMANDS = new Map<
  string,
  (doors: Doors, flags: Flags, io: OpsIo) => Promise<number>
>([
  ["replay-erasures", replayErasuresCommand],
  ["smoke", (_doors, flags, io) => smoke(flags, io)],
  ["dump-grep", (_doors, flags, io) => dumpGrep(flags, io)],
  ["provision-workspace", provisionWorkspaceCommand],
  ["add-member", addMemberCommand],
  ["rename-workspace", renameWorkspaceCommand],
  ["operator", operatorCommand],
]);

/**
 * Resolves to the exit code: 0 done, 1 refused in no registered word, 2 usage, `NOT_BUILT`, or
 * a registered word's `EXIT_OF_CLASS` code.
 */
export const runOps = async (argv: readonly string[], doors: Doors, io: OpsIo): Promise<number> => {
  const [command, ...rest] = argv[0] === "--" ? argv.slice(1) : argv;
  const flags = parseFlags(rest);
  if (command === undefined || command === "--help" || command === "help") {
    io.say(USAGE_TEXT);
    return command === undefined ? USAGE : DONE;
  }
  const run = SLICELESS_COMMANDS.get(command);
  if (run !== undefined) return run(doors, flags, io);
  if (isSliceCommand(command)) return sliceCommand(command, doors, flags, io);
  io.say(`unknown command: ${command}\n${USAGE_TEXT}`);
  return USAGE;
};
