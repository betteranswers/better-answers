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
 * directory. Two owners are not under `packages/core/src/` at all, and each is written
 * as the repository path of the module it is — a form no directory name there can take,
 * so the two kinds can never be confused:
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
 *
 * **What is recorded here in words, because the record cannot hold it.** The both-ways
 * test refuses an entry naming a table `src/` has not declared, and the owner test
 * refuses a name that is not a directory today. So this fact, settled by the T-063 spec,
 * waits for the ticket that declares its table:
 *
 * - The concept, bundle-commit, evidence and verification tables and the two graph
 *   tables — the concepts slice's (ADRs 0011, 0012, 0019, 0023).
 *
 * **The lint rule this map is the written trigger for** (ADR 0029; out of scope in the
 * T-063 spec, deliberately): *a store file imports no slice's table*. Build it when a
 * store file first reaches for one — the map is where the breach shows up as a diff, and
 * the rule is what stops it being a diff nobody read. The counters above are the door's
 * own rows and are not a slice's table, so they are not the breach.
 */

export const IDENTITY_PROVIDER = "apps/api/src/auth";
export const POSTGRES_DOOR = "packages/core/src/store/postgres";

/**
 * The two owners that live outside `packages/core/src/` and so are written as paths. The
 * owner test admits exactly these two and holds each to a directory that exists; every
 * other owner it holds to a directory under `packages/core/src/`.
 */
export const OWNERS_OUTSIDE_CORE = [IDENTITY_PROVIDER, POSTGRES_DOOR] as const;

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
    table: "public.invitation",
    by: "members",
    access: "write",
    reason:
      "Approving an access request mints the invitation row directly, in the same transaction as the decision — a direct row write through the identity-write seam, never Better Auth's endpoint path, so T-004's two invitation fences stand until T-027 ships the accept page (ADR 0038).",
  },
] as const satisfies readonly CrossOwnerAccess[];
