/**
 * Who owns each table, and who else reads or writes one.
 *
 * ADR 0029 names the failure that no import-direction linter can ever see: one slice
 * writing SQL against another slice's tables works perfectly, because it is the same
 * database. The mitigation it names first is **a checked-in table-ownership map,
 * reviewed like the export list** — this file. It is shaped like `RLS_EXEMPTIONS`
 * beside it (T-015) for the same reason: one record a reviewer reads, every entry
 * carrying a reason, and a test asserting each pair in both directions, so no name can
 * be added in one place and forgotten in another
 * (`packages/schema/test/table-ownership.test.ts`).
 *
 * **An owner is a module, written as the name a reader can open it by.** Most owners are
 * slices — the capability whose invariants a table holds, which is the write path and
 * never a screen (ADR 0029) — and a slice is written as its directory name under
 * `packages/core/src/`: `workspaces`, `sources`. `llm` is written the same way without
 * being a slice (ADR 0029 rule 3: `llm` and `audit` import `kernel`, `access` and
 * `store`, never a slice and never each other), because the name still opens a
 * directory. Three owners are not a directory name under `packages/core/src/` — the
 * identity provider lives outside it, and the two doors sit a level deeper — so each is
 * written as the repository path of the module it is, a form no directory name there can
 * take, and the two kinds can never be confused:
 *
 * - `apps/api/src/auth` — the **identity provider**. The sixteen tables of
 *   `IDENTITY_SET` are Better Auth's own: the library declares their shapes, writes
 *   them on every sign-in, consent, issue and refresh, and is configured in that one
 *   directory and nowhere else (ADR 0009, lint-enforced). No slice could own them
 *   without owning the library, and inventing an `identity` slice to hold a table
 *   nobody in `core` writes would put a name in the tree that answers no call.
 * - `packages/core/src/store/postgres` — the **Postgres door**. The two counters are
 *   the limiter's own rows, read and written by the door's fixed-window helpers; the
 *   door is explicitly not a slice (ADR 0029), and the alternative — hanging them off
 *   `access`, which imports only `kernel` and touches no store — would be a fiction.
 * - `packages/core/src/store/graph` — the **graph door**: the delta builder and the
 *   traversal templates, the one graph query module in this tier (ADR 0032). It writes
 *   the graph tables inside the governed write's transaction and is not a slice, so its
 *   access to the concepts slice's tables is recorded below rather than owned.
 *
 * **The lint rule this map is the written trigger for** (ADR 0029; out of scope in the
 * T-063 spec, deliberately): *a store file imports no slice's table*. Build it when a
 * store file first reaches for one — the map is where the breach shows up as a diff, and
 * the rule is what stops it being a diff nobody read. The counters above are the door's
 * own rows and are not a slice's table, so they are not the breach.
 */

export const IDENTITY_PROVIDER = "apps/api/src/auth";
export const POSTGRES_DOOR = "packages/core/src/store/postgres";
export const GRAPH_DOOR = "packages/core/src/store/graph";
/**
 * The **knowledge worker** (ADR 0005): the other tier, which shares these stores and no
 * code. It owns no table — the app is the only migration owner (ADR 0007) — and it is
 * named here because a tier that writes a table it does not own is exactly the fact this
 * map exists to record, and no import-direction rule can see across a process boundary.
 */
export const WORKER = "apps/worker";

/**
 * The owners that are not a directory name under `packages/core/src/` and so are written
 * as paths. The owner test admits exactly these and holds each to a directory that
 * exists; every other owner it holds to a directory under `packages/core/src/`.
 */
export const OWNERS_OUTSIDE_CORE = [IDENTITY_PROVIDER, POSTGRES_DOOR, GRAPH_DOOR, WORKER] as const;

/**
 * The owner of every table `src/` declares — written out rather than derived, so a
 * reviewer reads the whole map in one place, exactly as `RLS_EXEMPTIONS` is. The identity
 * set's sixteen rows are the one place that copies another list, and the ownership test
 * holds them equal to `IDENTITY_SET` in both directions so the copy cannot drift.
 */
