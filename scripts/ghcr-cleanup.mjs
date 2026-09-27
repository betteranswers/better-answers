import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";

const API = "https://api.github.com";
const REGISTRY = "https://ghcr.io";

const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const CACHE_CONFIG = "application/vnd.buildkit.cacheconfig.v0";
const CACHE_TAG = "buildcache";

const ACCEPTED_MANIFESTS = [
  OCI_MANIFEST,
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
].join(", ");

const KEEP_NEWEST = 3;
const MINIMUM_AGE_DAYS = 7;
const MINIMUM_AGE_MS = MINIMUM_AGE_DAYS * 24 * 60 * 60 * 1000;

/** GitHub asks for a second between writes, and holds them to about 500 an hour. */
const PAUSE_MS = 2000;
const MOST_DELETES = 400;

/** Every workflow in the repository draws on this token's hourly allowance. */
const RATE_LIMIT_FLOOR = 200;

const PAGE_SIZE = 100;
const MOST_PAGES = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const NAME = /^[a-z0-9][a-z0-9._-]*$/;

const KEPT = {
  image: "an image (`sha-` tag)",
  attestationIndex: "an attestation index (`sha256-` tag)",
  current: "the current cache (`buildcache` tag)",
  otherTag: "tagged otherwise",
  unlisted: "a listing entry it could not read",
  newest: `one of the ${KEEP_NEWEST} newest caches`,
  young: `a cache ${MINIMUM_AGE_DAYS} days old or less`,
};

const NOT_DELETED = {
  moved: "tagged or changed since it was listed",
  gone: "already gone",
  notSent: "not sent",
  failed: "delete refused or failed",
};

const RATE_LOW = "GitHub's rate limit for this token ran low";
const RATE_LIMITED = "GitHub's rate limit stopped the deletes";
const CAP_REACHED = `the run reached its cap of ${MOST_DELETES} deletes`;

const fieldOf = (value, key) =>
  typeof value === "object" && value !== null && Object.hasOwn(value, key) ? value[key] : undefined;

const parsedJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    // Every caller refuses an absent value, so a body that is not JSON is refused with it.
    return undefined;
  }
};

/** A request that throws answers status 0, which every caller refuses as it would a 5xx. */
const send = async (run, url, init = {}) => {
  try {
    const response = await run.fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = Buffer.from(await response.arrayBuffer());
    return { ok: response.ok, status: response.status, headers: response.headers, body };
  } catch (error) {
    return { ok: false, status: 0, headers: new Headers(), body: Buffer.alloc(0), error };
  }
};

const answerOf = (sent) =>
  sent.status === 0 ? `no answer: ${String(sent.error)}` : `HTTP ${sent.status}`;

const jsonOf = (sent) => (sent.ok ? parsedJson(sent.body.toString("utf8")) : undefined);

const apiHeaders = (run) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${run.token}`,
  "x-github-api-version": "2022-11-28",
});

const versionsUrl = (run, tier) => `${API}/orgs/${run.owner}/packages/container/${tier}/versions`;

const timeOf = (raw, key) => {
  const value = fieldOf(raw, key);
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
};

const isTagList = (tags) => Array.isArray(tags) && tags.every((tag) => typeof tag === "string");

/** A version read wrongly could be deleted, so an entry missing any field is kept. */
const versionOf = (raw) => {
  const id = fieldOf(raw, "id");
  const digest = fieldOf(raw, "name");
  const tags = fieldOf(fieldOf(fieldOf(raw, "metadata"), "container"), "tags");
  const touchedMs = Math.max(timeOf(raw, "created_at"), timeOf(raw, "updated_at"));
  const readable =
    Number.isSafeInteger(id) &&
    typeof digest === "string" &&
    DIGEST.test(digest) &&
    isTagList(tags) &&
    Number.isFinite(touchedMs);
  return readable ? { id, digest, tags, touchedMs } : undefined;
};

const pageOf = async (run, tier, page) => {
  const sent = await send(run, `${versionsUrl(run, tier)}?per_page=${PAGE_SIZE}&page=${page}`, {
    headers: apiHeaders(run),
  });
  const entries = jsonOf(sent);
  return Array.isArray(entries) ? { entries } : { refused: answerOf(sent) };
};

const versionsIn = (entries) => {
  const read = entries.map(versionOf);
  const versions = read.filter((version) => version !== undefined);
  return {
    versions: [...new Map(versions.map((version) => [version.id, version])).values()],
    unlisted: read.length - versions.length,
  };
};

/** Merged by id, because a push landing mid-read moves every later entry down a page. */
const listVersions = async (run, tier) => {
  const entries = [];
  for (let page = 1; page <= MOST_PAGES; page += 1) {
    const read = await pageOf(run, tier, page);
    if (read.refused !== undefined) {
      return {
        failure: `the packages API would not list ghcr.io/${run.owner}/${tier}'s versions (${read.refused})`,
      };
    }
    entries.push(...read.entries);
    if (read.entries.length < PAGE_SIZE) return versionsIn(entries);
  }
  return {
    failure: `ghcr.io/${run.owner}/${tier} lists more than ${MOST_PAGES * PAGE_SIZE} versions, more than one run reads`,
  };
};

