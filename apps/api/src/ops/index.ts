import {
  GRAPH_MAINTENANCE,
  graphCounts,
  IMPORT_SENSITIVITY_DEFAULT,
  importBundle,
  RECONCILER,
  reconcile,
  sweepGraph,
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
  type RehearsalRefusal,
} from "@better-answers/core/erasure";
import {
  attempt,
  err,
  ok,
  type Clock,
  type RefusalClass,
  type Result,
} from "@better-answers/core/kernel";
import { enqueueJob, JOB_IS_OVER, jobById, type RebuildReason } from "@better-answers/core/runs";
import {
  ORPHANED_UPLOAD_GRACE_HOURS,
  sweepOrphanedUploads,
  UPLOAD_SWEEP,
} from "@better-answers/core/sources";
import { initRepository, type GitDoor } from "@better-answers/core/store/git";
import type { ObjectDoor } from "@better-answers/core/store/objects";
import { tablesPresent, type PostgresDoor } from "@better-answers/core/store/postgres";
import {
  addMember,
  BOOTSTRAP,
  personIdByEmail,
  principalOfMember,
  provisionWorkspace,
  type AddMemberRefusal,
  type ProvisionRefusal,
} from "@better-answers/core/workspaces";
import {
  FULL_REBUILD_KIND,
  REBUILD_REASONS,
  ROLES,
  SENSITIVITIES,
  ulid,
} from "@better-answers/schema";

import { doorTold, type Doors } from "../doors.ts";

import { isRefusalWord, refusalOf } from "../refusal.ts";

const DONE = 0;
const REFUSED = 1;
const USAGE = 2;
export const NOT_BUILT = 3;

// A wrapper reads the code alone, so a precondition it can wait on never shares one with a fault.
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

  readonly appHostname?: string | undefined;

  readonly writeReport?: ((path: string, body: string) => Promise<void>) | undefined;

  readonly readTree?: ((directory: string) => Promise<BundleTree>) | undefined;
};

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

// SAFETY: the keys of a `const` object literal are its declared names and nothing else.
export const SLICE_COMMANDS = Object.keys(NEEDS) as readonly SliceCommand[];

const REBUILD_DEFAULT_REASON = "drill";

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
  object-store-orphans --workspace <id> [--list]            recovery order step 5: remove the originals a failed bind left, past a ${ORPHANED_UPLOAD_GRACE_HOURS}-hour grace, that no document row names
    --list         say how many there are, removing none
  smoke --url <origin> [--workspace <id>] [--find] [--guide] [--ask]
  erasure-rehearsal --workspace <id> --synthetic --seed      phase one: the synthetic subject, its tokens on the last line
  erasure-rehearsal --workspace <id> --synthetic --run --report <file>   phase two: erase them, write the report, print the tokens again
  dump-grep --tokens <a,b,…>                                stdin: a plain-SQL dump; per token, which COPY section holds it and in how many lines — never a line
  provision-workspace --name <name> --slug <slug> --admin <email>
                                                            a client's workspace with its first Admin, a person who has signed in; the id it minted is first on the done line
  add-member --workspace <id> --email <email> --role <${ROLES.join("|")}>
                                                            a signed-in person made a member of the workspace; a repeat is refused and never changes a role
  import-bundle --workspace <id> --from <directory> --as <member email> [--sensitivity <class>] [--dry-run]
                                                            the company's bundle landed through the governed write, its checks imported, its links rewritten to iris (ADR 0002, 0014)
    --sensitivity  one of ${SENSITIVITIES.join(" · ")} (default ${IMPORT_SENSITIVITY_DEFAULT})
    --dry-run      validate the tree and say what a run would do, writing nothing
exit codes: ${DONE} done · ${REFUSED} refused in no registered word, stop · ${USAGE} usage, or a malformed argument · ${NOT_BUILT} the slice this needs has no tables yet
  a refusal in a registered word exits with its class's code: ${Object.entries(EXIT_OF_CLASS)
    .map(([refusalClass, code]) => `${code} ${refusalClass}`)
    .join(" · ")}`;

type ErasureDoors = {
  readonly git: GitDoor;
  readonly postgres: PostgresDoor;
  readonly objects: ObjectDoor;
  readonly clock: Clock;
};

const bundleStore = (doors: Doors, purpose: string): Result<GitDoor, string> =>
  doorTold(
    doors.git,
    `no repositories' root is configured (GIT_STORE_DIR), so ${purpose}; the estate sets it to /data/git on the api service`,
  );

