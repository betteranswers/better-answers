/**
 * Only the words test reads this, so `CONCEPTS.md` shows an agent the word to write and never the
 * word it replaced.
 */

/**
 * `within` keeps a sense to the one tree whose code writes it; `until` keeps it only while the later
 * sweep that renames it is pending.
 */
export type Sense = {
  readonly sense: string;
  readonly written: RegExp;
  readonly within?: string;
  readonly until?: string;
};

export type CarveOut = { readonly holds: (file: string) => boolean; readonly why: string };

/** A landed word is refused in every form, whole outside its permitted senses, or in reader text alone. */
type Reach = "everywhere" | "one sense" | "reader text";

/** A sweep renames it: pending until the sweep lands, then refused where its reach says. */
export type Renamed = {
  readonly word: string;
  readonly use: string;
  readonly entry: string;
  readonly sweep: string;
  readonly state: "pending" | "landed";
  readonly reach: Reach;
  readonly why?: string;
  readonly permitted?: readonly Sense[];
  readonly carvedOut?: readonly CarveOut[];
  readonly reads?: (file: string) => boolean;
};

/** A word the glossary once avoided, which no sweep renames and no scan reads. */
type Avoided = {
  readonly word: string;
  readonly use: string;
  readonly entry: string;
  readonly sweep: null;
  readonly why?: string;
};

export type OldWord = Renamed | Avoided;

export const under =
  (prefix: string) =>
  (file: string): boolean =>
    file.startsWith(prefix);

/**
 * Code alone: a notice is prose, whose name follows the docs. Elsewhere the old form may stand, as
 * the platform's git author does.
 */
const READ_BY_A_PERSON = ["apps/web/index.html", "apps/web/src/", "apps/api/src/"];

const isCodeAPersonReads = (file: string): boolean =>
  READ_BY_A_PERSON.some((prefix) => file.startsWith(prefix)) && /\.(?:tsx?|html)$/.test(file);

const avoided = (word: string, entry: string, why?: string, use = entry): Avoided => ({
  word,
  use,
  entry,
  sweep: null,
  ...(why === undefined ? {} : { why }),
});

const pending = (
  word: string,
  use: string,
  entry: string,
  sweep: string,
  reach: Reach,
): Renamed => ({ word, use, entry, sweep, state: "pending", reach });