const pullTokenFor = async (run, tier) => {
  const scope = encodeURIComponent(`repository:${run.owner}/${tier}:pull`);
  const basic = Buffer.from(`${run.actor}:${run.token}`).toString("base64");
  const sent = await send(run, `${REGISTRY}/token?service=ghcr.io&scope=${scope}`, {
    headers: { authorization: `Basic ${basic}` },
  });
  const token = fieldOf(jsonOf(sent), "token");
  return typeof token === "string" && token !== ""
    ? { token }
    : {
        failure: `ghcr.io would not give this run's token a pull token for ${run.owner}/${tier} (${answerOf(sent)})`,
      };
};

const kindOf = (manifest) =>
  [
    fieldOf(manifest, "artifactType"),
    fieldOf(fieldOf(manifest, "config"), "mediaType"),
    fieldOf(manifest, "mediaType"),
  ].find((kind) => typeof kind === "string" && kind !== "");

/** A referrer names a subject, and nothing BuildKit exports does. */
const isCache = (manifest) =>
  fieldOf(manifest, "mediaType") === OCI_MANIFEST &&
  fieldOf(fieldOf(manifest, "config"), "mediaType") === CACHE_CONFIG &&
  fieldOf(manifest, "subject") === undefined &&
  fieldOf(manifest, "artifactType") === undefined;

const blobsOf = (manifest) => {
  const layers = fieldOf(manifest, "layers");
  const named = (Array.isArray(layers) ? [fieldOf(manifest, "config"), ...layers] : []).map(
    (blob) => [fieldOf(blob, "digest"), fieldOf(blob, "size")],
  );
  const sized =
    named.length > 1 &&
    named.every(([digest, size]) => DIGEST.test(String(digest)) && Number.isSafeInteger(size));
  return sized ? new Map(named) : undefined;
};

const manifestFrom = (manifest) => {
  if (manifest === undefined) return { why: "a body that is not JSON" };
  const kind = kindOf(manifest);
  if (kind === undefined) return { why: "no media type" };
  if (!isCache(manifest)) return { cache: false, kind };
  const blobs = blobsOf(manifest);
  return blobs === undefined
    ? { why: "a cache naming no sized layers" }
    : { cache: true, kind, blobs };
};

const digestOf = (body) => `sha256:${createHash("sha256").update(body).digest("hex")}`;

/** Held to its digest, so a body the registry got wrong is never read as a cache. */
const readManifest = async (run, tier, digest, pullToken) => {
  const sent = await send(run, `${REGISTRY}/v2/${run.owner}/${tier}/manifests/${digest}`, {
    headers: { accept: ACCEPTED_MANIFESTS, authorization: `Bearer ${pullToken}` },
  });
  if (!sent.ok) return { why: answerOf(sent) };
  if (digestOf(sent.body) !== digest) return { why: "a body that does not hash to its digest" };
  return manifestFrom(jsonOf(sent));
};

/** A tagged version is never deleted, and the current cache is read only to count toward the floor. */
const readManifests = async (run, tier, versions, pullToken) => {
  const manifests = new Map();
  for (const version of versions) {
    if (version.tags.length === 0 || version.tags.includes(CACHE_TAG)) {
      manifests.set(version.digest, await readManifest(run, tier, version.digest, pullToken));
    }
  }
  return manifests;
};

