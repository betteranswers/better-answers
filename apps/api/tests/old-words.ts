/**
 * Only the words test reads this, so `CONTEXT.md` shows an agent the word to write and never the
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
      /\bcoco\.App\b|\bapp(?:: coco\.App)? = coco\.App\b|["']app["']: (?:\w+_APP\b|["'](?:landed|chunks)["'])|\b(?:landed|chunks) app\b/gi,
  },
  {
    sense:
      "the api's own names: the harness's app() getter, a TestApp held as app and passed on, the app hostname's key",
    within: "apps/api/",
    written:
      /"app"(?!:)|(?<!\.)\bapp\(|\b(?:readonly )?app: (?:TestApp\b|APP_HOSTNAME\b|string\b|hostnameOfUrl\(|"[^"]*")|\bapp = await startApp\(|(?<=\w\((?:\w+, )*)app(?=[,)])|^\s*(?:(?:const \w+ = )?await )?app,?$|\bhostnames\.app\b/gi,
  },
];

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
  {
    sense: "a migration's tag, naming the dated file it was generated as",
    within: "packages/schema/migrations/meta/",
    written: /"tag": "\d{4}_[\w-]+"/g,
  },
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
    within: "contracts/concept-inbox/",
    written: /\bdecision surface\b/g,
  },
];

const PAGE_AREA_MENU = "page, area and menu";

const PAGE_AREA_MENU_LANDED = "2026-10-04";

export const OLD_WORDS: readonly OldWord[] = [
  avoided("2FA", "second factor"),
  avoided("access token", "personal token"),
  avoided("account", "workspace", "also never a member"),
  pending("act", "action", "action", "action", "one sense"),
  avoided("action bar", "toolbar"),
  avoided("action name", "audit action"),
  avoided("activity log", "Activity (of a person)"),
  avoided("activity record", "record family", "the draft's word"),
  pending("actor id", "the person's name", "actor id", "Audit log", "reader text"),
  avoided("admin panel", "console"),
  pending("Agent Operations", "Models", "Control Centre", "model choice", "everywhere"),
  pending(
    "agent token",
    "share agent token",
    "share agent token",
    "share agent token",
    "one sense",
  ),
  avoided("allow-list", "sensitivity override"),
  pending("answer audit", "Questions asked", "Questions asked", "Questions asked", "everywhere"),
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
  pending("audit act", "audit action", "audit action", "action", "everywhere"),
  avoided("audit line", "log line"),
  avoided("authenticator app", "authenticator"),
  avoided("authorisation", "admission", "the sign-in server's word"),
  avoided("back office", "console"),
  avoided("backup code", "recovery code"),
  pending("backup run", "backup", "backup", "backup", "everywhere"),
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
  pending("bind", "connect", "connected source", "connected source", "one sense"),
  pending("binding", "connected source", "connected source", "connected source", "everywhere"),
  avoided("budget cap", "spending limit"),
  pending("bulk act", "bulk action", "bulk action", "action", "everywhere"),
  pending("bundle", "knowledge base", "knowledge base", "knowledge base", "reader text"),
  avoided("burger", "navigation control"),
  pending("candidate", "suggested", "suggested concept", "suggested concept", "one sense"),
  {
    word: "Changed since checked",
    use: "Changed since verified",
    entry: "Changed since verified",
    sweep: "trust words",
    state: "landed",
    reach: "reader text",
  },
  avoided("changed since last verified", "Changed since verified"),
  pending("check", "verification", "verification", "verification", "one sense"),
  {
    word: "Checked by",
    use: "Verified by",
    entry: "Verified by <person>",
    sweep: "trust words",
    state: "landed",
    reach: "reader text",
    why: "and Verified automatically where the platform verified it",
  },
  pending("checker", "verifier", "verification request", "verification", "everywhere"),
  avoided("checkpoint", "watermark", "a sync's per-batch mark"),
  pending(
    "Checks due",
    "Due for verification",
    "verification request",
    "verification",
    "reader text",
  ),
  avoided("child route", "detail address"),
  pending("chunk", "passage", "passage", "passage", "everywhere"),
  pending("citation marker", "footnote", "footnote", "footnote", "everywhere"),
  avoided("citations list", "evidence pane"),
  pending("class", "sensitivity", "sensitivity", "sensitivity", "one sense"),
  pending(
    "class override",
    "sensitivity override",
    "sensitivity override",
    "sensitivity",
    "everywhere",
  ),
  avoided("cleanup", "sweep pass"),
  avoided("clear", "emptying a binding"),
  pending("client", "assistant", "assistant", "assistant", "one sense"),
  avoided("client data on the box", "go-live", "for this day"),
  pending("client grant", "access", "access (of an assistant)", "access", "everywhere"),
  avoided("command", "action"),
  avoided("command palette", "Jump to"),
  pending("composition", "write-up", "write-up", "write-up", "everywhere"),
  avoided("connection", "connected source"),
  pending("connector run", "sync", "sync", "sync", "everywhere"),
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
  pending("domain", "collection", "collection", "collection", "one sense"),
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
  pending("extraction ceiling", "spending limit", "spending limit", "model choice", "everywhere"),
  pending("extraction plan", "cost estimate", "cost estimate", "cost estimate", "everywhere"),
  avoided("FIDO", "passkey"),
  avoided("field error", "issue word"),
  pending(
    "finding group",
    "group of findings",
    "group of findings",
    "group of findings",
    "everywhere",
  ),
  avoided("folded class", "effective class"),
  avoided("Forgejo", "forge", "as a component"),
  avoided("front end", "area"),
  avoided("full name", "display name"),
  avoided("garbage collection", "sweep pass"),
  avoided("git host", "git store"),
  pending(
    "Gone-at-source impact",
    "Removed at source",
    "Control Centre",
    "Removed at source",
    "reader text",
  ),
  pending("graph", "map", "map", "map", "one sense"),
  pending("graph sync run", "map rebuild", "map rebuild", "map", "everywhere"),
  avoided("guard", "admission"),
  avoided("hamburger", "navigation control"),
  avoided("helper", "step (of an action)"),
  pending("hit", "match", "match", "match", "one sense"),
  avoided("holder", "claimant"),
  avoided("id generator", "minter"),
  avoided("idempotency key", "run key", "cocoindex's word for its stable data ids"),
  avoided("identity key", "merge key"),
  avoided("infrastructure", "estate"),
  avoided("ingest trace", "source document", "the draft's word"),
  avoided("inner act", "step (of an action)"),
  avoided("integration", "connected source"),
  avoided("interactive connector", "MCP App"),
  avoided("invite", "invitation", "as a noun"),
  pending("IRI", "link", "link", "link", "reader text"),
  avoided("issue code", "issue word"),
  avoided("item error", "refused items"),
  avoided("join link", "invitation"),
  avoided("kebab menu", "row menu"),
  avoided("KPI", "signal"),
  pending("landed", "Received", "connected source", "connected source", "reader text"),
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
  pending("locator", "link", "link", "link", "reader text"),
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
  pending("membership", "member", "member", "member", "everywhere"),
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
  pending("object store", "Received", "landed copy", "connected source", "reader text"),
  avoided("offered change", "suggestion"),
  avoided("one-time password", "authenticator"),
  avoided("operation", "action"),
  pending(
    "operator",
    "better-answers support",
    "better-answers support",
    "better-answers support",
    "reader text",
  ),
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
  pending("priced plan", "cost estimate", "cost estimate", "cost estimate", "everywhere"),
  avoided("profile", "member page"),
  avoided("projection", "skeleton projection", "alone"),
  avoided("promote", "promotion", "as a reader's verb: a marketing word"),
  avoided("propagation", "cascade"),
  avoided("proposal", "suggestion", "the bid document a company completes"),
  pending(
    "Publish and accept gates",
    "Publishing rules",
    "Control Centre",
    "Publishing rules",
    "reader text",
  ),
  avoided("purge", "emptying a binding"),
  pending("quarantine", "unreadable", "unreadable", "unreadable", "everywhere"),
  pending("quarantined", "unreadable", "unreadable", "unreadable", "everywhere"),
  pending("Queue", "To decide", "To decide", "To decide", "reader text"),
  avoided("quota", "spending limit"),
  avoided("RAG answer", "answer"),
  avoided("re-authenticate", "re-confirm"),
  avoided("reader surface", "area", "the word until 30/09/2026"),
  avoided("reader view", "area"),
  avoided("reclassify", "widen (a connected source)"),
  avoided("recompute", "cascade", "one level's work, not the whole"),
  avoided("reconciliation event", "reconciler hit"),
  pending("referenced", "read live", "reach (of a source)", "connected source", "one sense"),
  avoided("registered client", "assistant"),
  avoided("rejection", "refusal"),
  avoided("relink", "citation fix"),
  pending(
    "Remove and revoke",
    "Remove and end every sign-in",
    "end every sign-in and token",
    "end every sign-in and token",
    "reader text",
  ),
  pending("repair", "fix", "citation fix", "citation fix", "one sense"),
  avoided("replay count", "reconciler hit"),
  avoided("report", "feedback"),
  avoided("repository server", "git store"),
  avoided("reset", "emptying a binding"),
  avoided("reset code", "restore code"),
  avoided("result", "match", "the Result type every action returns"),
  pending(
    "review cadence",
    "verification interval",
    "verification interval",
    "verification",
    "everywhere",
  ),
  avoided("review queue", "To decide"),
  avoided("revision", "suggestion"),
  pending(
    "revoke credentials",
    "end every sign-in and token",
    "end every sign-in and token",
    "end every sign-in and token",
    "everywhere",
  ),
  avoided("roadmap", "route spec"),
  pending("route", "model choice", "model choice", "model choice", "one sense"),
  pending("run", "sync", "sync", "sync", "one sense"),
  avoided("Sales", "role (of a person)", "a job title", "Admin, Editor or Viewer"),
  {
    word: "screen",
    use: "page",
    entry: "page",
    sweep: PAGE_AREA_MENU,
    state: "landed",
    reach: "one sense",
    permitted: SCREEN_SENSES,
    carvedOut: [writtenBefore(PAGE_AREA_MENU_LANDED)],
  },
  avoided("seat", "member"),
  {
    word: "secondary nav",
    use: "menu",
    entry: "menu",
    sweep: PAGE_AREA_MENU,
    state: "landed",
    reach: "everywhere",
    carvedOut: [writtenBefore(PAGE_AREA_MENU_LANDED)],
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
  pending("slug", "short name", "short name", "short name", "everywhere"),
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
    carvedOut: [writtenBefore(PAGE_AREA_MENU_LANDED)],
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
  pending("type vocabulary", "kind", "kind", "kind", "everywhere"),
  {
    word: "Unchecked",
    use: "Unverified",
    entry: "Unverified",
    sweep: "trust words",
    state: "landed",
    reach: "reader text",
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