export const TABLE_OWNERS = {
  // Better Auth's identity set (ADR 0009). Declared here, written by the library.
  "public.user": IDENTITY_PROVIDER,
  "public.session": IDENTITY_PROVIDER,
  "public.account": IDENTITY_PROVIDER,
  "public.verification": IDENTITY_PROVIDER,
  "public.jwks": IDENTITY_PROVIDER,
  "public.workspace": IDENTITY_PROVIDER,
  "public.member": IDENTITY_PROVIDER,
  "public.invitation": IDENTITY_PROVIDER,
  "public.oauth_client": IDENTITY_PROVIDER,
  "public.oauth_resource": IDENTITY_PROVIDER,
  "public.oauth_client_resource": IDENTITY_PROVIDER,
  "public.oauth_refresh_token": IDENTITY_PROVIDER,
  "public.oauth_access_token": IDENTITY_PROVIDER,
  "public.oauth_consent": IDENTITY_PROVIDER,
  "public.oauth_client_assertion": IDENTITY_PROVIDER,
  "public.rate_limit": IDENTITY_PROVIDER,

  // The limiter's own rows, read and written by the door's fixed-window helpers.
  "public.ingress_counter": POSTGRES_DOOR,
  "public.mcp_call_counter": POSTGRES_DOOR,

  // The modules under `packages/core/src/`: three slices, and the two ADR 0029 rule 3
  // names that own a table without being one — `llm` its route table, `audit` the one
  // ledger every slice writes through its doors and none by its own SQL (ADR 0038).
  "public.workspace_config": "workspaces",
  "public.group": "members",
  "public.group_member": "members",
  "public.llm_route": "llm",
  "public.audit_event": "audit",
  "public.access_request": "members",
  "index.chunk": "sources",

  // The concept write path's five (ADRs 0011, 0012, 0019). The governed write writes four of
  // them in the act's own transaction — the identity, the index row, the commit and the
  // evidence — and touches the fifth not at all: `concept_verification` is written by the
  // verify act, which is a later ticket's, and read by this slice's `conceptByIri` for the
  // trust `open` projects. Nothing outside this slice writes any of the five.
  "public.concept_identity": "concepts",
  "public.concept_index": "concepts",
  "public.bundle_commit": "concepts",
  "public.evidence": "concepts",
  "public.concept_verification": "concepts",

  // The worker's queue (ADR 0005: the control plane is rows, never HTTP). The runs slice
  // is the app's side of it — enqueue and the views over what a job found — and the claim
  // protocol itself is SQL functions both tiers call, so the worker writes this table
  // without owning it; the entry below records that.
  "public.job": "runs",

  // The graph (ADR 0023, ADR 0032): the concepts slice's, because the governed write's
  // transaction is where the bundle-and-record delta lands — the act that owns the
  // transaction owns the invariants over these rows. The graph door writes them for it,
  // recorded below.
  "public.graph_generation": "concepts",
  "public.graph_node": "concepts",
  "public.graph_edge": "concepts",

  // The inbox's two (ADRs 0005, 0012). The suggestion is the concepts slice's queue and
  // the write request is its payload — read by the acceptance path and by nothing else,
  // which is why neither runtime role holds `SELECT` on the payload at all and the one
  // definer function that serves it is granted to the app's role alone.
  "public.suggestion": "concepts",
  "public.concept_write_request": "concepts",

  // The visibility derivation's ground (ADR 0013, ADR 0023, ADR 0039): a binding carries the
  // three permission fields a concept's class is derived from, and the document row is the
  // platform-held fact that ties a piece of evidence to the binding that yielded it. Both are
  // the sources slice's; the rest of a binding and of the catalogue is B7's, on these tables.
  "public.source_binding": "sources",
  "public.source_document": "sources",
  // What the redaction seam withheld in one document (ADR 0020): the sources slice's,
  // because the acts over these rows — the review of a finding and the restore of an
  // always-set span — are the slice's own, and the counts a publish dialog reads come off
  // them. The worker inserts them and owns nothing here; the entry below records that.
  "public.finding": "sources",
  // A person's access or erasure request, with the identifier set it is about and the clock
  // it runs on (ADR 0020): the erasure slice's, which sits at the top of the slice graph
  // (ADR 0029 rule 4) and is the only writer — the request is recorded by an act, the map is
  // computed from the set, and the routine writes the answer back on the same row.
  "public.subject_request": "erasure",
  // What the routine did in every store for one of those requests (ADR 0020, amended
  // 2026-09-05): the same slice's, written by the routine under the platform principal and
  // read by the replay a restore runs before the app serves anything.
  "public.erasure_request": "erasure",
  // What one document must keep out the next time it is reprocessed (ADR 0020): the same
  // slice's, written by the routine's step 6. S1's reprocess is handed what to keep out by
  // the app; the worker reads no suppression, which is why there is no entry below.
  "public.suppression": "erasure",
  // Which evidence a concept cites, and a recorded Admin override of its derived class:
  // both written in the concepts slice's own transactions, the first by the governed write
  // and the second by the override act.
  "public.concept_evidence": "concepts",
  "public.concept_class_override": "concepts",
  // A composition and the concepts it includes (ADRs 0004, 0015): the guides slice's, whose
  // recompute derives one's class from its includes and whose footnote read withholds an
  // include through the concept's own predicate. The composition as a product is B8's.
  "public.composition": "guides",
  "public.composition_include": "guides",
} satisfies Record<string, string>;

