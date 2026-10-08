/**
 * Only the words test reads this, so `CONCEPTS.md` shows an agent the word to write and never the
 * word it replaced.
 */

/** `within` keeps a sense to the one tree whose code writes it. */
export type Sense = { readonly sense: string; readonly written: RegExp; readonly within?: string };

export type CarveOut = { readonly holds: (file: string) => boolean; readonly why: string };

/** An old word is refused in every form, whole outside its permitted senses, or in reader text alone. */
type Reach = "everywhere" | "one sense" | "reader text";

/** A word the glossary replaced, refused where its reach says from the pull request that renames it. */
export type OldWord = {
  readonly word: string;
  readonly use: string;
  readonly entry: string;
  readonly sweep: string;
  readonly reach: Reach;
  readonly why?: string;
  readonly permitted?: readonly Sense[];
  readonly carvedOut?: readonly CarveOut[];
  readonly reads?: (file: string) => boolean;
};

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

/** Names a sweep never renames: ADR filenames keep their slugs (KTD14), and the archive is frozen. */
const FILED_NAMES: readonly Sense[] = [
  { sense: "an ADR's filename", written: /\badr-\d{4}-[a-z0-9-]+/g },
  { sense: "a path into the frozen archive", written: /\bdocs\/archive\/[\w./-]+/g },
];

const PAGE_AREA_MENU = "page, area and menu";

const MODEL_CHOICE = "model choice";

const AGENT_OPERATIONS_SENSES: readonly Sense[] = [
  {
    sense:
      "the Flux AgentOps comparison and its history, which keep the group's old name until a later page lands",
    within:
      "docs/solutions/architecture-patterns/adr-0047-the-platform-is-surfaces-groups-and-screens.md",
    written:
      /\bAgent Operations against Flux AgentOps\b|\b(?:page|Approvals) in Agent Operations\b|\bfolded into Agent Operations\b|\bAgent Operations group is now\b/g,
  },
];

const MAP = "map";

const CONNECTED_SOURCE = "connected source";

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

const PASSAGE = "passage";

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

const VERIFICATION = "verification";

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