const taggedAs = (tags) => {
  if (tags.some((tag) => tag.startsWith("sha-"))) return KEPT.image;
  if (tags.some((tag) => tag.startsWith("sha256-"))) return KEPT.attestationIndex;
  return tags.includes(CACHE_TAG) ? KEPT.current : KEPT.otherTag;
};

const keptBecause = (version, manifest, newest, nowMs) => {
  if (version.tags.length > 0) return taggedAs(version.tags);
  if (manifest.why !== undefined) return `manifest unreadable: ${manifest.why}`;
  if (!manifest.cache) return `not a cache: \`${manifest.kind}\``;
  if (newest.has(version.id)) return KEPT.newest;
  return nowMs - version.touchedMs > MINIMUM_AGE_MS ? undefined : KEPT.young;
};

const newestFirst = (left, right) => right.touchedMs - left.touchedMs || right.id - left.id;

/** Selected oldest first, so a run stopped short leaves the newest of what it selected. */
const choose = (versions, manifests, nowMs) => {
  const caches = versions
    .filter((version) => manifests.get(version.digest)?.cache === true)
    .toSorted(newestFirst);
  const newest = new Set(caches.slice(0, KEEP_NEWEST).map((version) => version.id));
  const verdicts = versions.map((version) => ({
    version,
    kept: keptBecause(version, manifests.get(version.digest), newest, nowMs),
  }));
  return {
    caches,
    kept: verdicts.flatMap(({ kept }) => (kept === undefined ? [] : [kept])),
    selected: verdicts
      .filter(({ kept }) => kept === undefined)
      .map(({ version }) => version)
      .toSorted((left, right) => newestFirst(right, left)),
  };
};

const isRateLimited = (sent) =>
  sent.status === 429 ||
  (sent.status === 403 &&
    (sent.headers.get("x-ratelimit-remaining") === "0" || sent.headers.has("retry-after")));

const outcomeOf = (sent) => {
  if (sent.status === 204) return "deleted";
  if (sent.status === 404) return "gone";
  if (isRateLimited(sent)) return "rate-limited";
  return sent.status === 403 ? "refused" : "failed";
};

const refusedFor = (run, tier) =>
  `GitHub refused to delete a version of ghcr.io/${run.owner}/${tier} (HTTP 403), which takes the Admin role on the package. At https://github.com/orgs/${run.owner}/packages/container/${tier}/settings, under "Manage Actions access", give ${run.repository} the Admin role. If the package inherits its access from the repository, turn that off first.`;

const startOf = (budget) => ({
  left: budget.left,
  stop: budget.stop,
  deleted: [],
  gone: [],
  notSent: [],
  failed: [],
  moved: [],
  failure: undefined,
});

const afterDelete = (state, version, sent, where) => {
  switch (outcomeOf(sent)) {
    case "deleted": {
      const remaining = Number(sent.headers.get("x-ratelimit-remaining") ?? Number.NaN);
      return {
        ...state,
        deleted: [...state.deleted, version],
        left: state.left - 1,
        stop: remaining < RATE_LIMIT_FLOOR ? RATE_LOW : state.stop,
      };
    }
    case "gone":
      return { ...state, gone: [...state.gone, version] };
    case "rate-limited":
      return { ...state, notSent: [...state.notSent, version], stop: RATE_LIMITED };
    case "refused":
      return { ...state, failed: [...state.failed, version], failure: where.refused };
    default:
      return {
        ...state,
        failed: [...state.failed, version],
        failure: `GitHub would not delete version ${version.id} of ${where.image} (${answerOf(sent)})`,
      };
  }
};

const blockerOf = (state) =>
  state.stop ?? state.failure ?? (state.left > 0 ? undefined : CAP_REACHED);

const deleteAll = async (run, tier, versions, budget) => {
  const where = { image: `ghcr.io/${run.owner}/${tier}`, refused: refusedFor(run, tier) };
  let state = startOf(budget);
  for (const version of versions) {
    if (blockerOf(state) === undefined) {
      await run.sleep(PAUSE_MS);
      const sent = await send(run, `${versionsUrl(run, tier)}/${version.id}`, {
        method: "DELETE",
        headers: apiHeaders(run),
      });
      state = afterDelete(state, version, sent, where);
    } else {
      state = { ...state, notSent: [...state.notSent, version] };
    }
  }
  return state;
};