const APP_SENSES: readonly Sense[] = [
  { sense: "the whole product", written: /\b(?:an app|better-answers app)\b/gi },
  { sense: "the SPA", written: /\b(?:single-page|web) app\b/gi },
  { sense: "the SPA's top layer, the directory it composes in", written: /\bapp (?:layer\b|→)/gi },
  {
    sense: "the hostname role",
    written:
      /(?<!\bthe )\bapp\.(?!\w)|\bapp (?:hostname\b|·)|\*\*app\*\* hostname|\| `app` \||`app` is a hostname role|"app"(?=, "agent", "apex"\])/gi,
  },
  {
    sense: "a third-party app, the consent page's client among them",
    written:
      /\b(?:GitHub(?: Actions')?|OAuth|MCP|Renovate|chat) app\b|\bThis app calls itself\b|"This app"/gi,
  },
  {
    sense: "an identifier: a path, a hyphenated name, a property or setting, a Hono app",
    written:
      /(?<![/:])\/app\b|\bapp\/|-app\b|\bapp-|\bapp\.\w|\b(?:const|let) app\b|\bHono app\b/gi,
  },
  {
    sense: "cocoindex's App: the class, a local or a memo's key holding one, one by its name",
    written:
      /\bcoco\.App\b|\bapp(?:: coco\.App)? = coco\.App\b|["']app["']: (?:\w+_APP\b|["'](?:landed|chunks|passages)["'])|\b(?:landed|chunks|passages) app\b/gi,
  },
  {
    sense:
      "the api's own names: the harness's app() getter, a TestApp held as app and passed on, the app hostname's key",
    within: "apps/api/",
    written:
      /"app"(?!:)|(?<!\.)\bapp\(|\b(?:readonly )?app: (?:TestApp\b|APP_HOSTNAME\b|string\b|hostnameOfUrl\(|"[^"]*")|\bapp = await startApp\(|(?<=\w\((?:\w+, )*)app(?=[,)])|^\s*(?:(?:const \w+ = )?await )?app,?$|\bhostnames\.app\b/gi,
  },
];

const MIGRATION_TAG: Sense = {
  sense: "a migration's tag, naming the dated file it was generated as",
  within: "packages/schema/migrations/meta/",
  written: /"tag": "\d{4}_[\w-]+"/g,
};

const LEDGER_SENSES: readonly Sense[] = [
  {
    sense: "spend's cost ledger, by its name or the llm_call row it holds",
    written: /cost[-_ ]?ledger|`?llm_call`? ledger\b/gi,
  },
  {
    sense: "the cost ledger's own agreement, whose every edit moves the contract's digest",
    within: "contracts/cost-ledger/",
    written: /\bledger\b/gi,
  },
  MIGRATION_TAG,
  {
    sense: "a company's own books, in the source documents the worker's fixtures stand in for",
    within: "apps/worker/tests/fixtures/",
    written: /\bledger\b/gi,
  },
];

const NO_TIER_SENSE = "no tier-sense use: the word there is the SPA's own zone";

/** A dated plan or dogfood report keeps the words of its day (R22); a later one is read. */
const writtenBefore = (day: string): CarveOut => ({
  holds: (file) =>
    (/^docs\/(?:plans|dogfood-reports)\/(\d{4}-\d{2}-\d{2})-/.exec(file)?.[1] ?? "9999") < day,
  why: "a completed plan or dogfood report keeps the words of its day (R22)",
});

/** Names a sweep never renames: ADR filenames keep their slugs (KTD14), and the archive is frozen. */
const FILED_NAMES: readonly Sense[] = [
  { sense: "an ADR's filename", written: /\badr-\d{4}-[a-z0-9-]+/g },
  { sense: "a path into the frozen archive", written: /\bdocs\/archive\/[\w./-]+/g },
];

const SCREEN_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  { sense: "a screen reader", written: /\bscreen[- ]readers?\b/gi },
  {
    sense: "Testing Library's screen, in a query or its import",
    within: "apps/web/test/",
    written: /\bscreen(?=\s*\.)|\bscreen\b(?=[^;]*\bfrom "@testing-library\/)/g,
  },
  { sense: "Tailwind's screen sizes", written: /(?<![\w-])(?:min-|max-)?[hw]-screen\b/g },
];

const SURFACE_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  { sense: "the MCP surface", written: /\bmcp[- _/]?surfaces?\b/gi },
  { sense: "the roles surface, roles-surface.json", written: /\broles['’]?[- _]?surface\b/gi },
  {
    sense: "the design system's surface colours and their tokens",
    written:
      /--surface-[\w-]+|\b(?:white|sunken|raised|inset|dark|accent|chip|muted|quiet|de-emphasised) surfaces?\b|\bsurfaces? (?:tokens?|colou?rs?)\b/gi,
  },
  {
    sense: "the design system Frame's surface prop, its background",
    within: "packages/design-system/",
    written: /\bsurface(?=\s*[,|])/g,
  },
  {
    sense: "what the api exposes to a caller, of which the MCP surface is one",
    within: "apps/api/",
    written: /\bsurfaces?\b/gi,
  },
  {
    sense: "the roles surface, as the schema that generates it names it",
    within: "packages/schema/",
    written: /\bsurfaces?\b/gi,
  },
  {
    sense: "what a person decides on, in a fixture whose every edit moves the contract's digest",
    within: "contracts/suggestions/",
    written: /\bdecision surface\b/g,
  },
];

const PAGE_AREA_MENU = "page, area and menu";

const PAGE_AREA_MENU_LANDED = "2026-10-04";

/** The sweep's own learning quotes the words it teaches later sweeps to remove. */
const PAGE_AREA_MENU_CARVED_OUT: readonly CarveOut[] = [
  writtenBefore(PAGE_AREA_MENU_LANDED),
  {
    holds: (file) =>
      file ===
      "docs/solutions/best-practices/what-a-rename-sweeps-runner-and-prose-pass-get-wrong-and-the-checks-that-catch-it.md",
    why: "the sweep's learning names the words it renamed, as its map does",
  },
];

const MODEL_CHOICE = "model choice";

const MODEL_CHOICE_LANDED = "2026-10-05";

/** Trees where every route is one the api, the SPA's sign-in or a fake server answers over HTTP. */
const HTTP_ROUTE_TREES = [
  "apps/api/src/auth/",
  "apps/api/src/ingress/",
  "apps/api/tests/pending-set.test.ts",
  "apps/test-inbox/",
  "apps/web/src/features/auth/",
  "apps/web/test/second-factor-api.ts",
  "apps/web/test/pending-gate.test.tsx",
  "packages/devtools/test/ci/ghcr-cleanup.test.ts",
  "docs/solutions/architecture-patterns/adr-0009-better-auth-in-process-identity-provider.md",
  "docs/solutions/best-practices/better-auth-closed-endpoints-run-as-server-functions-without-router-guards.md",
  "docs/solutions/logic-errors/better-auth-lookup-deleted-another-persons-expired-sign-in-code.md",
];

const ROUTE_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  MIGRATION_TAG,
  {
    sense: "the route spec and its blocks: the v0.1 route, on it or off it",
    written:
      /\broute spec\b|\bv01-route\b|\broute blocks?\b|\bthe v0\.1 route\b|\b(?:on|off|of|holds) (?:the|this|any) route\b|\bthe route(?:['’]s (?:[A-Z]\d|status|one new)|(?=:| (?:holds|lands|has|was|changes|planned|names|fixes)\b))|^#+ The route$/gi,
  },
  {
    sense: "a Hono or Playwright route() call, and the request a Playwright route holds",
    written:
      /\b\w+\.route\(|\(route\)|\broute\.(?:fetch|fulfill|abort|continue|request)\(|\["route"\]/g,
  },
  ...HTTP_ROUTE_TREES.map((within) => ({
    sense: "an HTTP route the api, the SPA's sign-in or a fake server answers",
    within,
    written: /\broutes?\b/gi,
  })),
  {
    sense: "an HTTP route elsewhere: the api's, a machine's, one beside tRPC",
    written:
      /\b(?:api|HTTP|Hono|machine|core|restore|accept-invitation) routes?\b|\b(?:a|our|own) route (?:beside|of our own|in apps|calling)\b|\bapi['’]s own routes?\b|\broute (?:makes|calls|is the only guard)\b|\bthe route['’]s (?:own )?(?:checks?|ceiling)\b|\bevery other route\b|\bbreaking a route\b/gi,
  },
  {
    sense: "jCodeMunch's route tool, by its name",
    written: /`route \{/g,
  },
  {
    sense: "Compound Engineering's route to a review peer",
    written: /\b(?:opencode|claude) route\b/gi,
  },
  ...["apps/web/src/app/router.tsx", "apps/web/src/app/visible-tree.ts"].map((within) => ({
    sense: "a TanStack route, in the router the SPA composes or its live reading",
    within,
    written: /\broutes?\b/gi,
  })),
  {
    sense: "a TanStack route named outside the router",
    written:
      /\b(?:index|shell|console['’]s) route\b|\ba route['’]s static data\b|\ba route (?:nothing declared|written beside)\b|\bits route carries\b/gi,
  },
  {
    sense: "a network's route",
    written: /\bdefault route\b|\bno route to\b|\bdo not route\b|\broute out\b/gi,
  },
  {
    sense: "the stored rebuild reason the model choice's migration replaced, named as stored",
    written: /[`"]route-change[`"]/g,
  },
  {
    sense: "the old word the catalogue test refuses in any name",
    within: "packages/schema/test/renamed-names.test.ts",
    written: /"route"/g,
  },
  {
    sense: "the names migration 0069 found, which a test puts back to run it again",
    within: "packages/schema/test/before-the-passage.ts",
    written: /\bembedding_route_id\b|"route"/g,
  },
  {
    sense: "the rename runner's examples, which name the first map's words",
    within: "packages/devtools/src/rename/words.ts",
    written: /`(?:llm route|route|SELECT route_id|no route set)`/g,
  },
];

const MAP = "map";

const MAP_LANDED = "2026-10-05";

const GRAPH_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  MIGRATION_TAG,
  {
    sense: "the map process's actor id, stored on the audit rows its act writes (R22)",
    written: /\bprocess:better-answers-graph\b/g,
  },
  {
    sense: "Microsoft Graph, the API a SharePoint connector reads through",
    written: /\bMicrosoft Graph\b|\bGraph API\b|\bHTTPS, Graph\b|\bread through Graph\b/g,
  },
  {
    sense: "a dependency graph: GitNexus's call or symbol graph, a module's, pnpm's or the slices'",
    written: /\b(?:call|symbol|module|slice|build|dependency) graph\b/g,
  },
  {
    sense: "a graph engine or store, the kind of database ADR 0032 chose against",
    written: /\bgraph (?:engines?|database|store)\b/gi,
  },
  {
    sense: "OKF's own structure, graph-shaped through its links",
    written: /\bgraph-\*?shaped\*?|\bgraph shape\b/g,
  },
  {
    sense: "Phosphor's graph icon, by the name its library exports",
    within: "apps/web/src/shared/icon.tsx",
    written: /\bGraph\b/g,
  },
  {
    sense: "a component or icon a design-system card names as its library does",
    within: "packages/design-system/guidelines/",
    written: /\bContribution Graph\b|\bph-graph\b/g,
  },
  {
    sense: "the citation fixture's prose, whose every edit moves the contract's digest",
    within: "contracts/citation/",
    written: /\bthe graph is Postgres\b/g,
  },
  {
    sense: "the destination value the map's migration replaced, named as stored",
    within: "packages/schema/test/job-kinds.test.ts",
    written: /(["'])graph\1/g,
  },
  {
    sense: "the old table prefix the catalogue test refuses any name under",
    within: "packages/schema/test/renamed-names.test.ts",
    written: /"graph"/g,
  },
];

const CONNECTED_SOURCE = "connected source";

const CONNECTED_SOURCE_LANDED = "2026-10-07";

/** The sweeps' learnings quote the words they teach later sweeps to remove. */
const SWEEPS_OWN_WORDS: readonly CarveOut[] = [
  {
    holds: (file) =>
      [
        "docs/solutions/best-practices/how-a-rename-sweep-lands-a-word-in-the-words-test.md",
        "docs/solutions/best-practices/what-a-rename-sweeps-runner-and-prose-pass-get-wrong-and-the-checks-that-catch-it.md",
        "docs/solutions/best-practices/renaming-a-table-drizzle-kit-will-not-generate-so-the-migration-and-snapshot-are-written-by-hand.md",
      ].includes(file),
    why: "a sweep's learning names the words a sweep renames, as its map does",
  },
  {
    holds: (file) => file === "pnpm-lock.yaml" || file === "LICENSE",
    why: "a package's name is its publisher's, and the licence is the Apache Foundation's text",
  },
  {
    holds: (file) => file.startsWith("packages/devtools/lifts/"),
    why: "lifted code keeps the words of the source it was lifted from",
  },
];

const CONNECTED_SOURCE_CARVED_OUT: readonly CarveOut[] = [
  writtenBefore(CONNECTED_SOURCE_LANDED),
  ...SWEEPS_OWN_WORDS,
];

/** Where `bind` sets a SQL statement's parameter, as the store door's helper names it. */
const SQL_PARAMETER_TREES = [
  "packages/core/src/store/postgres/",
  "packages/core/src/audit/",
  "packages/core/src/members/audit-log.ts",
  "packages/core/src/members/invitation-statuses.ts",
  "packages/core/src/access/index.ts",
];

const BIND_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  MIGRATION_TAG,
  ...SQL_PARAMETER_TREES.map((within) => ({
    sense: "setting a SQL statement's parameter",
    within,
    written: /\bbind\b/gi,
  })),
  { sense: "JavaScript's and D1's bind()", written: /\.bind\(|\bbind: \(/g },
  { sense: "a Docker bind mount", written: /\bbind[- ]mount(?:s|ed)?\b/gi },
  {
    sense: "a socket taking a port",
    within: "apps/api/tests/loopback-port.ts",
    written: /\bbind it\b/g,
  },
  {
    sense: "D1's statement API, as the test inbox types it",
    within: "apps/test-inbox/",
    written: /\bbind\b/g,
  },
  {
    sense: "a rule or a setting holding something to it",
    written:
      /\bbind (?:you|every|before CI|a change|the page|the migrations|from this page)\b|\b(?:escapes|that) bind it\b/gi,
  },
  {
    sense: "a kind the route spec struck, kept as written",
    within: "docs/specs/v01-route.md",
    written: /~~`bind · index · reindex · prune`~~/g,
  },
];

const BINDING_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  MIGRATION_TAG,
  {
    sense: "the stored detail key, which the web reads as audit rows keep it (R22)",
    within: "apps/web/",
    written: /\bbindingId\b/g,
  },
  {
    sense: "the stored subject kind, which audit rows keep (R22)",
    within: "packages/core/src/members/audit-log.ts",
    written: /"binding"/g,
  },
  {
    sense: "the refusal word, in a test of its declaration (R21)",
    within: "packages/core/test/refusal-words.test.ts",
    written: /\bno-such-binding\b/g,
  },
  {
    sense: "an erasure report's action key, which erasure requests store (R22)",
    written: /\bbindingsReindexed\b/g,
  },
  ...[
    "apps/worker/src/better_answers_worker/pipeline/host.py",
    "apps/worker/tests/test_pipeline_index.py",
  ].map((within) => ({
    sense: "the store's name before the passage sweep, which a wipe removes",
    within,
    written: /"binding"/g,
  })),
  {
    sense: "the names migration 0069 found, which a test puts back to run it again",
    within: "packages/schema/test/before-the-passage.ts",
    written: /\w*binding\w*|"binding"/g,
  },
  {
    sense: "the store's name before the passage sweep, as the release removes it",
    within: "docs/operations/RUNBOOK.md",
    written: /`binding\/`|-name binding\b/g,
  },
  {
    sense: "the sign-in link's binding cookie, which ties a link to one browser",
    written: /\bbinding cookie\b|\bbindingCookieName\b|\bbindTheLink\b/g,
  },
  { sense: "a component's own prop for its vim key bindings", written: /\bvimBindings\b/g },
  { sense: "a form label bound to its control", written: /\blabel binding\b/g },
  { sense: "OAuth's audience binding", written: /\baudience binding\b/g },
  {
    sense: "a Cloudflare Worker's binding to its D1 database",
    written: /"binding": "DB"/g,
  },
  {
    sense: "the error an api before migration 0068 answers, quoted as it reads",
    within: "docs/operations/RUNBOOK.md",
    written: /relation "source_binding" does not exist/g,
  },
  {
    sense: "the old table name a test reads from an older migration or snapshot",
    within: "packages/schema/test/job-kinds.test.ts",
    written: /"source_binding"/g,
  },
  {
    sense: "the old table prefix and column word the catalogue test refuses",
    within: "packages/schema/test/renamed-names.test.ts",
    written: /"source_binding"|"binding"|\bbinding_id\b/g,
  },
];

const REFERENCED_SENSES: readonly Sense[] = [
  { sense: "the DPIA an Admin confirms is referenced", written: /\bDPIA (?:is )?referenced\b/gi },
  { sense: "a file another names", written: /\breferenced scripts\b/g },
];

/** Copied from upstream, so their words are upstream's. */
const VENDORED: readonly CarveOut[] = [
  {
    holds: (file) =>
      ["complexity-gate", "mutation-testing"].some((skill) =>
        file.startsWith(`.claude/skills/${skill}/`),
      ),
    why: "a skill copied from jspiro/skills, kept as upstream wrote it",
  },
  {
    holds: (file) => file === ".compound-engineering/config.example.yaml",
    why: "Compound Engineering's own example config, where a route is its engine's",
  },
];

const CONNECTED_SOURCE_ROWS_CARVED_OUT: readonly CarveOut[] = [
  ...CONNECTED_SOURCE_CARVED_OUT,
  ...VENDORED,
];

const PASSAGE = "passage";

const PASSAGE_LANDED = "2026-10-07";

/** The people words land one noun at a time, each on the day of its sweep. */
const PEOPLE_WORDS_LANDED = "2026-10-07";

const PEOPLE_WORDS_CARVED_OUT: readonly CarveOut[] = [writtenBefore(PEOPLE_WORDS_LANDED)];

/** The knowledge words land in three pull requests, one noun at a time, each on the day of its sweep. */
const KNOWLEDGE_WORDS_LANDED = "2026-10-07";

const KNOWLEDGE_WORDS_CARVED_OUT: readonly CarveOut[] = [writtenBefore(KNOWLEDGE_WORDS_LANDED)];

/** Where the dead-man service's API names a check by its slug: the release's freshness gate. */
const DEAD_MAN_CHECK_FILES = [
  "deploy/backup-fresh.sh",
  "packages/devtools/test/ci/release-job.test.ts",
];

/** Where Better Auth's organization field keeps its own name: its option, its bodies, its object. */
const BETTER_AUTH_SLUG_FILES = [
  "apps/api/src/auth/auth.ts",
  "apps/api/tests/organisation-plugin.test.ts",
  "apps/web/test/workspace-switcher.test.tsx",
];

const SHORT_NAME_SENSES: readonly Sense[] = [
  ...BETTER_AUTH_SLUG_FILES.map((within) => ({
    sense: "Better Auth's organization field, which its API keeps (R21)",
    within,
    written: /\bslug(?=: )/g,
  })),
  {
    sense: "Better Auth's endpoint that answers whether a short name is free (R21)",
    written: /\bcheck-slug\b/g,
  },
  {
    sense: "the stored detail key, which the web reads as audit rows keep it (R22)",
    within: "apps/web/",
    written: /\bslugChanged\b/g,
  },
  ...DEAD_MAN_CHECK_FILES.map((within) => ({
    sense: "the dead-man service's name for a check, on its API",
    within,
    written: /\bslug\b/g,
  })),
  {
    sense: "a project folder's name, as Claude Code writes it",
    within: ".claude/skills/session-retro/scripts/session.py",
    written: /\bslug\b/g,
  },
  {
    sense: "a GitHub App's own name for itself",
    within: ".github/workflows/",
    written: /\bapp\.slug\b/g,
  },
  { sense: "Renovate's group key", within: "renovate.json", written: /\bgroupSlug\b/g },
  { sense: "a file name's words, after its number or block", written: /-<slug>\.md\b/g },
  {
    sense: "the error an api before migration 0070 answers, quoted as it reads",
    within: "docs/operations/RUNBOOK.md",
    written: /column "slug" does not exist/g,
  },
  {
    sense: "the old column word the catalogue test refuses",
    within: "packages/schema/test/renamed-names.test.ts",
    written: /"slug"/g,
  },
  {
    sense: "a concept section's key, its heading's own words",
    within: "docs/solutions/architecture-patterns/adr-0023-graph-is-apache-age.md",
    written: /\(IRI, slug\)/g,
  },
];

/** Where `client` is a library's object in code: a pg or pool client, the harness's, S3's, tRPC's. */
const CLIENT_OBJECT_TREES = [
  "apps/api/src/migrate.ts",
  "apps/api/tests/",
  "apps/web/journeys/inbox.ts",
  "apps/web/src/app/providers.tsx",
  "apps/web/src/features/sources/sources-api.ts",
  "apps/web/src/shared/api/trpc.ts",
  "apps/worker/src/better_answers_worker/pipeline/objects.py",
  "docs/solutions/best-practices/better-auth-closed-endpoints-run-as-server-functions-without-router-guards.md",
  "docs/solutions/logic-errors/a-second-mutate-drops-the-first-actions-callbacks.md",
  "packages/core/src/store/",
  "packages/core/test/",
  "packages/schema/scripts/",
  "packages/schema/test/",
  "patches/",
];

const CLIENT_SENSES: readonly Sense[] = [
  {
    sense: "a package, module or file named for a library's client",
    written:
      /[\w@.-]*\/client\b(?:\/[\w-]+)*|\b(?:query|auth|web|api|second|model|git|typed-rest)-client\b|\bclient-(?:s3|instance|setup)\b|(?:postgresql|openssh)-client\b|"use client"/gi,
  },
  {
    sense: "a library's or a tool's client, named by what it is",
    written:
      /\b(?:tRPC|query|Better Auth(?:['’]s)?|`?better-auth`?|typed|S3|object store|PostgreSQL|pool|database|test|model|provider|Messages-API|HTTP(?:\/2)?|mail|email|SSH|git|docker|desktop|machine|OAuth|keyed) client\b/gi,
  },
  {
    sense: "OAuth's and HTTP's own names: a client id, its metadata document, secret and assertion",
    written:
      /\bclient[- ]ids?\b|\bclient[- ]ID[- ]metadata\b|\bclient metadata document\b|[\w-]*client-(?:metadata|jwks)\b|\bclient secrets?\b|\bclient[- ]assertion(?:-type)?\b|\bdynamic client registration\b|\bcf-access-client-(?:id|secret)\b|\bclient certificate\b/gi,
  },
  {
    sense: "the requesting end of a connection: its address, its key, encryption on its side",
    written:
      /\bclient[- ](?:address(?:es)?|IP|key|side|backend)\b|\bBetter Auth's per-client one\b/gi,
  },
  ...CLIENT_OBJECT_TREES.map((within) => ({
    sense: "a library's client object in code",
    within,
    written:
      /\bclient(?=\??\.[\w$]|\s*[;=)\]}(]|: )|(?<=[([{,.]\s*)client\b|^\s*client,?$|(?<=\b(?:const|let|await|return|readonly) )client\b|(?<=[$#])client\b|\["client"\]|`client`|(?<=pg\.|type |: |\| )Client\b|\bclient=\{/g,
  })),
  {
    sense: "the condition the DPIA input records and the redaction agreement quotes (R22)",
    written: /\bnone until a health-sector client\b/g,
  },
  {
    sense: "the stored subject kind of a consent's audit row (R22)",
    within: "packages/core/test/sign-in-and-consent.test.ts",
    written: /subject_kind: "client"/g,
  },
  {
    sense: "the frozen release log's reason, as each row was written",
    within: "deploy/RELEASES.md",
    written: /\bpre-client\b/g,
  },
  {
    sense: "the owner's own paths outside the repository, by their names",
    written: /\.planning\/client-bundle\b|\bfirst-client-content-inventory\b/g,
  },
  {
    sense: "OAuth's own records, as the exemptions describe them",
    within: "packages/schema/src/rls-exemptions.ts",
    written: /\bto every client\b|\bJoins client to resource\b/g,
  },
  {
    sense: "an OAuth client row's id in the schema's fixtures",
    within: "packages/schema/test/",
    written: /"client(?:-resource)?-\d+"|`client-\$\{/g,
  },
  {
    sense: "the harness's default client addresses",
    within: "apps/api/tests/client-addresses",
    written: /\bclients?\b/gi,
  },
  {
    sense: "a browser, or the set-up traffic, as one client address",
    within: ".claude/skills/browser-suite/",
    written: /\bone client and\b|\bwhich client asked\b/g,
  },
  {
    sense: "a browser asking codes from one client address",
    within: "apps/web/e2e/sign-in.spec.ts",
    written: /\bone client asks\b/g,
  },
  {
    sense: "Better Auth's client, which the lint rule holds to the identity feature",
    within: "apps/web/test/lint-rules.test.ts",
    written: /\bthe client in the identity feature\b/g,
  },
];

/** Where `chunk` is a piece of a byte stream, as Node's streams name it. */
const BYTE_STREAM_TREES = [
  "apps/api/src/ops.ts",
  "apps/api/src/ops/http-fetch.ts",
  "apps/api/tests/await-release.test.ts",
  "apps/api/tests/harness.ts",
  "apps/web/test/journeys-fixtures.test.ts",
  "apps/web/test/playwright-tree.ts",
  "packages/devtools/test/ci/script-stand-ins.ts",
  "packages/devtools/test/held-containers.ts",
  "packages/devtools/test/mutant-probe.test.ts",
];

/** Where `chunk` is Presidio's text window, whose names the detector's key hashes and stores. */
const DETECTOR_WINDOW_TREES = [
  "apps/worker/src/better_answers_worker/redaction/",
  "apps/worker/tests/test_redaction_windows.py",
  "apps/worker/tests/test_detection_key.py",
];

const PASSAGE_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  MIGRATION_TAG,
  {
    sense: "a migration file's name, which history keeps",
    written:
      /\b\d{4}_[\w-]*chunk[\w-]*\b|\bthe-chunk-substrate\b|\bchunk-and-functions\b|\bthe-readable-chunk\b/g,
  },
  ...BYTE_STREAM_TREES.map((within) => ({
    sense: "a piece of a byte stream",
    within,
    written: /\bchunks?\b/g,
  })),
  ...DETECTOR_WINDOW_TREES.map((within) => ({
    sense: "Presidio's text window",
    within,
    written: /\w*chunk\w*/gi,
  })),
  {
    sense: "a file the bundler emits, as Vite's build output names it",
    within: "apps/web/e2e/list-parts.spec.ts",
    written: /\bchunk\b/g,
  },
  {
    sense: "a slice of base64 the test inbox encodes at a time",
    within: "apps/test-inbox/",
    written: /\bBASE64_CHUNK_BYTES\b|\bchunks?\b/g,
  },
  {
    sense: "an assertion that the old word is gone from the find tool's description",
    within: "apps/api/tests/mcp-surface.test.ts",
    written: /"chunk"/g,
  },
  {
    sense: "the old word the catalogue test refuses in any name",
    within: "packages/schema/test/renamed-names.test.ts",
    written: /"chunk"/g,
  },
  {
    sense:
      "the locator form the span replaced, which the agreement keeps as a case the parser refuses",
    written: /\/chunks:0-1\b/g,
  },
  {
    sense: "the destination before migration 0069, as the migration tests seed it",
    within: "packages/schema/test/job-kinds.test.ts",
    written: /"chunk-index"|\bchunk-index destination\b/g,
  },
  {
    sense: "the value and the error an api before migration 0069 has, quoted as they read",
    within: "docs/operations/RUNBOOK.md",
    written: /`chunk-index`|relation "index\.chunk" does not exist/g,
  },
  {
    sense: "the names migration 0069 found, which a test puts back to run it again",
    within: "packages/schema/test/before-the-passage.ts",
    written: /\w*chunk\w*/g,
  },
  {
    sense: "the table's name before migration 0069, as a replayed older statement names it",
    within: "packages/schema/test/passage-columns.test.ts",
    written: /relname = 'chunk'/g,
  },
];

const SYNC = "sync";

const SYNC_LANDED = "2026-10-07";

const SYNC_CARVED_OUT: readonly CarveOut[] = [
  writtenBefore(SYNC_LANDED),
  ...CONNECTED_SOURCE_CARVED_OUT.slice(1),
  ...VENDORED,
];

/** No sync is written here. A tree that writes one is named file by file, so a sync stays read there. */
const OTHER_RUN_TREES = [
  ".claude/",
  ".github/",
  ".gitignore",
  ".oxlintrc.json",
  "AGENTS.md",
  "CODING_STANDARDS.md",
  "apps/api/CODING_STANDARDS.md",
  "apps/api/Dockerfile",
  "apps/api/package.json",
  "apps/api/src/ops/",
  "apps/api/stryker.config.mjs",
  "apps/api/tests/await-release.test.ts",
  "apps/api/tests/backup-image.test.ts",
  "apps/api/tests/better-auth-endpoints.",
  "apps/api/tests/browse-",
  "apps/api/tests/fixtures/",
  "apps/api/tests/image.test.ts",
  "apps/api/tests/local-database.test.ts",
  "apps/api/tests/operator.test.ts",
  "apps/api/tests/ops.test.ts",
  "apps/test-inbox/",
  "apps/web/e2e/console",
  "apps/web/e2e/flaky-report.ts",
  "apps/web/journeys/",
  "apps/web/src/shared/api/trpc.ts",
  "apps/web/src/shared/ui/",
  "apps/web/src/features/console/",
  "apps/web/test/journeys-",
  "apps/web/test/lint-rules.test.ts",
  "apps/web/playwright.config.ts",
  "apps/web/test/playwright-",
  "apps/worker/Dockerfile",
  "apps/worker/CODING_STANDARDS.md",
  "apps/worker/pyproject.toml",
  "apps/worker/src/better_answers_worker/links.py",
  "apps/worker/src/better_answers_worker/redaction/",
  "apps/worker/tests/fixtures/",
  "apps/worker/tests/test_image.py",
  "apps/worker/tests/test_redaction.py",
  "apps/worker/tests/test_redaction_descriptors.py",
  "apps/worker/tests/test_redaction_windows.py",
  "cubic.yaml",
  "deploy/",
  "docs/agents/",
  "docs/architecture/c4-context.md",
  "docs/architecture/c4-deployment.md",
  "docs/architecture/c4-dynamic-scheduled-work.md",
  "docs/okf-v02.md",
  "docs/operations/",
  "docs/solutions/architecture-patterns/adr-0007-",
  "docs/solutions/architecture-patterns/adr-0012-",
  "docs/solutions/architecture-patterns/adr-0022-",
  "docs/solutions/architecture-patterns/adr-0023-",
  "docs/solutions/architecture-patterns/adr-0024-",
  "docs/solutions/architecture-patterns/adr-0029-",
  "docs/solutions/architecture-patterns/adr-0031-",
  "docs/solutions/architecture-patterns/adr-0032-",
  "docs/solutions/architecture-patterns/adr-0047-",
  "docs/solutions/best-practices/",
  "docs/solutions/integration-issues/",
  "docs/solutions/logic-errors/",
  "docs/solutions/skill-design/",
  "docs/specs/v01-route.md",
  "package.json",
  "packages/core/package.json",
  "packages/core/scripts/",
  "packages/core/src/concepts/",
  "packages/core/src/erasure/",
  "packages/core/src/members/",
  "packages/core/src/sweeps/",
  "packages/core/src/workspaces/",
  "packages/core/stryker.config.mjs",
  "packages/core/test/audit-actions.test.ts",
  "packages/core/test/concepts.test.ts",
  "packages/core/test/cost-ledger.contract.test.ts",
  "packages/core/test/environment-lint.test.ts",
  "packages/core/test/erasure-replay.test.ts",
  "packages/core/test/erasure-routine.test.ts",
  "packages/core/test/import-bundle.test.ts",
  "packages/core/test/map.test.ts",
  "packages/core/test/promotion.test.ts",
  "packages/core/test/suggestions.test.ts",
  "packages/core/test/suite-objects.ts",
  "packages/core/test/test-workspace.test.ts",
  "packages/core/test/warm-objects",
  "packages/devtools/",
  "packages/schema/package.json",
  "packages/schema/roles-surface.json",
  "packages/schema/scripts/",
  "packages/schema/src/contract-",
  "packages/schema/test/apple-git.test.ts",
  "packages/schema/test/before-the-passage.ts",
  "packages/schema/test/contract-digest.test.ts",
  "packages/schema/test/email-address.test.ts",
  "packages/schema/test/harness.ts",
  "packages/schema/test/migration-ownership.test.ts",
  "packages/schema/test/roles-surface.test.ts",
  "packages/schema/test/warm-postgres.test.ts",
  "patches/",
  "renovate.json",
  "lefthook.yml",
  "scripts/",
];

const RUN_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  MIGRATION_TAG,
  ...OTHER_RUN_TREES.map((within) => ({
    sense: "a workflow's, a release's, a backup's, a script's or a suite's run",
    within,
    written: /\brun\b/gi,
  })),
  {
    sense: "a fixture whose every edit moves the contract's digest, written before the sync sweep",
    within: "contracts/",
    written: /\brun\b/gi,
  },
  {
    sense: "a release's run and its outcome word, a span's run of text, an act's cascade",
    within: "CONCEPTS.md",
    written:
      /\bpart of its run\b|\*cascade\* run\b|\bphases run\b|\bA run ends in\b|\bthe run could not judge\b|\brefused the run\b|\bthe next run sets back\b/g,
  },
  {
    sense: "a delivery round in a fixture document's text",
    written: /\bcollected on the next run\b/g,
  },
  { sense: "while a program runs", written: /\bat run time\b/gi },
  {
    sense: "a command a tool runs: a package script, a container, a test runner, a CI step",
    written:
      /\b(?:pnpm|npm|uv|bun|docker|podman|compose|vitest(?:\.mjs)?|wrangler|gh|cargo|mutmut|stryker(?:\.js)?)(?:\s+(?:--?[\w-]+|[\w@/.=-]+)){0,3}\s+run\b|--run\b|^\s*(?:-\s+)?run:|^RUN\b/gim,
  },
  {
    sense: "the plain verb",
    written:
      /(?<=\b(?:to|can|cannot|can't|will|won't|would|wouldn't|could|should|must|may|might|do|does|did|didn't|doesn't|don't|not|never|then|and|or|also|only|still|again|none|is|are|was|were|be|been|being|has|have|had|get|gets|got|we|you|they|I|who|lets?|makes?|helps?|please|just|always|once|agents?|workers?|tests?|suites?|jobs?|steps?|gates?|checks?|hooks?|scripts?|tasks?|yet|commands?|lanes?|legs?|shards?|tools?|sessions?|reviews?|rules?|drills?|routines?|passes?)\s+)run\b|(?:^|[.:;!?—(]\s+|^\s*(?:[-*>|#]+|\/\/|\/\*\*?|\d+\.)\s+|`\s*|\*\*)run\b/gim,
  },
  {
    sense: "a run of characters or of results",
    written:
      /\b(?:a|no|one|each|every|the|long|unmatched) run of\b|\brun of (?:whitespace|backticks|it)\b/gi,
  },
  {
    sense: "a CI, test, mutation, release or drill run, or a run whose kind its sentence names",
    written:
      /\b(?:CI|workflow|job|test|suite|mutation|Stryker|stryker|dry|release|drill|journeys?|browser|e2e|nightly|audit|rehearsal|probe|replay|rebase|baseline|scheduled|local|green|red|clean|full|whole|single|real|one-off|merge-group|merge queue|queue|Renovate|lint|check|CodeQL|deploy|backup|restore|sweep|reconciler|rebuild|cron|survey|session|agent|review|benchmark|tick|forced|fresh|catch-up)\s+run\b/gi,
  },
  {
    sense: "a code identifier: a runner, a step's callback, a process's result",
    written:
      /\brun(?=\.\w|\?\.|[([]|\s*(?:=(?!=)|=>|\?\?|===|!==)|:\s*(?:\(|async\b|\w+[,;)]?$))|(?<=[.([{,!]\s?)run(?=\s*[,)\]}:;])|\b(?:const|let|var|function|def|readonly|type|async|await|return|new|typeof|export|private|public|static|yield)\s+run\b|\.\.\.run\b|^\s*run[,;]?$|(?<=["'`])run(?=["'`])|(?<=")Run\b|\.run import\b|(?<=\/)run(?=\/)|(?<=, )run(?= (?:against|by|again|once)\b)/gim,
  },
  { sense: "the run key, the queue's own name", written: /\brun key\b/gi },
  {
    sense: "a hyphenated name: dry-run, re-run, could-not-run, a run id",
    written: /(?<=\w-)run\b|\brun(?=-\w)|\brun id\b/gi,
  },
];

const VERIFICATION = "verification";

const VERIFICATION_LANDED = "2026-10-07";

const VERIFICATION_CARVED_OUT: readonly CarveOut[] = [
  writtenBefore(VERIFICATION_LANDED),
  ...SWEEPS_OWN_WORDS,
];

/**
 * Where *check* named the trust event. Everywhere else the word keeps its other senses: CI's
 * `check`, a test's assertion, a health check, the verb.
 */
const TRUST_EVENT_FILES = [
  "packages/core/src/concepts/",
  "packages/core/src/answering/",
  "apps/api/src/mcp/",
  "packages/core/test/answering.test.ts",
  "packages/core/test/concepts.test.ts",
  "packages/core/test/erasure-map.test.ts",
  "packages/core/test/erasure-routine.test.ts",
  "packages/core/test/import-bundle.test.ts",
  "packages/core/test/suggestions.test.ts",
  "packages/core/test/visibility.test.ts",
];

const CHECK_SENSES: readonly Sense[] = [
  { sense: "a CHECK constraint, by its keyword or its name", written: /\bCHECK\b|\w+_check\b/g },
  {
    sense: "the stored act name, which audit rows keep (R22)",
    written: /\bknowledge\.check\.imported\b/g,
  },
  {
    sense: "the subject kind an audit row takes from that act name (R22)",
    within: "packages/core/test/import-bundle.test.ts",
    written: /"manifest concept check[\w ]*"|\bon a check\b/g,
  },
];

const CHECKER_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  MIGRATION_TAG,
  { sense: "a type checker", written: /\btype[- ]checker\b|\bTHE_TYPE_CHECKER_S_OWN\b/gi },
  { sense: "a link checker, which follows an IRI", written: /\blink checkers?\b/g },
  { sense: "a bundle's own checker, which the bundle ships", written: /\bbundle's own checker\b/g },
  ...[
    "packages/devtools/src/root-commands.ts",
    "packages/devtools/test/comment-gate-hook.test.ts",
  ].map((within) => ({
    sense: "the script the Python comment gate runs",
    within,
    written: /\bchecker(?:Path)?\b/g,
  })),
];

const UNCHECKED_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  { sense: "TypeScript's own compiler option", written: /\bnoUncheckedIndexedAccess\b/g },
];

const HIT_SENSES: readonly Sense[] = [
  { sense: "a cache hit", written: /\bcache[- ]hit\b/gi },
  {
    sense: "a reconciler hit, one commit the reconciler replayed (internal)",
    written: /\breconciler[- ]hits?\b/gi,
  },
  ...["packages/core/src/concepts/reconciler-hit.ts", "packages/core/test/reconciler.test.ts"].map(
    (within) => ({
      sense: "a reconciler hit, in the module and the test that read them",
      within,
      written: /\bhit\b/g,
    }),
  ),
  { sense: "the area a control answers a pointer over", written: /\bhit area\b/g },
];

/** Trees whose every domain is an email or DNS one: the testing domain, DKIM, the consumer domains. */
const MAIL_AND_DNS_TREES = [
  "packages/core/src/members/",
  "packages/core/test/invitation-sets.test.ts",
  "packages/core/test/invitations.test.ts",
  "packages/core/test/test-workspace.test.ts",
  "packages/schema/src/test-workspace.ts",
  "packages/schema/test/test-workspace.test.ts",
  "packages/schema/test/email-address.test.ts",
  "apps/api/tests/members-invitations.test.ts",
  "apps/api/tests/serve.ts",
  "apps/web/e2e/people-invitations.spec.ts",
  "apps/web/journeys/",
  "apps/web/test/journeys-inbox.test.ts",
  "apps/web/test/signed-mail.ts",
  "apps/worker/src/better_answers_worker/redaction/",
  "apps/worker/tests/fixtures/redaction/",
  "contracts/erasure-match/",
  "docs/solutions/best-practices/a-cloudflare-email-worker-test-inbox-needs-its-own-zone-and-a-token-scoped-to-it.md",
];

/** Each sense is code or a fixed phrase, so "per domain" and "the domain's owner" stay refused. */
const DOMAIN_SENSES: readonly Sense[] = [
  {
    sense: "an email domain, named by what it carries or sends",
    written:
      /\b(?:email|e-mail|mail|testing|consumer|sending|sender|signing|reserved|apex|custom|search)[- ]domains?\b|\bsender['’]s domain\b|`search` domain\b/gi,
  },
  {
    sense: "an address on or off an email domain, or what reaches it",
    written:
      /\baddress(?:es)? (?:on|off) (?:any other|that|this|its) domain\b|\bwhat reaches (?:that|this) domain\b|\boff a marked workspace['’]s domain\b|\boff-domain\b|\bdomain of its own\b/gi,
  },
  ...MAIL_AND_DNS_TREES.map((within) => ({
    sense: "an email or DNS domain, in a tree that writes no other",
    within,
    written: /\bdomains?\b/gi,
  })),
  {
    sense:
      "a web domain: a placeholder host, a cookie's attribute, a domain name or label, a relying party's",
    written:
      /<domain>|\bDomain=|\bdomain (?:names?|labels?)\b|\bWebAuthn domain\b|\brelying party (?:must be|is) a domain\b|\bWorker['’]s domains\b/gi,
  },
  {
    sense: "the ops command's flag naming the testing domain",
    written: /--domain\b|(?<=\[)"domain"(?=,)/g,
  },
  {
    sense: "a SQL domain, a type with its own constraint",
    written:
      /\bCREATE DOMAIN\b|\ba domain declared NOT NULL\b|\bthe domain declares\b|\bguarded domain VALUE\b/g,
  },
  {
    sense: "launchd's domain, in the script that loads the doc watcher",
    within: "scripts/jdocmunch-watch-cap.sh",
    written: /\bDOMAIN=|\$DOMAIN\b|"\$DOMAIN/g,
  },
  {
    sense:
      "a subject area, in fixed phrases: the glossary's domain words, domain knowledge, a domain type",
    written:
      /\bdomain[- ](?:docs?|documentation|terms?|words?|glossary|concepts?|knowledge|language|English|types?|values?|roles?|facts|schemas|expertise|specific)\b|\bauthority domains?\b|\bagents\/domain\.md\b/gi,
  },
];

const TYPE_VOCABULARY_SENSES: readonly Sense[] = [
  {
    sense: "TypeScript's type keyword before the refusal vocabulary's type, a set of refusal words",
    within: "packages/core/src/kernel/",
    written: /\btype Vocabulary\b/g,
  },
];

/** The database as 0071 stored it, seeded so migration 0072 can be run whole over it. */
const THE_DATABASE_BEFORE_0072 = [
  "packages/schema/test/before-the-knowledge-words.ts",
  "packages/schema/test/knowledge-words-end-to-end.test.ts",
];

const KNOWLEDGE_STORED_WORDS_CARVED_OUT: readonly CarveOut[] = [
  ...KNOWLEDGE_WORDS_CARVED_OUT,
  ...SWEEPS_OWN_WORDS,
  {
    holds: (file) => THE_DATABASE_BEFORE_0072.includes(file),
    why: "the stored names before migration 0072, which its end-to-end run seeds (R22)",
  },
];

/**
 * Where *candidate* and *repair* named a suggestion's kind. Elsewhere a candidate is the one under
 * test and a repair mends a workspace or a path.
 */
const SUGGESTION_KIND_FILES = [
  "packages/core/src/concepts/",
  "packages/schema/src/suggestion-tables.ts",
  "packages/schema/src/concept-tables.ts",
  "contracts/suggestions/",
  "packages/core/test/suggestions.test.ts",
  "packages/core/test/suggestions.contract.test.ts",
];

/** Where *inbox* named the suggestions' store, beside the Inbox area and the test inbox. */
const SUGGESTIONS_STORE_FILES = [
  "packages/core/src/concepts/",
  "packages/schema/src/suggestion-tables.ts",
  "packages/schema/src/definer-reach.ts",
  "contracts/suggestions/",
];

/**
 * Where *class* named a sensitivity. Elsewhere it is a refusal's class, a credential class, CSS
 * and the language keyword.
 */
const SENSITIVITY_FILES = [
  "packages/schema/src/concept-tables.ts",
  "packages/schema/src/table-ownership.ts",
  "packages/core/src/concepts/visibility.ts",
  "packages/core/src/sources/index.ts",
  "packages/core/src/sources/review.ts",
  "packages/core/src/sources/passages.ts",
  "packages/core/src/guides/",
  "packages/core/test/sensitivity-ranking.test.ts",
  "apps/api/src/ops/index.ts",
  "apps/api/src/mcp/entries/",
  "apps/web/src/features/sources/",
  "apps/web/e2e/sources.spec.ts",
];

const SENSITIVITY_SENSES: readonly Sense[] = [
  {
    sense: "the internal effective class, the narrower of a document's own and its source's",
    written: /\beffective class\b/gi,
  },
  {
    sense: "a refusal's class, which sorts a word by what its caller can do (R21)",
    written:
      /\brefusal'?s? class\b|\bits class\b(?=[^.]*\bword)|(?<=\bword\b[^.]*)\bits class\b|\brefusal\S*\.class\b/gi,
  },
  {
    sense: "the refusal word for a sensitivity its reader may not read (R21)",
    written: /\bclass-unreadable\b/g,
  },
];

/** The stored names migration 0072 renamed, which a test seeds or refuses as stored. */
const STORED_BEFORE_0072: readonly Sense[] = [
  {
    sense: "the old stored values a replay of migration 0072 seeds",
    within: "packages/schema/test/knowledge-words.test.ts",
    written: /'(?:quarantined|Composition)'|quarantine_error_check/g,
  },
  {
    sense: "the old names the catalogue test refuses in any name",
    within: "packages/schema/test/renamed-names.test.ts",
    written: /"(?:composition|concept_class_override|class_override)"/g,
  },
];

const COMPOSITION_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  ...STORED_BEFORE_0072,
  {
    sense: "a composition root, the one place that wires a program's parts together",
    written: /\bcomposition (?:root|roads)\b/gi,
  },
];

const QUARANTINE_SENSES: readonly Sense[] = [
  MIGRATION_TAG,
  ...STORED_BEFORE_0072,
  {
    sense: "a DMARC policy's word, which mail servers read",
    within: "apps/api/.claude/skills/email-best-practices/",
    written: /\bp=quarantine\b/g,
  },
];

const ACTION = "action";

const ACTION_LANDED = "2026-10-08";

const ACTION_CARVED_OUT: readonly CarveOut[] = [
  writtenBefore(ACTION_LANDED),
  ...SWEEPS_OWN_WORDS,
  ...VENDORED,
];

/** The names migration 0073 renamed, which a test puts back and runs the migration over again. */
const STORED_BEFORE_0073: readonly Sense[] = [
  ...[
    "packages/schema/test/before-the-action.ts",
    "packages/schema/test/action-column.test.ts",
  ].map((within) => ({
    sense: "the audit logs' column and constraints as migration 0073 found them (R22)",
    within,
    written: /\bact\b/g,
  })),
  {
    sense:
      "the column's name in the release note of migration 0073, and the error an older api answers",
    within: "docs/operations/RUNBOOK.md",
    written: /`act`|column "act" does not exist/g,
  },
];

/**
 * A determiner or a possessive before *act on* makes it the noun. The verb keeps to lower case, so
 * a label "Acts for" stays refused.
 */
const NOT_A_NOUN_BEFORE = String.raw`(?<!\b(?:[Aa]n?|[Tt]he|[Ee]ach|[Ee]very|[Oo]ne|[Nn]o|[Aa]ny|[Ii]ts|[Tt]heir|[Tt]his|[Tt]hese|[Tt]hose|own|whose|two|bulk|set|group|[\w-]+['’]s)\s)`;

const ACT_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  ...STORED_BEFORE_0073,
  {
    sense: "React's and Testing Library's act, in a call or its import",
    within: "apps/web/test/",
    written: /\bact(?=\()|\bact\b(?=[^;]*\bfrom "(?:react|@testing-library\/[\w-]+)")/g,
  },
  {
    sense: "the plain verb, after a word that makes it one, or before on or as",
    written: new RegExp(
      String.raw`(?<=\b(?:to|can|cannot|can't|will|won't|would|could|should|must|may|might|never|not|who|that|they|[Ww]e|[Yy]ou|[Nn]obody)\s+(?:still\s+|only\s+|also\s+)?)act\b|${NOT_A_NOUN_BEFORE}\bact (?:on|as)\b`,
      "g",
    ),
  },
  {
    sense: "the query key a page was asked with before this sweep, read still (R22)",
    within: "apps/web/src/shared/address-ask.ts",
    written: /\baction: "act"/g,
  },
  {
    sense: "an address asking under that older query key, in the test that proves it is still read",
    within: "apps/web/test/address-ask.test.tsx",
    written: /[?&]act=/g,
  },
];

const ACTS_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  {
    sense: "the plain verb, its subject's own: who acts, or acts on, as or for something",
    written: new RegExp(
      String.raw`\b[Ww]ho acts\b|${NOT_A_NOUN_BEFORE}\bacts (?:on|as|for)\b`,
      "g",
    ),
  },
];

export const OLD_WORDS: readonly OldWord[] = [
  avoided("2FA", "second factor"),
  avoided("access token", "personal token"),
  avoided("account", "workspace", "also never a member"),
  {
    word: "act",
    use: ACTION,
    entry: ACTION,
    sweep: ACTION,
    state: "landed",
    reach: "one sense",
    permitted: ACT_SENSES,
    carvedOut: ACTION_CARVED_OUT,
  },
  avoided("action bar", "toolbar"),
  avoided("action name", "audit action"),
  avoided("activity log", "Activity (of a person)"),
  avoided("activity record", "record family", "the draft's word"),
  pending("actor id", "the person's name", "actor id", "Audit log", "reader text"),
  {
    word: "acts",
    use: "actions",
    entry: ACTION,
    sweep: ACTION,
    state: "landed",
    reach: "everywhere",
    why: "the plural and every compound name, which the one-sense act row reads whole",
    permitted: ACTS_SENSES,
    carvedOut: ACTION_CARVED_OUT,
  },
  avoided("admin panel", "console"),
  pending("Agent Operations", "Models", "Control Centre", "model choice", "everywhere"),
  {
    word: "agent token",
    use: "share agent token",
    entry: "share agent token",
    sweep: "share agent token",
    state: "landed",
    reach: "one sense",
    permitted: [
      { sense: "the reader word, which holds the old one", written: /\bshare agent tokens?\b/gi },
    ],
    carvedOut: PEOPLE_WORDS_CARVED_OUT,
  },
  avoided("allow-list", "sensitivity override"),
  {
    word: "answer audit",
    use: "Questions asked",
    entry: "Questions asked",
    sweep: "Questions asked",
    state: "landed",
    reach: "everywhere",
    carvedOut: KNOWLEDGE_WORDS_CARVED_OUT,
  },
  avoided("api key", "share agent token"),
  avoided("api token", "personal token"),
  {
    word: "app",
    use: "api",
    entry: "api",
    sweep: "api",
    state: "landed",
    reach: "one sense",
    why: "19/09/2026: `apps/` holds three deployables, it is a hostname role in the ingress, and it reads as the whole product",
    permitted: APP_SENSES,
    carvedOut: [
      { holds: under("apps/web/"), why: NO_TIER_SENSE },
      { holds: under("packages/design-system/"), why: NO_TIER_SENSE },
    ],
  },
  {
    word: "audit act",
    use: "audit action",
    entry: "audit action",
    sweep: ACTION,
    state: "landed",
    reach: "everywhere",
    carvedOut: ACTION_CARVED_OUT,
  },
  avoided("audit line", "log line"),
  avoided("authenticator app", "authenticator"),
  avoided("authorisation", "admission", "the sign-in server's word"),
  avoided("back office", "console"),
  avoided("backup code", "recovery code"),
  {
    word: "backup run",
    use: "backup",
    entry: "backup",
    sweep: "backup",
    state: "landed",
    reach: "everywhere",
    carvedOut: PEOPLE_WORDS_CARVED_OUT,
  },
  avoided("ban", "end every sign-in and token"),
  avoided("batch action", "bulk action"),
  {
    word: "Better Answers",
    use: "better-answers",
    entry: "better-answers",
    sweep: "product name",
    state: "landed",
    reach: "one sense",
    why: "the prose form until 30/09/2026, which may still stand in prose",
    reads: isCodeAPersonReads,
  },
  avoided("Bid writer", "role (of a person)", "a job title", "Admin, Editor or Viewer"),
  {
    word: "bind",
    use: "connect",
    entry: "connected source",
    sweep: CONNECTED_SOURCE,
    state: "landed",
    reach: "one sense",
    permitted: BIND_SENSES,
    carvedOut: CONNECTED_SOURCE_ROWS_CARVED_OUT,
  },
  {
    word: "binding",
    use: "connected source",
    entry: "connected source",
    sweep: CONNECTED_SOURCE,
    state: "landed",
    reach: "everywhere",
    permitted: BINDING_SENSES,
    carvedOut: CONNECTED_SOURCE_ROWS_CARVED_OUT,
  },
  avoided("budget cap", "spending limit"),
  {
    word: "bulk act",
    use: "bulk action",
    entry: "bulk action",
    sweep: ACTION,
    state: "landed",
    reach: "everywhere",
    carvedOut: ACTION_CARVED_OUT,
  },
  {
    word: "bundle",
    use: "knowledge base",
    entry: "knowledge base",
    sweep: "knowledge base",
    state: "landed",
    reach: "reader text",
  },
  avoided("burger", "navigation control"),
  {
    word: "candidate",
    use: "suggested",
    entry: "suggested concept",
    sweep: "suggested concept",
    state: "landed",
    reach: "one sense",
    why: "a suggestion's kind; a candidate under test keeps its sense",
    reads: (file) => SUGGESTION_KIND_FILES.some((prefix) => file.startsWith(prefix)),
  },
  {
    word: "Changed since checked",
    use: "Changed since verified",
    entry: "Changed since verified",
    sweep: "trust words",
    state: "landed",
    reach: "reader text",
  },
  avoided("changed since last verified", "Changed since verified"),
  {
    word: "check",
    use: "verification",
    entry: "verification",
    sweep: VERIFICATION,
    state: "landed",
    reach: "one sense",
    why: "the trust event; every other sense of the word stands",
    permitted: CHECK_SENSES,
    reads: (file) => TRUST_EVENT_FILES.some((prefix) => file.startsWith(prefix)),
  },
  {
    word: "Checked by",
    use: "Verified by",
    entry: "Verified by <person>",
    sweep: "trust words",
    state: "landed",
    reach: "reader text",
    why: "and Verified automatically where the platform verified it",
  },
  {
    word: "checker",
    use: "verifier",
    entry: "verification request",
    sweep: VERIFICATION,
    state: "landed",
    reach: "everywhere",
    permitted: CHECKER_SENSES,
    carvedOut: VERIFICATION_CARVED_OUT,
  },
  avoided("checkpoint", "watermark", "a sync's per-batch mark"),
  {
    word: "Checks due",
    use: "Due for verification",
    entry: "verification request",
    sweep: VERIFICATION,
    state: "landed",
    reach: "reader text",
  },
  avoided("child route", "detail address"),
  {
    word: "chunk",
    use: PASSAGE,
    entry: PASSAGE,
    sweep: PASSAGE,
    state: "landed",
    reach: "everywhere",
    permitted: PASSAGE_SENSES,
    carvedOut: [
      writtenBefore(PASSAGE_LANDED),
      ...CONNECTED_SOURCE_CARVED_OUT.slice(1),
      ...VENDORED,
    ],
  },
  {
    word: "citation marker",
    use: "footnote",
    entry: "footnote",
    sweep: "footnote",
    state: "landed",
    reach: "everywhere",
    carvedOut: KNOWLEDGE_WORDS_CARVED_OUT,
  },
  avoided("citations list", "evidence pane"),
  {
    word: "class",
    use: "sensitivity",
    entry: "sensitivity",
    sweep: "sensitivity",
    state: "landed",
    reach: "one sense",
    why: "a sensitivity; a refusal's, a credential's, CSS's and the language's class stand",
    permitted: SENSITIVITY_SENSES,
    reads: (file) => SENSITIVITY_FILES.some((prefix) => file.startsWith(prefix)),
  },
  {
    word: "class override",
    use: "sensitivity override",
    entry: "sensitivity override",
    sweep: "sensitivity",
    state: "landed",
    reach: "everywhere",
    permitted: STORED_BEFORE_0072,
    carvedOut: KNOWLEDGE_STORED_WORDS_CARVED_OUT,
  },
  avoided("cleanup", "sweep pass"),
  avoided("clear", "emptying a connected source"),
  {
    word: "client",
    use: "assistant",
    entry: "assistant",
    sweep: "assistant",
    state: "landed",
    reach: "one sense",
    permitted: CLIENT_SENSES,
    carvedOut: PEOPLE_WORDS_CARVED_OUT,
  },
  avoided("client data on the box", "go-live", "for this day"),
  {
    word: "client grant",
    use: "access",
    entry: "access (of an assistant)",
    sweep: "access",
    state: "landed",
    reach: "everywhere",
    carvedOut: PEOPLE_WORDS_CARVED_OUT,
  },
  avoided("command", "action"),
  avoided("command palette", "Jump to"),
  {
    word: "composition",
    use: "write-up",
    entry: "write-up",
    sweep: "write-up",
    state: "landed",
    reach: "everywhere",
    permitted: COMPOSITION_SENSES,
    carvedOut: KNOWLEDGE_STORED_WORDS_CARVED_OUT,
  },
  avoided("connection", "connected source"),
  {
    word: "connector run",
    use: SYNC,
    entry: SYNC,
    sweep: SYNC,
    state: "landed",
    reach: "everywhere",
    carvedOut: SYNC_CARVED_OUT,
  },
  avoided("context word", "cue"),
  avoided("cron", "sweep pass"),
  avoided("cursor", "watermark"),
  avoided("dashboard", "home (of a role)"),
  avoided("deactivate", "end every sign-in and token"),
  avoided("decision", "withholding"),
  avoided("denial", "refusal"),
  avoided("derive-and-sync", "map rebuild", "for the edit path"),
  avoided(
    "derived class",
    "effective class",
    "a concept's sensitivity is derived, from its evidence",
  ),
  avoided("detection", "withholding"),
  {
    word: "domain",
    use: "collection",
    entry: "collection",
    sweep: "collection",
    state: "landed",
    reach: "one sense",
    permitted: DOMAIN_SENSES,
    carvedOut: [...KNOWLEDGE_WORDS_CARVED_OUT, ...SWEEPS_OWN_WORDS],
  },
  avoided("drawer", "navigation control"),
  avoided("environment", "estate"),
  avoided("epic", "block"),
  avoided("error", "refusal", "a failure, not a refusal"),
  avoided("error code", "refusal"),
  avoided("event log", "audit log"),
  avoided("event type", "audit action"),
  avoided("exception", "sensitivity override"),
  avoided("exemption", "sensitivity override"),
  avoided("expired", "shelf life", "of a concept; an invitation's status keeps it"),
  avoided("expiry", "shelf life"),
  {
    word: "extraction ceiling",
    use: "spending limit",
    entry: "spending limit",
    sweep: MODEL_CHOICE,
    state: "landed",
    reach: "everywhere",
    carvedOut: [writtenBefore(MODEL_CHOICE_LANDED)],
  },
  {
    word: "extraction plan",
    use: "cost estimate",
    entry: "cost estimate",
    sweep: "cost estimate",
    state: "landed",
    reach: "everywhere",
    carvedOut: KNOWLEDGE_WORDS_CARVED_OUT,
  },
  avoided("FIDO", "passkey"),
  avoided("field error", "issue word"),
  {
    word: "finding group",
    use: "group of findings",
    entry: "group of findings",
    sweep: "group of findings",
    state: "landed",
    reach: "everywhere",
    carvedOut: KNOWLEDGE_WORDS_CARVED_OUT,
  },
  avoided("folded class", "effective class"),
  avoided("Forgejo", "forge", "as a component"),
  avoided("front end", "area"),
  avoided("full name", "display name"),
  avoided("garbage collection", "sweep pass"),
  avoided("git host", "git store"),
  {
    word: "Gone-at-source impact",
    use: "Removed at source",
    entry: "Control Centre",
    sweep: "Removed at source",
    state: "landed",
    reach: "reader text",
  },
  {
    word: "graph",
    use: "map",
    entry: "map",
    sweep: MAP,
    state: "landed",
    reach: "one sense",
    permitted: GRAPH_SENSES,
    carvedOut: [writtenBefore(MAP_LANDED), ...VENDORED],
  },
  {
    word: "graph sync run",
    use: "map rebuild",
    entry: "map rebuild",
    sweep: MAP,
    state: "landed",
    reach: "everywhere",
    carvedOut: [writtenBefore(MAP_LANDED)],
  },
  avoided("guard", "admission"),
  avoided("hamburger", "navigation control"),
  avoided("helper", "step (of an action)"),
  {
    word: "hit",
    use: "match",
    entry: "match",
    sweep: "match",
    state: "landed",
    reach: "one sense",
    permitted: HIT_SENSES,
    carvedOut: [...KNOWLEDGE_WORDS_CARVED_OUT, ...SWEEPS_OWN_WORDS, ...VENDORED],
  },
  avoided("holder", "claimant"),
  avoided("id generator", "minter"),
  avoided("idempotency key", "run key", "cocoindex's word for its stable data ids"),
  avoided("identity key", "merge key"),
  {
    word: "inbox",
    use: "suggestions",
    entry: "To decide",
    sweep: "To decide",
    state: "landed",
    reach: "one sense",
    why: "the suggestions' store; the Inbox area and the test inbox keep the word",
    reads: (file) => SUGGESTIONS_STORE_FILES.some((prefix) => file.startsWith(prefix)),
  },
  avoided("infrastructure", "estate"),
  avoided("ingest trace", "source document", "the draft's word"),
  avoided("inner act", "step (of an action)"),
  avoided("integration", "connected source"),
  avoided("interactive connector", "MCP App"),
  avoided("invite", "invitation", "as a noun"),
  {
    word: "IRI",
    use: "link",
    entry: "link",
    sweep: "link",
    state: "landed",
    reach: "reader text",
  },
  avoided("issue code", "issue word"),
  avoided("item error", "refused items"),
  avoided("join link", "invitation"),
  avoided("kebab menu", "row menu"),
  avoided("KPI", "signal"),
  {
    word: "landed",
    use: "Received",
    entry: "connected source",
    sweep: CONNECTED_SOURCE,
    state: "landed",
    reach: "reader text",
  },
  avoided("landing page", "home (of a role)"),
  avoided("lane", "strand"),
  avoided("last login", "last active"),
  avoided("last seen", "last active"),
  avoided("last sign-in", "last active"),
  avoided("lead", "unmapped passage", "a sales word"),
  {
    word: "ledger",
    use: "audit log",
    entry: "audit log",
    sweep: "audit log",
    state: "landed",
    reach: "everywhere",
    why: "24/09/2026, for the word an Admin looks for",
    permitted: LEDGER_SENSES,
  },
  {
    word: "ledger act",
    use: "audit action",
    entry: "audit action",
    sweep: "audit log",
    state: "landed",
    reach: "everywhere",
  },
  {
    word: "locator",
    use: "link",
    entry: "link",
    sweep: "link",
    state: "landed",
    reach: "reader text",
  },
  avoided("locator fix", "citation fix"),
  avoided("lock", "lease", "nothing waits on it"),
  avoided("log", "audit log", "alone"),
  avoided("log entry", "audit event"),
  avoided("login", "sign-in"),
  avoided("login link", "sign-in link"),
  avoided("magic link", "sign-in link"),
  avoided("mass edit", "bulk action"),
  avoided("master spec", "route spec"),
  avoided("masthead", "top band"),
  avoided("member id", "person id", "retired 05/09/2026: the member row's key names nothing"),
  avoided("member sheet", "member page", "the word until 02/10/2026"),
  {
    word: "membership",
    use: "member",
    entry: "member",
    sweep: "member",
    state: "landed",
    reach: "everywhere",
    permitted: [
      {
        sense: "the count an erasure stores on its request's row and prints in its report (R22)",
        within: "packages/core/",
        written: /\bmembershipsEnded\b/g,
      },
    ],
    carvedOut: PEOPLE_WORDS_CARVED_OUT,
  },
  avoided("menu toggle", "navigation control"),
  avoided("message", "issue word"),
  avoided("metric", "signal"),
  avoided("MFA", "second factor"),
  avoided("milestone", "block"),
  avoided("Mission Control", "Control Centre"),
  avoided("moderation", "promotion gate"),
  avoided("multi-factor", "second factor"),
  avoided("natural key", "merge key"),
  {
    word: "needs checking again",
    use: "needs verifying again",
    entry: "Out of date",
    sweep: "trust words",
    state: "landed",
    reach: "reader text",
  },
  {
    word: "object store",
    use: "Received",
    entry: "landed copy",
    sweep: CONNECTED_SOURCE,
    state: "landed",
    reach: "reader text",
  },
  avoided("offered change", "suggestion"),
  avoided("one-time password", "authenticator"),
  avoided("operation", "action"),
  {
    word: "operator",
    use: "better-answers support",
    entry: "better-answers support",
    sweep: "better-answers support",
    state: "landed",
    reach: "reader text",
  },
  avoided("organisation", "workspace", "Better Auth's word for the same thing"),
  avoided("organisation member", "member"),
  avoided("organisation switcher", "workspace switcher"),
  avoided("overflow menu", "row menu"),
  avoided("panel", "MCP App"),
  avoided("parser", "converter", "the nightly parser audit's word, for a different thing"),
  avoided("partial refusal", "refused items"),
  avoided("pending", "invitation", "the value Better Auth stores", "waiting"),
  avoided("pending concept", "concept write request"),
  avoided("permission check", "admission"),
  pending("person id", "the person's name", "person id", "Audit log", "reader text"),
  avoided("person's name", "display name"),
  avoided("phase", "block"),
  avoided("phrasing variant", "context wording", "the record it was until 27/08/2026"),
  avoided("platform console", "console"),
  avoided("poll", "head check"),
  avoided("portal", "area"),
  {
    word: "priced plan",
    use: "cost estimate",
    entry: "cost estimate",
    sweep: "cost estimate",
    state: "landed",
    reach: "everywhere",
    carvedOut: KNOWLEDGE_WORDS_CARVED_OUT,
  },
  avoided("profile", "member page"),
  avoided("projection", "skeleton projection", "alone"),
  avoided("promote", "promotion", "as a reader's verb: a marketing word"),
  avoided("propagation", "cascade"),
  avoided("proposal", "suggestion", "the bid document a company completes"),
  {
    word: "Publish and accept gates",
    use: "Publishing rules",
    entry: "Control Centre",
    sweep: "Publishing rules",
    state: "landed",
    reach: "reader text",
  },
  avoided("purge", "emptying a connected source"),
  {
    word: "quarantine",
    use: "unreadable",
    entry: "unreadable",
    sweep: "unreadable",
    state: "landed",
    reach: "everywhere",
    permitted: QUARANTINE_SENSES,
    carvedOut: KNOWLEDGE_STORED_WORDS_CARVED_OUT,
  },
  {
    word: "quarantined",
    use: "unreadable",
    entry: "unreadable",
    sweep: "unreadable",
    state: "landed",
    reach: "everywhere",
    permitted: STORED_BEFORE_0072,
    carvedOut: KNOWLEDGE_STORED_WORDS_CARVED_OUT,
  },
  {
    word: "Queue",
    use: "To decide",
    entry: "To decide",
    sweep: "To decide",
    state: "landed",
    reach: "reader text",
  },
  avoided("quota", "spending limit"),
  avoided("RAG answer", "answer"),
  avoided("re-authenticate", "re-confirm"),
  avoided("reader surface", "area", "the word until 30/09/2026"),
  avoided("reader view", "area"),
  avoided("reclassify", "widen (a connected source)"),
  avoided("recompute", "cascade", "one level's work, not the whole"),
  avoided("reconciliation event", "reconciler hit"),
  {
    word: "referenced",
    use: "read live",
    entry: "reach (of a source)",
    sweep: CONNECTED_SOURCE,
    state: "landed",
    reach: "one sense",
    permitted: REFERENCED_SENSES,
    carvedOut: CONNECTED_SOURCE_ROWS_CARVED_OUT,
  },
  avoided("registered client", "assistant"),
  avoided("rejection", "refusal"),
  avoided("relink", "citation fix"),
  {
    word: "Remove and revoke",
    use: "Remove and end every sign-in",
    entry: "end every sign-in and token",
    sweep: "end every sign-in and token",
    state: "landed",
    reach: "reader text",
  },
  {
    word: "repair",
    use: "fix",
    entry: "citation fix",
    sweep: "citation fix",
    state: "landed",
    reach: "one sense",
    why: "a suggestion's kind; mending a workspace or a path keeps the word",
    reads: (file) => SUGGESTION_KIND_FILES.some((prefix) => file.startsWith(prefix)),
  },
  avoided("replay count", "reconciler hit"),
  avoided("report", "feedback"),
  avoided("repository server", "git store"),
  avoided("reset", "emptying a connected source"),
  avoided("reset code", "restore code"),
  avoided("result", "match", "the Result type every action returns"),
  {
    word: "review cadence",
    use: "verification interval",
    entry: "verification interval",
    sweep: VERIFICATION,
    state: "landed",
    reach: "everywhere",
    carvedOut: VERIFICATION_CARVED_OUT,
  },
  avoided("review queue", "To decide"),
  avoided("revision", "suggestion"),
  {
    word: "revoke credentials",
    use: "end every sign-in and token",
    entry: "end every sign-in and token",
    sweep: "end every sign-in and token",
    state: "landed",
    reach: "everywhere",
    carvedOut: PEOPLE_WORDS_CARVED_OUT,
  },
  avoided("roadmap", "route spec"),
  {
    word: "route",
    use: "model choice",
    entry: "model choice",
    sweep: MODEL_CHOICE,
    state: "landed",
    reach: "one sense",
    permitted: ROUTE_SENSES,
    carvedOut: [writtenBefore(MODEL_CHOICE_LANDED), ...VENDORED],
  },
  {
    word: "run",
    use: SYNC,
    entry: SYNC,
    sweep: SYNC,
    state: "landed",
    reach: "one sense",
    permitted: RUN_SENSES,
    carvedOut: SYNC_CARVED_OUT,
  },
  avoided("Sales", "role (of a person)", "a job title", "Admin, Editor or Viewer"),
  {
    word: "screen",
    use: "page",
    entry: "page",
    sweep: PAGE_AREA_MENU,
    state: "landed",
    reach: "one sense",
    permitted: SCREEN_SENSES,
    carvedOut: PAGE_AREA_MENU_CARVED_OUT,
  },
  avoided("seat", "member"),
  {
    word: "secondary nav",
    use: "menu",
    entry: "menu",
    sweep: PAGE_AREA_MENU,
    state: "landed",
    reach: "everywhere",
    permitted: [
      {
        sense: "the menu's showing choice, stored on readers' browsers under its first key (R22)",
        within: "apps/web/",
        written: /better-answers\.secondary-nav/g,
      },
    ],
    carvedOut: PAGE_AREA_MENU_CARVED_OUT,
  },
  avoided("section header", "toolbar"),
  avoided("section nav", "menu"),
  avoided("security key", "passkey", "one kind of device that can hold one"),
  avoided("selection store", "view-state slot"),
  avoided("service account", "share agent token"),
  avoided(
    "shadow schema",
    "boundary schema",
    "a second, hand-written description of a table's columns",
  ),
  avoided("shared context", "view-state slot"),
  avoided("sidebar", "menu"),
  avoided("site", "workspace"),
  {
    word: "slug",
    use: "short name",
    entry: "short name",
    sweep: "short name",
    state: "landed",
    reach: "everywhere",
    permitted: SHORT_NAME_SENSES,
    carvedOut: PEOPLE_WORDS_CARVED_OUT,
  },
  avoided("social login", "sign-in"),
  avoided("SSO", "sign-in", "only for the per-client shape, a client's own tenant"),
  avoided("start page", "home (of a role)"),
  avoided("step-up", "re-confirm"),
  avoided("structure export", "skeleton projection"),
  avoided("sub-act", "step (of an action)"),
  avoided("sub-nav", "menu"),
  avoided("sub-screen", "tab"),
  avoided("sudo", "re-confirm"),
  {
    word: "surface",
    use: "area",
    entry: "area",
    sweep: PAGE_AREA_MENU,
    state: "landed",
    reach: "one sense",
    permitted: SURFACE_SENSES,
    carvedOut: PAGE_AREA_MENU_CARVED_OUT,
  },
  avoided("sync lag", "map rebuild"),
  avoided("task", "job"),
  avoided("team", "group", "Liam, 05/09/2026: aligned to the Entra access model; nor a workspace"),
  avoided("team switcher", "workspace switcher"),
  avoided("the backend", "api"),
  avoided("the server", "api"),
  avoided("ticket", "job"),
  avoided("timeline", "Activity (of a person)"),
  avoided("top bar", "top band", "the word until 30/09/2026"),
  avoided("TOTP", "authenticator"),
  avoided("track", "strand"),
  avoided("TTL", "verification interval"),
  avoided("two-factor", "second factor"),
  avoided("type definition", "Term"),
  {
    word: "type vocabulary",
    use: "kind",
    entry: "kind",
    sweep: "kind",
    state: "landed",
    reach: "everywhere",
    permitted: TYPE_VOCABULARY_SENSES,
    carvedOut: KNOWLEDGE_WORDS_CARVED_OUT,
  },
  {
    word: "Unchecked",
    use: "Unverified",
    entry: "Unverified",
    sweep: "trust words",
    state: "landed",
    reach: "everywhere",
    why: "read everywhere since the verification sweep renamed its colour tokens",
    permitted: UNCHECKED_SENSES,
    carvedOut: VERIFICATION_CARVED_OUT,
  },
  avoided("unrestrict", "widen (a connected source)"),
  avoided("user", "member", "on a page"),
  avoided("user id", "person id", "on a page"),
  avoided("username", "display name"),
  avoided("validation error", "issue word"),
  avoided("vocabulary entry", "Term"),
  avoided("WebAuthn", "passkey"),
  avoided("widget", "MCP App"),
];

/** Internal heads a page may write in another sense, which the internal-word check leaves be. */
export const NOT_WATCHED_ON_PAGES: readonly { readonly head: string; readonly why: string }[] = [
  { head: "admission", why: "ordinary English" },
  { head: "block", why: "ordinary English, and CSS's display value" },
  { head: "cascade", why: "ordinary English" },
  { head: "consumer", why: "ordinary English" },
  { head: "cue", why: "ordinary English" },
  { head: "envelope", why: "ordinary English" },
  { head: "estate", why: "ordinary English" },
  { head: "forge", why: "ordinary English" },
  { head: "generation", why: "ordinary English" },
  { head: "include", why: "ordinary English" },
  { head: "job", why: "ordinary English" },
  { head: "land (the verb)", why: "ordinary English" },
  { head: "lease", why: "ordinary English" },
  { head: "minting", why: "ordinary English" },
  { head: "outcome", why: "ordinary English" },
  { head: "producer", why: "ordinary English" },
  { head: "refinement", why: "ordinary English" },
  { head: "release", why: "ordinary English" },
  { head: "staging", why: "ordinary English" },
  { head: "step (of an action)", why: "ordinary English" },
  { head: "strand", why: "ordinary English" },
  { head: "tenant", why: "Microsoft's own word for a company's directory" },
  { head: "tier (of a backup)", why: "a redaction rule's tier is a reader's word" },
  { head: "window", why: "ordinary English" },
];
