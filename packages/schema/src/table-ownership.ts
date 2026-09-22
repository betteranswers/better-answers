export const IDENTITY_PROVIDER = "apps/api/src/auth";
export const POSTGRES_DOOR = "packages/core/src/store/postgres";
export const GRAPH_DOOR = "packages/core/src/store/graph";

export const WORKER = "apps/worker";

export const OWNERS_OUTSIDE_CORE = [IDENTITY_PROVIDER, POSTGRES_DOOR, GRAPH_DOOR, WORKER] as const;

export const TABLE_OWNERS = {
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

  "public.ingress_counter": POSTGRES_DOOR,
  "public.mcp_call_counter": POSTGRES_DOOR,

  "public.workspace_config": "workspaces",
  "public.group": "members",
  "public.group_member": "members",
  "public.llm_route": "llm",
  "public.audit_event": "audit",
  "public.access_request": "members",
  "index.chunk": "sources",

  "public.concept_identity": "concepts",
  "public.concept_index": "concepts",
  "public.bundle_commit": "concepts",
  "public.evidence": "concepts",
  "public.concept_verification": "concepts",

  "public.job": "runs",

  "public.graph_generation": "concepts",
  "public.graph_node": "concepts",
  "public.graph_edge": "concepts",

  "public.suggestion": "concepts",
  "public.concept_write_request": "concepts",

  "public.source_binding": "sources",
  "public.source_document": "sources",

  "public.finding": "sources",

  "public.subject_request": "erasure",

  "public.erasure_request": "erasure",

  "public.suppression": "erasure",

  "public.concept_evidence": "concepts",
  "public.concept_class_override": "concepts",

  "public.composition": "guides",
  "public.composition_include": "guides",
} satisfies Record<string, string>;

export type OwnedTable = keyof typeof TABLE_OWNERS;

export type TableOwner = (typeof TABLE_OWNERS)[OwnedTable];

export type CrossOwnerAccess = {
  readonly table: OwnedTable;

  readonly by: string;
  readonly access: "read" | "write" | "read and write";

  readonly reason: string;
};

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
      "Adding a person to a group reads whether they are a member of the workspace first, so the act answers `no-such-member` rather than letting the composite foreign key abort the caller's transaction; T-061's request act reads the same row to answer already-a-member neutrally.",
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
    table: "public.job",
    by: "sources",
    access: "read",
    reason:
      "The publish act reads the status of the binding's latest `index` run, by subject, inside its own transaction: the worker holds SELECT alone on `source_binding`, so the run's own row is the only place the tier doing the work can say where it got to, and only *done* lets a publish through (ADR 0013, amended 2026-09-11). One column of one row, by the statement in `packages/core/src/sources/binding.ts`. The review read's other question of the same table — what the latest finished run found — goes through the runs slice's own door (`latestIndexOutcomeIn`), because an outcome is read through the queue's boundary and a status word is not.",
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
    access: "read and write",
    reason:
      "The detector runs in the worker and the review of what it found is an Admin's act, so the worker records a span it withheld — INSERT on the detector's own columns (migrations 0024, 0032) — and reads back one thing: which spans of a document an Admin restored, through SELECT on the five columns that say which span a row is and on `restored_at`, and on no other column (migration 0041; ADR 0020, amended 2026-09-20). The restored spans are an argument to the one memoised function a run converts through, as a document's suppressions are, so a restore re-reads that one document and the seam leaves the span in the text; the same five columns are the conflict target of the run's insert, which is what keeps a second run from doubling a binding's findings and an Admin's mark on the row it was made on. On that conflict the run refreshes its own reading of the span — category, tier, score and the version pair — through SELECT and UPDATE on exactly those five columns (migration 0042; ADR 0020, amended 2026-09-21), so the review reads the last run and a row whose version pair is not its document's is a span the last run did not raise. No DELETE, no UPDATE of a span or of anything an Admin wrote, and every withheld column a refusal test of its own: a worker that could read a reason would read a sentence an Admin typed about a person, one that could update a review column could mark a special-category span reviewed, and one that could clear a restore could withhold again what an Admin let back. No lint sees across a process boundary, which is why the grant and this entry are both written down.",
  },
  {
    table: "public.suppression",
    by: WORKER,
    access: "read",
    reason:
      "A document's applicable suppressions are an argument to the one memoised function a run converts through, so one person's erasure re-reads the documents that mention them and leaves the rest of the binding answered out of the store; the run gathers the sets inside the transaction its own workspace scope is set in and holds SELECT alone (migration 0038). Carrying them on the job row instead would write an erased person's identifiers into a queue row that outlives the run. The three writing roads stay shut and each is a refusal test of its own (ADR 0020): a tier that could insert could suppress a document nobody asked about, one that could update could empty a set, and one that could delete could put a person's data back into every derived store at the next conversion.",
  },
  {
    table: "index.chunk",
    by: WORKER,
    access: "read and write",
    reason:
      "A run writes the chunk rows it split out of one document's normalised redacted text, rewrites them when the same document is processed again, and deletes the rows of a document that has gone from the source — so the worker holds INSERT, UPDATE and DELETE on the table by name (migration 0037), and SELECT beside them: all three statements a run makes against this table read it — the engine's upsert reads EXCLUDED for every column the pipeline declares, and the engine's delete and the run's last statement each carry a WHERE over the key columns — and PostgreSQL requires SELECT on every column a predicate or an EXCLUDED reference reads, so the read is what the three writes are made of rather than a fourth road. It is deliberate and not a default nobody noticed — ADR 0032's 2026-09-19 amendment records it, the RLS suite pins the four verbs and no other privilege, and the next migration that touches this table's privileges writes the grant out by name. Every row is reached through the policied parent, never through a workspace's partition, which the lifecycle function revokes. The acts over the same rows are the sources slice's: a publish and a narrowing rewrite the visibility copies the run wrote, and the run's last statement re-copies them, so a narrowing that lands mid-run wins (ADR 0013, ADR 0031).",
  },
  {
    table: "public.source_document",
    by: WORKER,
    access: "read and write",
    reason:
      "The catalogue is what a run reconciles: it reads the row to learn which item it is processing and writes back the content hash, the key of the normalised copy it wrote, the redaction version the seam returned, the outcome word and when it last saw the item. SELECT and UPDATE alone (migration 0037) — a document row is created by the act that bound its source and removed by the act that withdraws it, both the app's, so a worker that could insert one could catalogue a document nobody uploaded (ADR 0013, ADR 0020).",
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