const isUnchanged = (listed, now) =>
  now !== undefined && now.tags.length === 0 && now.touchedMs === listed.touchedMs;

/** Listed again first, so a tag that moved while the manifests were read keeps its version. */
const deleteChosen = async (run, tier, selected, budget) => {
  if (run.dryRun || selected.length === 0) return startOf(budget);
  const again = await listVersions(run, tier);
  if (again.failure !== undefined) {
    return { ...startOf(budget), notSent: selected, failure: again.failure };
  }
  const now = new Map(again.versions.map((version) => [version.id, version]));
  const unchanged = selected.filter((version) => isUnchanged(version, now.get(version.id)));
  const state = await deleteAll(run, tier, unchanged, budget);
  return { ...state, moved: selected.filter((version) => !unchanged.includes(version)) };
};

const tally = (reasons) =>
  [...Map.groupBy(reasons, (reason) => reason)]
    .map(([reason, all]) => [reason, all.length])
    .toSorted(([left, many], [right, more]) => more - many || left.localeCompare(right));

/** A blob a kept cache also names stays, so it is not counted. */
const bytesFreed = (gone, caches, manifests) => {
  const goneIds = new Set(gone.map((version) => version.id));
  const blobsIn = (version) => [...manifests.get(version.digest).blobs];
  const kept = new Set(
    caches
      .filter((version) => !goneIds.has(version.id))
      .flatMap(blobsIn)
      .map(([digest]) => digest),
  );
  const freed = new Map(gone.flatMap(blobsIn).filter(([digest]) => !kept.has(digest)));
  return [...freed.values()].reduce((total, size) => total + size, 0);
};

const failedPackage = (tier, failure, budget) => ({
  tier,
  kept: [],
  notDeleted: [],
  failure,
  budget,
});

const cleanPackage = async (run, tier, budget) => {
  const listing = await listVersions(run, tier);
  if (listing.failure !== undefined) return failedPackage(tier, listing.failure, budget);
  const pull = await pullTokenFor(run, tier);
  if (pull.failure !== undefined) return failedPackage(tier, pull.failure, budget);
  const manifests = await readManifests(run, tier, listing.versions, pull.token);
  const choice = choose(listing.versions, manifests, run.nowMs);
  const deletion = await deleteChosen(run, tier, choice.selected, budget);
  const gone = run.dryRun ? choice.selected : deletion.deleted;
  return {
    tier,
    seen: listing.versions.length + listing.unlisted,
    selected: choice.selected.length,
    deleted: deletion.deleted.length,
    bytes: bytesFreed(gone, choice.caches, manifests),
    kept: tally([...choice.kept, ...Array.from({ length: listing.unlisted }, () => KEPT.unlisted)]),
    notDeleted: tally([
      ...deletion.moved.map(() => NOT_DELETED.moved),
      ...deletion.gone.map(() => NOT_DELETED.gone),
      ...deletion.notSent.map(() => NOT_DELETED.notSent),
      ...deletion.failed.map(() => NOT_DELETED.failed),
    ]),
    failure: deletion.failure,
    budget: { left: deletion.left, stop: deletion.stop },
  };
};