/** A table the schema package declares: every key of the map, and nothing else. */
export type OwnedTable = keyof typeof TABLE_OWNERS;

/** Every owner the map names, as a union — so a typo in an owner is a type error. */
export type TableOwner = (typeof TABLE_OWNERS)[OwnedTable];

/** A read or a write of a table by anyone but its owner. */
export type CrossOwnerAccess = {
  /** The schema-qualified table, as `TABLE_OWNERS` and `RLS_EXEMPTIONS` name it. */
  readonly table: OwnedTable;
  /**
   * The module doing the reading or writing. Not narrowed to `TableOwner`: a module may
   * read a table without owning one of its own, which is precisely the fact this list
   * exists to record. The ownership test holds the name to a directory either way.
   */
  readonly by: string;
  readonly access: "read" | "write" | "read and write";
  /** Why it is allowed to, in the words a reviewer would want at the diff. */
  readonly reason: string;
};

/**
 * Every read and write of a table by a module that does not own it — the entries the
 * map exists for. Each is a fact about code in the tree today; a fact about code a
 * later ticket writes is a sentence in the docblock above, not an entry here.
 */
export const CROSS_OWNER_TABLE_ACCESS = [
  {
    table: "public.workspace",
    by: "workspaces",
    access: "read and write",
    reason:
      "Provisioning inserts the row and its config in one transaction, and the membership read looks up the workspace's name; Better Auth owns the table as its organisation model, the workspaces slice owns the tenant's lifecycle over it (ADR 0009, ADR 0029).",
  },
  {
    table: "public.member",
    by: "workspaces",
    access: "read and write",
    reason:
      "Provisioning writes the first Admin membership in the same transaction as the workspace, and the slice reads the workspaces one person holds by their person id — the picker's cross-workspace read, which runs before any workspace is known (ADR 0035).",
  },
  {
    table: "public.user",
    by: "workspaces",
    access: "read and write",
    reason:
      "Revoking a person's credentials writes the instant every later claim is refused against, and the membership read looks up the person's name and address for the shell (ADR 0018, ADR 0035).",
  },
  {
    table: "public.session",
    by: "workspaces",
    access: "write",
    reason:
      "Revoking everywhere ends every browser session created before the instant, in the same transaction that wrote it (ADR 0018).",
  },
  {
    table: "public.oauth_refresh_token",
    by: "workspaces",
    access: "write",
    reason:
      "Revocation's two scopes end the refresh tokens minted before the instant — every one of the person's, or only those whose consented workspace is this one (ADR 0035).",
  },
  {
    table: "public.oauth_access_token",
    by: "workspaces",
    access: "write",
    reason: "The same two scopes, so a live access token cannot outlive its refresh row.",
  },
  {
    table: "public.user",
    by: "erasure",
    access: "read and write",
    reason:
      "The routine's step 5 pseudonymises the row on the person's last membership — the address to a tombstone the erasure pseudonym names, the name cleared, the id kept because every ledger row names it (ADR 0020, ADR 0035) — and reads the address off it first, because the two rows deleted below are keyed by address and not by person. The erasure rehearsal's seed writes one row the other way, the synthetic subject a drill erases, under a reserved domain that resolves nowhere (ADR 0022, ADR 0024).",
  },
  {
    table: "public.member",
    by: "erasure",
    access: "write",
    reason:
      "Every erasure request ends this workspace's membership, which is the whole of what the arm for a person who holds another does; the judgement between the two arms is the platform's and is never shown to an Admin (ADR 0035's rejected oracle). The read that makes it is `workspacesHeldBy` through the workspaces slice, recorded above. The erasure rehearsal's seed writes the one membership it later ends, so the drill's subject is held where a real member is (ADR 0022).",
  },
  {
    table: "public.session",
    by: "erasure",
    access: "write",
    reason:
      "A sign-in carries the address it came from and the agent that made it, so the person's sessions go with the identity set on the last membership (ADR 0020).",
  },
  {
    table: "public.verification",
    by: "erasure",
    access: "write",
    reason:
      "A verification row is keyed by the address a code was sent to rather than by person, so it is deleted by the identifier set's addresses and the one the user row still carries — the erasure map's own predicate, which is why it runs before the address is taken away.",
  },
  {
    table: "public.invitation",
    by: "erasure",
    access: "write",
    reason:
      "An invitation names the address it was sent to. Deleted inside the requesting workspace and no other: an invitation another company sent is that company's record to answer for, and the map is fenced the same way.",
  },
  {
    table: "public.account",
    by: "erasure",
    access: "write",
    reason:
      "A linked account is the external identity a sign-in came through — a name for this person at another provider — so it goes with the identity set on the last membership (ADR 0020).",
  },
  {
    table: "public.member",
    by: POSTGRES_DOOR,
    access: "read",
    reason:
      "The Principal resolver reads the member row for (workspace, person) and the membership's revocation instant, in the transaction that sets the scope — so the role is resolved in the same transaction as the read it authorises, which is what makes the door a door (ADR 0018, ADR 0035).",
  },
  {
    table: "public.user",
    by: POSTGRES_DOOR,
    access: "read",
    reason:
      "The same one resolve query joins the person's own revocation instant, so revocation's other scope costs no second round trip on the path every call takes.",
  },
  {
    table: "public.group_member",
    by: POSTGRES_DOOR,
    access: "read",
    reason:
      "The same one resolve query aggregates the caller's group ids into the Principal, because groups are re-read per call rather than carried on a credential (ADR 0009): every visibility check then pays one membership lookup it already has (ADR 0038).",
  },
  {
    table: "public.member",
    by: "members",
    access: "read",
    reason:
      "Adding a person to a group reads whether they are a member of the workspace first, so the act answers `not-a-member` rather than letting the composite foreign key abort the caller's transaction; T-061's request act reads the same row to answer already-a-member neutrally.",
  },
  {
    table: "public.user",
    by: "members",
    access: "read",
    reason:
      "Approving a request reads the requester's address to mint the invitation to it, and the Admin's queue names each requester so a person can be told apart from a person id; both reads are by the requester id already on a row of this workspace's queue.",
  },
  {
    table: "public.user",
    by: "concepts",
    access: "read",
    reason:
      "Accepting an *edit* suggestion commits with the proposer as git author (ADR 0012's 2026-08-27 amendment), and a git author line is a name and an address — which the ledger's `human:<person id>` deliberately is not, so the act reads them off the person the proposer names.",
  },
  {
    table: "public.member",
    by: "concepts",
    access: "read",
    reason:
      "The same read joins the membership: a proposer is a string a producer wrote and `user` is global by design (ADR 0009), so a lookup by id alone would let a compromised producer put any person on the platform into another tenant's commit. Only a member of this workspace can be named as an author.",
  },
  {
    table: "public.invitation",
    by: "members",
    access: "write",
    reason:
      "Approving an access request mints the invitation row directly, in the same transaction as the decision — a direct row write through the identity-write seam, never Better Auth's endpoint path, so T-004's two invitation fences stand until T-027 ships the accept page (ADR 0038).",
  },
  {
    table: "public.graph_generation",
    by: GRAPH_DOOR,
    access: "read and write",
    reason:
      "The delta builder creates the live-generation row on a workspace's first delta and binds it on every write; the traversal templates bind it on every walk, so a rebuild's flip is one row update every read sees at once (ADR 0023, ADR 0032).",
  },
  {
    table: "public.graph_node",
    by: GRAPH_DOOR,
    access: "read and write",
    reason:
      "The delta builder upserts the bundle-and-record nodes inside the governed write's transaction, and the traversal templates read them with the predicate on every element of every path (ADR 0023, ADR 0032).",
  },
  {
    table: "public.graph_edge",
    by: GRAPH_DOOR,
    access: "read and write",
    reason:
      "The delta builder replaces a concept's outgoing edges inside the governed write's transaction, and the traversal templates read them with the predicate on every element of every path (ADR 0023, ADR 0032).",
  },
  {
    table: "public.concept_index",
    by: GRAPH_DOOR,
    access: "read",
    reason:
      "The delta builder resolves a link's target to a concept and reads its kind off the index inside the act's own transaction, and a newly landed concept's linkers are found there — the map is derived from the rows the same transaction just wrote (ADR 0023).",
  },
  {
    table: "public.source_document",
    by: "concepts",
    access: "read",
    reason:
      "The class derivation joins a concept's citations to the documents they locate, to reach the binding each was yielded by — the platform-held fact a producer's citation cannot supply (ADR 0023, ADR 0039).",
  },
  {
    table: "public.source_binding",
    by: "concepts",
    access: "read",
    reason:
      "A concept's class is the most restrictive among the bindings of the evidence it cites and its audience their intersection (ADR 0023, ADR 0039); the evidence pane applies the reader's predicate to the same rows to say which cited evidence they may reach.",
  },
  {
    table: "public.job",
    by: WORKER,
    access: "read and write",
    reason:
      "The worker claims a job, keeps its lease alive and writes what the job found — through the claim/lease/heartbeat SQL functions, which are SECURITY INVOKER, so the worker's own privileges and the transaction's workspace scope are what reach the row (ADR 0005, ADR 0031).",
  },
  {
    table: "public.concept_index",
    by: WORKER,
    access: "read",
    reason:
      "The nightly audit compares its own parse of each file against the row's content hash, and the full rebuild copies the row's identity, kind, status and visibility columns onto the generation it writes rather than re-deriving them (ADR 0023, ADR 0031). The worker never writes this table.",
  },
  {
    table: "public.finding",
    by: WORKER,
    access: "write",
    reason:
      "The detector runs in the worker and the review of what it found is an Admin's act, so the worker records a span it withheld and holds INSERT alone — no SELECT, no UPDATE, no DELETE, each refusal a test of its own (ADR 0020). A worker that could read this table would hold a workspace's map of where its personal data sits; one that could update it could mark a special-category span reviewed. No lint sees across a process boundary, which is why the grant and this entry are both written down.",
  },
  {
    table: "public.graph_generation",
    by: WORKER,
    access: "read and write",
    reason:
      "A full rebuild reads the live generation, writes the next one beside it and flips it with one row update at the end — the one write that makes a rebuilt map visible (ADR 0023).",
  },
  {
    table: "public.graph_node",
    by: WORKER,
    access: "read and write",
    reason:
      "A full rebuild inserts the next generation's nodes. It may not update or delete one, so it can never edit the live generation; sweeping a retired generation is the app's (`graph-sweep`, T-058).",
  },
  {
    table: "public.graph_edge",
    by: WORKER,
    access: "read and write",
    reason:
      "The same, for the edges the rebuild derives from each concept's file — insert only, in the generation it is building.",
  },
  {
    table: "public.concept_index",
    by: "guides",
    access: "read",
    reason:
      "A composition's class is the most restrictive among its includes (ADR 0023), read off the concepts' rows; the footnote read applies the concept's own predicate to every include, so a composition's citation is never a side door to a concept its reader may not see.",
  },
] as const satisfies readonly CrossOwnerAccess[];