const erasureDoors = (doors: Doors): Result<ErasureDoors, string> => {
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
  const opened = erasureDoors(doors);
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
  if (command === "reconcile-watermark") return reconcileWatermark(doors, workspaceId, io);
  if (command === "graph-rebuild") return graphRebuildCommand(doors, workspaceId, flags, io);
  if (command === "graph-counts") return graphCountsCommand(doors, workspaceId, io);
  if (command === "graph-sweep") return graphSweepCommand(doors, workspaceId, io);
  if (command === "erasure-rehearsal") return erasureRehearsal(doors, workspaceId, flags, io);
  if (command === "object-store-orphans") return objectStoreOrphans(doors, workspaceId, flags, io);
  return importBundleCommand(doors, workspaceId, flags, io);
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

const waitForJob = async (
  doors: Doors,
  workspaceId: string,
  jobId: string,
  seconds: number,
  io: OpsIo,
): Promise<number> => {
  const door = doors.postgres;
  const deadline = doors.clock.now().getTime() + seconds * 1_000;
  const pollMs = Math.min(WAIT_POLL_MS, seconds * 1_000);
  let job = await jobById(GRAPH_MAINTENANCE, door, { workspaceId, jobId });
  while (
    job.ok &&
    !JOB_IS_OVER.includes(job.value.status) &&
    doors.clock.now().getTime() < deadline
  ) {
    await after(Math.min(pollMs, Math.max(deadline - doors.clock.now().getTime(), 0)));
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
  const door = doors.postgres;
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
  return waitForJob(doors, workspaceId, jobId, wait, io);
};

const plural = (many: number, noun: string): string => `${noun}${many === 1 ? "" : "s"}`;
const counted = (many: number, noun: string): string => `${many} ${plural(many, noun)}`;

const graphSweepCommand = async (doors: Doors, workspaceId: string, io: OpsIo): Promise<number> => {
  const swept = await sweepGraph(GRAPH_MAINTENANCE, doors.postgres, { workspaceId });
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
  const swept = await sweepOrphanedUploads(
    UPLOAD_SWEEP,
    { postgres: doors.postgres, objects: objects.value },
    { workspaceId, now: doors.clock.now(), dryRun: listing === true },
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
      `reconcile-watermark: REFUSED — stopped at ${stopped.sha} (${reasonOf(stopped.reason)}); ${found}; every commit before it landed and nothing after it was attempted, and this workspace stays behind that commit until a person acts (ADR 0012)`,
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

const importBundleCommand = async (
  doors: Doors,
  workspaceId: string,
  flags: Flags,
  io: OpsIo,
): Promise<number> => {
  const from = flagValue(flags, "from");
  const email = flagValue(flags, "as");
  const asked = flagValue(flags, "sensitivity") ?? IMPORT_SENSITIVITY_DEFAULT;
  const sensitivity = SENSITIVITIES.find((word) => word === asked);
  const dryRun = flags.get("dry-run");
  if (from === undefined || email === undefined) {
    io.say("import-bundle: --from <directory> and --as <member email> are required");
    return USAGE;
  }
  if (sensitivity === undefined) {
    io.say(`import-bundle: --sensitivity must be one of ${SENSITIVITIES.join(", ")}`);
    return USAGE;
  }
  if (dryRun !== undefined && dryRun !== true) {
    io.say("import-bundle: --dry-run takes no value");
    return USAGE;
  }
  const git = bundleStore(doors, "the bundle the import writes into cannot be opened");
  if (!git.ok) {
    io.say(`import-bundle: REFUSED — ${git.error}`);
    return REFUSED;
  }
  const readTree = io.readTree;
  if (readTree === undefined) {
    io.say(
      "import-bundle: REFUSED — this process has no way to read a directory, which is a wiring fault and not an operator's",
    );
    return REFUSED;
  }
  const tree = await attempt(() => readTree(from));
  if (!tree.ok) {
    io.say(
      `import-bundle: REFUSED — the directory ${from} could not be read: ${tree.error.message}`,
    );
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
    { tree: tree.value, sensitivity, dryRun: dryRun === true },
  );
  const seconds = ((doors.clock.now().getTime() - started.getTime()) / 1_000).toFixed(1);
  if (!run.ok) {
    io.say(`import-bundle: REFUSED — ${importReason(run.error, email)}`);
    return REFUSED;
  }
  const { bundleId, manifest, landed, skipped, checks, rewritten, concepts } = run.value;
  const recorded = `${counted(checks.recorded, "check")} recorded (${checks.present} already present)`;
  const links = counted(linksOf(rewritten), "link");
  if (run.value.dryRun) {
    const standing = manifest === "standing" ? "already stands" : "would be written first";
    io.say(
      `import-bundle: dry run — the tree is sound: ${counted(concepts, "concept")}, of which ${landed.length} would land and ${skipped.length} already stand; ${recorded.replace(" recorded", " would be recorded")}; ${links} in ${counted(rewritten.length, "concept")} would be rewritten; manifest ${bundleId} ${standing}; nothing was written`,
    );
    return DONE;
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
  return DONE;
};

const rehearsalReason = (reason: RehearsalRefusal | Error): string | Error =>
  reason === "not-seeded"
    ? "no synthetic subject stands in this workspace — phase one (--seed) has not been run here, or its subject has already been erased"
    : reason;

const erasureRehearsal = async (
  doors: Doors,
  workspaceId: string,
  flags: Flags,
  io: OpsIo,
): Promise<number> => {
  if (flags.get("synthetic") !== true) {
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
  const opened = erasureDoors(doors);
  if (!opened.ok) {
    io.say(`erasure-rehearsal: REFUSED — ${opened.error}`);
    return REFUSED;
  }

  if (seeding) {
    const seeded = await seedSyntheticSubject(ERASURE, opened.value, { workspaceId });
    if (!seeded.ok) {
      return refused("erasure-rehearsal", workspaceId, rehearsalReason(seeded.error), io);
    }
    io.say(
      `erasure-rehearsal: done — the synthetic subject of ${workspaceId} is seeded (a user row, an Admin membership and one concept file naming them); take the dump, then run phase two`,
    );
    io.say(seeded.value.tokens.join(","));
    return DONE;
  }

  const rehearsed = await rehearseErasure(ERASURE, opened.value, { workspaceId });
  if (!rehearsed.ok) {
    return refused("erasure-rehearsal", workspaceId, rehearsalReason(rehearsed.error), io);
  }
  const written = await writeTheReport(reportPath ?? "", rehearsed.value.report, io);
  if (written !== undefined) {
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

const provisionReason = (refusal: ProvisionRefusal | Error, slug: string): string => {
  if (refusal instanceof Error) return refusal.message;
  switch (refusal) {
    case "slug-taken":
      return `slug-taken: another workspace already holds the slug ${slug}`;
    case "malformed":
      return "malformed: the name and the slug must each carry at least one character";
    default:
      return refusal;
  }
};

// The repository lives outside the Postgres transaction, so the root is checked before the act
// and the repository made after it.
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
  const admin = await personIdByEmail(BOOTSTRAP, postgres, email);
  if (!admin.ok) {
    io.say(`provision-workspace: REFUSED — ${admin.error.message}`);
    return REFUSED;
  }
  if (admin.value === undefined) {
    io.say(`provision-workspace: REFUSED — ${notSignedIn(email)}`);
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
    io.say(`provision-workspace: REFUSED — ${provisionReason(provisioned.error, slug)}`);
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
    case "no-such-workspace":
      return `no-such-workspace: ${workspaceId} is not a workspace`;
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

const isSliceCommand = (command: string): command is SliceCommand => command in NEEDS;

export const runOps = async (argv: readonly string[], doors: Doors, io: OpsIo): Promise<number> => {
  const [command, ...rest] = argv[0] === "--" ? argv.slice(1) : argv;
  const flags = parseFlags(rest);
  if (command === undefined || command === "--help" || command === "help") {
    io.say(USAGE_TEXT);
    return command === undefined ? USAGE : DONE;
  }
  if (command === "replay-erasures") return replayErasuresCommand(doors, flags, io);
  if (command === "smoke") return smoke(flags, io);
  if (command === "dump-grep") return dumpGrep(flags, io);
  if (command === "provision-workspace") return provisionWorkspaceCommand(doors, flags, io);
  if (command === "add-member") return addMemberCommand(doors, flags, io);
  if (isSliceCommand(command)) return sliceCommand(command, doors, flags, io);
  io.say(`unknown command: ${command}\n${USAGE_TEXT}`);
  return USAGE;
};