const SEEDED_BEFORE_0072: readonly CarveOut[] = [
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

/** The names migration 0073 renamed, which a test puts back and runs the migration over again. */
const STORED_BEFORE_0073: readonly Sense[] = [
  ...[
    "packages/schema/test/before-the-action.ts",
    "packages/schema/test/action-column.test.ts",
  ].map((within) => ({
    sense: "the audit logs' column and constraints as migration 0073 found them (R22)",
    within,
    written: /["']act["']|\(act\||(?<=\(id, (?:workspace_id, )?)act(?=, actor\b)/g,
  })),
  {
    sense:
      "the column's name in the release note of migration 0073, and the error an older api answers",
    within: "docs/operations/RUNBOOK.md",
    written: /`act`|column "act" does not exist/g,
  },
];

/** Fitted to the tree, and held to lower case so a label such as "Acts for" stays refused. */
const ACT_AS_A_VERB = [
  String.raw`(?<=\b(?:to|can|cannot|can't|will|won't|would|could|should|must|may|might|never|not|who|[Tt]hey|[Ww]e|[Yy]ou|[Nn]obody)\s+(?:still\s+|only\s+|also\s+)?)act\b`,
  String.raw`(?<=\b(?:that|and)\s)act (?:on|as)\b`,
];

/** A verb's subject before *acts*, fitted to the tree; any other word leaves the plural a noun. */
const ACTS_AS_A_VERB = [
  String.raw`\b[Ww]ho acts\b`,
  String.raw`(?<=\b(?:agent|step|reader|reviewer|principal\*?|run|nothing|never|or|Renovate)\s)acts (?:on|as|for)\b`,
];

/** Where an address asks under the query key a page had before this sweep, which is read still. */
const ASKING_UNDER_THE_OLDER_KEY = [
  "apps/web/test/address-ask.test.tsx",
  "apps/web/test/people-address.test.ts",
];

const ACT_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  ...STORED_BEFORE_0073,
  {
    sense: "React's and Testing Library's act, in a call or its import",
    within: "apps/web/test/",
    written: /\bact(?=\()|\bact\b(?=[^;]*\bfrom "(?:react|@testing-library\/[\w-]+)")/g,
  },
  {
    sense: "the plain verb, after a word that makes it one",
    written: new RegExp(ACT_AS_A_VERB.join("|"), "g"),
  },
  {
    sense: "the query key a page was asked with before this sweep, read still (R22)",
    within: "apps/web/src/shared/address-ask.ts",
    written: /\baction: "act"/g,
  },
  ...ASKING_UNDER_THE_OLDER_KEY.map((within) => ({
    sense: "an address asking under that older query key, in a test that proves it is still read",
    within,
    written: /[?&]act=/g,
  })),
];

const ACTS_SENSES: readonly Sense[] = [
  ...FILED_NAMES,
  {
    sense: "the plain verb, after its subject",
    written: new RegExp(ACTS_AS_A_VERB.join("|"), "g"),
  },
];

export const OLD_WORDS: readonly OldWord[] = [
  {
    word: "act",
    use: ACTION,
    entry: ACTION,
    sweep: ACTION,
    reach: "one sense",
    permitted: ACT_SENSES,
  },
  {
    word: "actor id",
    use: "the person's name",
    entry: "actor id",
    sweep: "Audit log",
    reach: "reader text",
  },
  {
    word: "acts",
    use: "actions",
    entry: ACTION,
    sweep: ACTION,
    reach: "everywhere",
    why: "the plural and its compounds; a singular compound such as declareAct is read by neither row",
    permitted: ACTS_SENSES,
  },
  {
    word: "Agent Operations",
    use: "Models",
    entry: "Control Centre",
    sweep: MODEL_CHOICE,
    reach: "everywhere",
    permitted: AGENT_OPERATIONS_SENSES,
  },
  {
    word: "agent token",
    use: "share agent token",
    entry: "share agent token",
    sweep: "share agent token",
    reach: "one sense",
    permitted: [
      { sense: "the reader word, which holds the old one", written: /\bshare agent tokens?\b/gi },
    ],
  },
  {
    word: "answer audit",
    use: "Questions asked",
    entry: "Questions asked",
    sweep: "Questions asked",
    reach: "everywhere",
  },
  {
    word: "app",
    use: "api",
    entry: "api",
    sweep: "api",
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
    reach: "everywhere",
  },
  {
    word: "backup run",
    use: "backup",
    entry: "backup",
    sweep: "backup",
    reach: "everywhere",
  },
  {
    word: "Better Answers",
    use: "better-answers",
    entry: "better-answers",
    sweep: "product name",
    reach: "one sense",
    why: "the prose form until 30/09/2026, which may still stand in prose",
    reads: isCodeAPersonReads,
  },
  {
    word: "binding",
    use: "connected source",
    entry: "connected source",
    sweep: CONNECTED_SOURCE,
    reach: "everywhere",
    permitted: BINDING_SENSES,
  },
  {
    word: "bulk act",
    use: "bulk action",
    entry: "bulk action",
    sweep: ACTION,
    reach: "everywhere",
  },
  {
    word: "bundle",
    use: "knowledge base",
    entry: "knowledge base",
    sweep: "knowledge base",
    reach: "reader text",
  },
  {
    word: "candidate",
    use: "suggested",
    entry: "suggested concept",
    sweep: "suggested concept",
    reach: "one sense",
    why: "a suggestion's kind; a candidate under test keeps its sense",
    reads: (file) => SUGGESTION_KIND_FILES.some((prefix) => file.startsWith(prefix)),
  },
  {
    word: "Changed since checked",
    use: "Changed since verified",
    entry: "Changed since verified",
    sweep: "trust words",
    reach: "reader text",
  },
  {
    word: "check",
    use: "verification",
    entry: "verification",
    sweep: VERIFICATION,
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
    reach: "reader text",
    why: "and Verified automatically where the platform verified it",
  },
  {
    word: "checker",
    use: "verifier",
    entry: "verification request",
    sweep: VERIFICATION,
    reach: "everywhere",
    permitted: CHECKER_SENSES,
  },
  {
    word: "Checks due",
    use: "Due for verification",
    entry: "verification request",
    sweep: VERIFICATION,
    reach: "reader text",
  },
  {
    word: "chunk",
    use: PASSAGE,
    entry: PASSAGE,
    sweep: PASSAGE,
    reach: "everywhere",
    permitted: PASSAGE_SENSES,
  },
  {
    word: "citation marker",
    use: "footnote",
    entry: "footnote",
    sweep: "footnote",
    reach: "everywhere",
  },
  {
    word: "class",
    use: "sensitivity",
    entry: "sensitivity",
    sweep: "sensitivity",
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
    reach: "everywhere",
    permitted: STORED_BEFORE_0072,
    carvedOut: SEEDED_BEFORE_0072,
  },
  {
    word: "client",
    use: "assistant",
    entry: "assistant",
    sweep: "assistant",
    reach: "reader text",
  },
  {
    word: "client grant",
    use: "access",
    entry: "access (of an assistant)",
    sweep: "access",
    reach: "everywhere",
  },
  {
    word: "composition",
    use: "write-up",
    entry: "write-up",
    sweep: "write-up",
    reach: "everywhere",
    permitted: COMPOSITION_SENSES,
    carvedOut: SEEDED_BEFORE_0072,
  },
  {
    word: "connector run",
    use: SYNC,
    entry: SYNC,
    sweep: SYNC,
    reach: "everywhere",
  },
  {
    word: "domain",
    use: "collection",
    entry: "collection",
    sweep: "collection",
    reach: "one sense",
    permitted: DOMAIN_SENSES,
  },
  {
    word: "extraction ceiling",
    use: "spending limit",
    entry: "spending limit",
    sweep: MODEL_CHOICE,
    reach: "everywhere",
  },
  {
    word: "extraction plan",
    use: "cost estimate",
    entry: "cost estimate",
    sweep: "cost estimate",
    reach: "everywhere",
  },
  {
    word: "finding group",
    use: "group of findings",
    entry: "group of findings",
    sweep: "group of findings",
    reach: "everywhere",
  },
  {
    word: "Gone-at-source impact",
    use: "Removed at source",
    entry: "Control Centre",
    sweep: "Removed at source",
    reach: "reader text",
  },
  {
    word: "graph sync run",
    use: "map rebuild",
    entry: "map rebuild",
    sweep: MAP,
    reach: "everywhere",
  },
  {
    word: "hit",
    use: "match",
    entry: "match",
    sweep: "match",
    reach: "reader text",
  },
  {
    word: "inbox",
    use: "suggestions",
    entry: "To decide",
    sweep: "To decide",
    reach: "one sense",
    why: "the suggestions' store; the Inbox area and the test inbox keep the word",
    reads: (file) => SUGGESTIONS_STORE_FILES.some((prefix) => file.startsWith(prefix)),
  },
  {
    word: "IRI",
    use: "link",
    entry: "link",
    sweep: "link",
    reach: "reader text",
  },
  {
    word: "landed",
    use: "Received",
    entry: "connected source",
    sweep: CONNECTED_SOURCE,
    reach: "reader text",
  },
  {
    word: "ledger",
    use: "audit log",
    entry: "audit log",
    sweep: "audit log",
    reach: "everywhere",
    why: "24/09/2026, for the word an Admin looks for",
    permitted: LEDGER_SENSES,
  },
  {
    word: "ledger act",
    use: "audit action",
    entry: "audit action",
    sweep: "audit log",
    reach: "everywhere",
  },
  {
    word: "locator",
    use: "link",
    entry: "link",
    sweep: "link",
    reach: "reader text",
  },
  {
    word: "membership",
    use: "member",
    entry: "member",
    sweep: "member",
    reach: "everywhere",
    permitted: [
      {
        sense: "the count an erasure stores on its request's row and prints in its report (R22)",
        within: "packages/core/",
        written: /\bmembershipsEnded\b/g,
      },
    ],
  },
  {
    word: "needs checking again",
    use: "needs verifying again",
    entry: "Out of date",
    sweep: "trust words",
    reach: "reader text",
  },
  {
    word: "object store",
    use: "Received",
    entry: "landed copy",
    sweep: CONNECTED_SOURCE,
    reach: "reader text",
  },
  {
    word: "operator",
    use: "better-answers support",
    entry: "better-answers support",
    sweep: "better-answers support",
    reach: "reader text",
  },
  {
    word: "person id",
    use: "the person's name",
    entry: "person id",
    sweep: "Audit log",
    reach: "reader text",
  },
  {
    word: "priced plan",
    use: "cost estimate",
    entry: "cost estimate",
    sweep: "cost estimate",
    reach: "everywhere",
  },
  {
    word: "Publish and accept gates",
    use: "Publishing rules",
    entry: "Control Centre",
    sweep: "Publishing rules",
    reach: "reader text",
  },
  {
    word: "quarantine",
    use: "unreadable",
    entry: "unreadable",
    sweep: "unreadable",
    reach: "everywhere",
    permitted: QUARANTINE_SENSES,
    carvedOut: SEEDED_BEFORE_0072,
  },
  {
    word: "quarantined",
    use: "unreadable",
    entry: "unreadable",
    sweep: "unreadable",
    reach: "everywhere",
    permitted: STORED_BEFORE_0072,
    carvedOut: SEEDED_BEFORE_0072,
  },
  {
    word: "Queue",
    use: "To decide",
    entry: "To decide",
    sweep: "To decide",
    reach: "reader text",
  },
  {
    word: "referenced",
    use: "read live",
    entry: "reach (of a source)",
    sweep: CONNECTED_SOURCE,
    reach: "one sense",
    permitted: REFERENCED_SENSES,
  },
  {
    word: "Remove and revoke",
    use: "Remove and end every sign-in",
    entry: "end every sign-in and token",
    sweep: "end every sign-in and token",
    reach: "reader text",
  },
  {
    word: "repair",
    use: "fix",
    entry: "citation fix",
    sweep: "citation fix",
    reach: "one sense",
    why: "a suggestion's kind; mending a workspace or a path keeps the word",
    reads: (file) => SUGGESTION_KIND_FILES.some((prefix) => file.startsWith(prefix)),
  },
  {
    word: "review cadence",
    use: "verification interval",
    entry: "verification interval",
    sweep: VERIFICATION,
    reach: "everywhere",
  },
  {
    word: "revoke credentials",
    use: "end every sign-in and token",
    entry: "end every sign-in and token",
    sweep: "end every sign-in and token",
    reach: "everywhere",
  },
  {
    word: "run",
    use: SYNC,
    entry: SYNC,
    sweep: SYNC,
    reach: "reader text",
  },
  {
    word: "screen",
    use: "page",
    entry: "page",
    sweep: PAGE_AREA_MENU,
    reach: "reader text",
  },
  {
    word: "secondary nav",
    use: "menu",
    entry: "menu",
    sweep: PAGE_AREA_MENU,
    reach: "everywhere",
    permitted: [
      {
        sense: "the menu's showing choice, stored on readers' browsers under its first key (R22)",
        within: "apps/web/",
        written: /better-answers\.secondary-nav/g,
      },
    ],
  },
  {
    word: "slug",
    use: "short name",
    entry: "short name",
    sweep: "short name",
    reach: "everywhere",
    permitted: SHORT_NAME_SENSES,
  },
  {
    word: "surface",
    use: "area",
    entry: "area",
    sweep: PAGE_AREA_MENU,
    reach: "reader text",
  },
  {
    word: "Tokens",
    use: "Personal tokens",
    entry: "personal token",
    sweep: "Personal tokens",
    reach: "one sense",
    why: "the People page's name; a token, a design token and a detail's label keep the word",
    permitted: [
      {
        sense: "the page's name now, which holds the old one",
        written: /\b[Pp]ersonal[ -]tokens\b/g,
      },
    ],
    reads: (file) => file === "apps/web/src/shared/navigation.ts",
  },
  {
    word: "type vocabulary",
    use: "kind",
    entry: "kind",
    sweep: "kind",
    reach: "everywhere",
    permitted: TYPE_VOCABULARY_SENSES,
  },
  {
    word: "Unchecked",
    use: "Unverified",
    entry: "Unverified",
    sweep: "trust words",
    reach: "everywhere",
    why: "read everywhere since the verification sweep renamed its colour tokens",
    permitted: UNCHECKED_SENSES,
  },
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