const sizeOf = (bytes) => {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${bytes} B`;
};

const rowOf = (report) =>
  report.seen === undefined
    ? `| \`${report.tier}\` | — | — | — | — |`
    : `| \`${report.tier}\` | ${report.seen} | ${report.selected} | ${report.deleted} | ${sizeOf(report.bytes)} |`;

const reasonsTable = (title, rows) =>
  rows.length === 0
    ? []
    : [`### ${title}`, "", "| Package | Why | Versions |", "| --- | --- | ---: |", ...rows, ""];

const reasonRows = (reports, reasonsOf) =>
  reports.flatMap((report) =>
    reasonsOf(report).map(([reason, count]) => `| \`${report.tier}\` | ${reason} | ${count} |`),
  );

const DRY_RUN_NOTE =
  "A dry run sends no delete, so it cannot show whether this repository holds the Admin role that deleting takes on each package.";

const BYTES_NOTE =
  "*At most*: the blobs the manifests name that no kept cache names. An image can share a blob with a cache, and GHCR frees only a blob nothing names.";

const notesOf = (reports, run, stopped) => [
  ...reports.flatMap((report) =>
    report.failure === undefined ? [] : [`**\`${report.tier}\` failed:** ${report.failure}`, ""],
  ),
  ...(stopped === undefined
    ? []
    : [`Deleting stopped early: ${stopped}. The next run takes the rest.`, ""]),
  ...(run.dryRun ? [DRY_RUN_NOTE, ""] : []),
  BYTES_NOTE,
];

const summaryOf = (reports, run, stopped) =>
  [
    run.dryRun
      ? "## Cache manifests: a dry run, so nothing was deleted"
      : "## Cache manifests deleted",
    "",
    `A version is selected when it is untagged, its manifest's config is \`${CACHE_CONFIG}\`, it is more than ${MINIMUM_AGE_DAYS} days old, and it is not one of its package's ${KEEP_NEWEST} newest caches.`,
    "",
    `| Package | Versions | Selected | Deleted | ${run.dryRun ? "Would free" : "Freed"}, at most |`,
    "| --- | ---: | ---: | ---: | ---: |",
    ...reports.map(rowOf),
    "",
    ...reasonsTable(
      "Kept",
      reasonRows(reports, (report) => report.kept),
    ),
    ...reasonsTable(
      "Selected, not deleted",
      reasonRows(reports, (report) => report.notDeleted),
    ),
    ...notesOf(reports, run, stopped),
  ].join("\n") + "\n";

const logOf = (report) => [
  ...(report.seen === undefined
    ? []
    : [
        `${report.tier}: ${report.seen} versions, ${report.selected} selected, ${report.deleted} deleted`,
      ]),
  ...(report.failure === undefined ? [] : [`::error::${report.failure}`]),
];

/** Sends no delete when `dryRun` is true. `failed` means a package could not be listed or read, or a delete was refused. */
export const cleanup = async (run) => {
  const reports = [];
  let budget = { left: MOST_DELETES, stop: undefined };
  for (const tier of run.tiers) {
    const report = await cleanPackage(run, tier, budget);
    for (const line of logOf(report)) run.log(line);
    reports.push(report);
    budget = report.budget;
  }
  const unsent = reports.some((report) =>
    report.notDeleted.some(([reason]) => reason === NOT_DELETED.notSent),
  );
  const stopped = unsent ? blockerOf(budget) : undefined;
  if (stopped !== undefined) run.log(`::warning::${stopped}, so the next run takes the rest`);
  return {
    summary: summaryOf(reports, run, stopped),
    failed: reports.some((report) => report.failure !== undefined),
  };
};

const tiersFrom = (text) => {
  const tiers = parsedJson(text);
  const named =
    Array.isArray(tiers) &&
    tiers.length > 0 &&
    tiers.every((tier) => typeof tier === "string" && NAME.test(tier));
  return named ? tiers : undefined;
};

const REQUIRED = ["GH_TOKEN", "OWNER", "ACTOR", "REPOSITORY", "TIERS", "DRY_RUN"];

const configFrom = (env) => {
  const unset = REQUIRED.filter((name) => (env[name] ?? "") === "");
  if (unset.length > 0) return { failure: `${unset.join(", ")} must be set` };
  const tiers = tiersFrom(env.TIERS);
  if (tiers === undefined || !NAME.test(env.OWNER)) {
    return { failure: `OWNER must be a package owner and TIERS a JSON list of package names` };
  }
  if (env.DRY_RUN !== "true" && env.DRY_RUN !== "false") {
    return { failure: `DRY_RUN must be true or false, and is ${env.DRY_RUN}` };
  }
  return {
    run: {
      token: env.GH_TOKEN,
      owner: env.OWNER,
      actor: env.ACTOR,
      repository: env.REPOSITORY,
      tiers,
      dryRun: env.DRY_RUN === "true",
    },
  };
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const main = async () => {
  const config = configFrom(process.env);
  if (config.failure !== undefined) {
    process.stdout.write(`::error::${config.failure}\n`);
    process.exitCode = 1;
    return;
  }
  const result = await cleanup({
    ...config.run,
    fetch,
    sleep,
    nowMs: Date.now(),
    log: (line) => process.stdout.write(`${line}\n`),
  });
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile === undefined || summaryFile === "") process.stdout.write(result.summary);
  else appendFileSync(summaryFile, result.summary);
  process.exitCode = result.failed ? 1 : 0;
};

if (import.meta.main) await main();
