export const IDENTITY_PROVIDER = "apps/api/src/auth";
export const POSTGRES_DOOR = "packages/core/src/store/postgres";
export const GRAPH_DOOR = "packages/core/src/store/graph";

/**
 * Not `MIGRATOR`: the roles' surface spells the owning database role that way, and this names
 * `migrate.ts`'s directory.
 */
export const JOURNAL_MIGRATOR = "apps/api/src";

export const OWNERS_OUTSIDE_CORE = [
  IDENTITY_PROVIDER,
  POSTGRES_DOOR,
  GRAPH_DOOR,
  JOURNAL_MIGRATOR,
] as const;

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

  "public.contract_stamp": JOURNAL_MIGRATOR,

  "public.sweep_pass": "sweeps",

  "public.workspace_config": "workspaces",
  "public.group": "members",
  "public.group_member": "members",
  "public.llm_route": "llm",
  "public.audit_event": "audit",
  "public.identity_audit_event": "audit",
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
      "Provisioning inserts the row and its config in one transaction, and the membership read looks up the workspace's name, as the operator's lists of people and workspaces do; Better Auth owns the table as its organisation model, the workspaces slice owns the tenant's lifecycle over it.",
  },
  {
    table: "public.member",
    by: "workspaces",
    access: "read and write",
    reason:
      "Provisioning writes the first Admin membership in the same transaction as the workspace, and the slice reads the workspaces one person holds by their person id — the picker's cross-workspace read, which runs before any workspace is known. The operator's lists read every membership: the one cross-workspace read after authentication, admitted to the operator alone.",
  },
  {
    table: "public.user",
    by: "workspaces",
    access: "read and write",
    reason:
      "Revoking a person's credentials writes the instant every later claim is refused against; the person's own act writes their display name under its one rule, and adding a member or provisioning reads it to refuse a person with none; and the membership read looks up the person's name and address for the shell, as the operator's list of people does for every person, with their revocation instant.",
  },
  {
    table: "public.session",
    by: "workspaces",
    access: "read and write",
    reason:
      "Revoking everywhere ends every browser session created before the instant, in the same transaction that wrote it; the operator's inspection of a person reads when each of their sessions began, was last extended and ends.",
  },
  {
    table: "public.oauth_refresh_token",
    by: "workspaces",
    access: "read and write",
    reason:
      "Revocation's two scopes end the refresh tokens minted before the instant — every one of the person's, or only those whose consented workspace is this one. The operator's inspection of a person reads each grant as its line of rotated refresh tokens.",
  },
  {
    table: "public.oauth_client",
    by: "workspaces",
    access: "read",
    reason:
      "The operator's inspection of a person names the client each grant was issued to, by the name its metadata document gave.",
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
      "The routine's step 5 pseudonymises the row on the person's last membership — the address to a tombstone the erasure pseudonym names, the name cleared, the id kept because every row of a workspace's audit log and of the identity-set audit log names it — and reads the address off it first, because the two rows deleted below are keyed by address and not by person. The erasure rehearsal's seed writes one row the other way, the synthetic subject a drill erases, under a reserved domain that resolves nowhere.",
  },
  {
    table: "public.member",
    by: "erasure",
    access: "write",
    reason:
      "Every erasure request ends this workspace's membership, which is the whole of what the arm for a person who holds another does; the judgement between the two arms is the platform's and is never shown to an Admin. The read that makes it is `workspacesHeldBy` through the workspaces slice, recorded above. The erasure rehearsal's seed writes the one membership it later ends, so the drill's subject is held where a real member is.",
  },
  {
    table: "public.session",
    by: "erasure",
    access: "write",
    reason:
      "A sign-in carries the address it came from and the agent that made it, so the person's sessions go with the identity set on the last membership.",
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
      "A linked account is the external identity a sign-in came through — a name for this person at another provider — so it goes with the identity set on the last membership.",
  },
  {
    table: "public.member",
    by: POSTGRES_DOOR,
    access: "read",
    reason:
      "The Principal resolver reads the member row for (workspace, person) and the membership's revocation instant, in the transaction that sets the scope — so the role is resolved in the same transaction as the read it authorises, which is what makes the door a door.",
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
      "The same one resolve query aggregates the caller's group ids into the Principal, because groups are re-read per call rather than carried on a credential: every visibility check then pays one membership lookup it already has.",
  },
  {
    table: "public.member",
    by: "members",
    access: "read and write",
    reason:
      "Adding a person to a group reads whether they are a member of the workspace first, so the act answers `no-such-member` rather than letting the composite foreign key abort the caller's transaction; the request act reads the same row to answer already-a-member neutrally. An Admin's acts on a member write the row itself — a role change, a removal and the membership's revocation instant — and a role change or a removal first holds every Admin row of the workspace, so it never loses its last.",
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
      "Accepting an *edit* suggestion commits with the proposer as git author, and a git author line is a name and an address — which the audit log's `human:<person id>` deliberately is not, so the act reads them off the person the proposer names.",
  },
  {
    table: "public.member",
    by: "concepts",
    access: "read",
    reason:
      "The same read joins the membership: a proposer is a string a producer wrote and `user` is global by design, so a lookup by id alone would let a compromised producer put any person on the platform into another tenant's commit. Only a member of this workspace can be named as an author.",
  },
  {
    table: "public.invitation",
    by: "members",
    access: "write",
    reason:
      "Approving an access request mints the invitation row directly, in the same transaction as the decision — a direct row write through the identity-write seam, never Better Auth's endpoint path, so the two invitation fences stand until the accept page ships.",
  },
  {
    table: "public.graph_generation",
    by: GRAPH_DOOR,
    access: "read and write",
    reason:
      "The delta builder creates the live-generation row on a workspace's first delta and binds it on every write; the traversal templates bind it on every walk, so a rebuild's flip is one row update every read sees at once.",
  },
  {
    table: "public.graph_node",
    by: GRAPH_DOOR,
    access: "read and write",
    reason:
      "The delta builder upserts the bundle-and-record nodes inside the governed write's transaction, and the traversal templates read them with the predicate on every element of every path.",
  },
  {
    table: "public.graph_edge",
    by: GRAPH_DOOR,
    access: "read and write",
    reason:
      "The delta builder replaces a concept's outgoing edges inside the governed write's transaction, and the traversal templates read them with the predicate on every element of every path.",
  },
  {
    table: "public.concept_index",
    by: GRAPH_DOOR,
    access: "read",
    reason:
      "The delta builder resolves a link's target to a concept and reads its kind off the index inside the act's own transaction, and a newly landed concept's linkers are found there — the map is derived from the rows the same transaction just wrote.",
  },
  {
    table: "public.source_document",
    by: "concepts",
    access: "read",
    reason:
      "The class derivation joins a concept's citations to the documents they locate, to reach the binding each was yielded by — the platform-held fact a producer's citation cannot supply.",
  },
  {
    table: "public.source_binding",
    by: "concepts",
    access: "read",
    reason:
      "A concept's class is the most restrictive among the bindings of the evidence it cites and its audience their intersection; the evidence pane applies the reader's predicate to the same rows to say which cited evidence they may reach.",
  },
  {
    table: "public.job",
    by: "sources",
    access: "read",
    reason:
      "The publish act reads the status of the binding's latest `index` run, by subject, inside its own transaction: the worker holds SELECT alone on `source_binding`, so the run's own row is the only place the tier doing the work can say where it got to, and only *done* lets a publish through. One column of one row, by the statement in `packages/core/src/sources/binding.ts`. The review read's other question of the same table — what the latest finished run found — goes through the runs slice's own door (`latestIndexOutcomeIn`), because an outcome is read through the queue's boundary and a status word is not.",
  },
  {
    table: "public.concept_index",
    by: "guides",
    access: "read",
    reason:
      "A composition's class is the most restrictive among its includes, read off the concepts' rows; the footnote read applies the concept's own predicate to every include, so a composition's citation is never a side door to a concept its reader may not see.",
  },
] as const satisfies readonly CrossOwnerAccess[];
