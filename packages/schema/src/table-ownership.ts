export const IDENTITY_PROVIDER = "apps/api/src/auth";
export const POSTGRES_DOOR = "packages/core/src/store/postgres";
export const MAP_DOOR = "packages/core/src/store/map";

export const MIGRATE_TS_DIRECTORY = "apps/api/src";

export const DEPLOY_SCRIPTS = "deploy";

export const OWNERS_OUTSIDE_CORE = [
  IDENTITY_PROVIDER,
  POSTGRES_DOOR,
  MAP_DOOR,
  MIGRATE_TS_DIRECTORY,
  DEPLOY_SCRIPTS,
] as const;

export const NEVER_AN_OWNER: ReadonlySet<string> = new Set(["kernel", "store"]);

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
  "public.authenticator": IDENTITY_PROVIDER,
  "public.passkey": IDENTITY_PROVIDER,
  "public.passkey_last_use": IDENTITY_PROVIDER,
  "public.recovery_code": IDENTITY_PROVIDER,
  "public.second_factor_throttle": IDENTITY_PROVIDER,

  "public.ingress_counter": POSTGRES_DOOR,
  "public.mcp_call_counter": POSTGRES_DOOR,
  "public.invitation_email_counter": POSTGRES_DOOR,

  "public.contract_stamp": MIGRATE_TS_DIRECTORY,

  "public.sweep_pass": "sweeps",

  "public.backup": DEPLOY_SCRIPTS,

  "public.workspace_config": "workspaces",
  "public.group": "members",
  "public.group_member": "members",
  "public.model_choice": "llm",
  "public.model_key": "llm",
  "public.llm_call": "llm",
  "public.spend_reservation": "llm",
  "public.model_price": "llm",
  "public.decision_threshold": "llm",
  "public.audit_event": "audit",
  "public.identity_audit_event": "audit",
  "public.access_request": "members",
  "public.workspace_last_active": "members",
  "public.test_workspace_mark": "members",
  "index.passage": "sources",

  "public.concept_identity": "concepts",
  "public.concept_index": "concepts",
  "public.bundle_commit": "concepts",
  "public.evidence": "concepts",
  "public.concept_verification": "concepts",

  "public.job": "runs",

  "public.map_generation": "concepts",
  "public.map_node": "concepts",
  "public.map_edge": "concepts",
  "public.map_unresolved_reference": "concepts",

  "public.suggestion": "concepts",
  "public.concept_write_request": "concepts",

  "public.connected_source": "sources",
  "public.source_document": "sources",

  "public.finding": "sources",

  "public.subject_request": "erasure",

  "public.erasure_request": "erasure",

  "public.suppression": "erasure",

  "public.concept_evidence": "concepts",
  "public.concept_sensitivity_override": "concepts",
  "public.concept_owner": "concepts",

  "public.write_up": "guides",
  "public.write_up_include": "guides",
  "public.write_up_version": "guides",
  "public.guide_definition": "guides",
  "public.guide_role": "guides",
  "public.guide_section": "guides",
  "public.guide_expected_fact": "guides",
  "public.guide_definition_version": "guides",

  "public.question_asked": "answering",
  "public.question_content": "answering",
  "public.question_feedback": "answering",
  "public.usage": "answering",
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
      "Provisioning inserts the row and its config in one transaction, and the member read looks up the workspace's name, as the operator's lists of people and workspaces do; Better Auth owns the table as its organisation model, the workspaces slice owns the tenant's lifecycle over it.",
  },
  {
    table: "public.member",
    by: "workspaces",
    access: "read and write",
    reason:
      "Provisioning writes the first Admin member in the same transaction as the workspace, and the slice reads the workspaces one person holds by their person id — the picker's cross-workspace read, which runs before any workspace is known. The operator's lists read every workspace's members: the one cross-workspace read after authentication, admitted to the operator alone.",
  },
  {
    table: "public.user",
    by: "workspaces",
    access: "read and write",
    reason:
      "Ending every sign-in and token a person holds writes the instant every later claim is refused against; the platform writes a person it names before their first sign-in, unverified, and that sign-in finds the row; the person's own action writes their display name under its one rule, and adding a member or provisioning reads it to refuse a person with none; and the member read looks up the person's name and address for the shell, as the operator's list of people does for every person, with their revocation instant.",
  },
  {
    table: "public.session",
    by: POSTGRES_DOOR,
    access: "read",
    reason:
      "The resolver reads the named session's confirmation beside the member and user rows it already reads, so the principal carries how fresh it is: the one rule a high-impact act and an operator's write judge on, and a caller whose claims name no session holds none.",
  },
  {
    table: "public.session",
    by: "workspaces",
    access: "read and write",
    reason:
      "Revoking everywhere ends every browser session created before the instant, in the same transaction that wrote it; a person signs their own sessions out, each ending recorded in the identity set; the person's own read and the operator's inspection of a person name each session's device and when it began, was last extended and ends — never the address one came from.",
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
      "The operator's inspection of a person names the assistant each grant was issued to, by the name its metadata document gave.",
  },
  {
    table: "public.oauth_access_token",
    by: "workspaces",
    access: "write",
    reason: "The same two scopes, so a live access token cannot outlive its refresh row.",
  },
  {
    table: "public.verification",
    by: "workspaces",
    access: "read and write",
    reason:
      "A second factor's confirm parks what it waits on as a row keyed by session or address — an authenticator's secret, a passkey's challenge, the operator's restore code — reads it back while it lives and deletes it once spent, so no code verifies twice.",
  },
  {
    table: "public.passkey",
    by: "workspaces",
    access: "read and write",
    reason:
      "A person names, removes and confirms with their own passkeys here: a confirm advances the passkey's counter, a session's standing and the factor facts read whether the person holds one, and the operator's restore removes all but the one kept.",
  },
  {
    table: "public.passkey_last_use",
    by: "workspaces",
    access: "read and write",
    reason:
      "A confirm by passkey stamps when it was last used, and the list of a person's passkeys reads that stamp beside each one.",
  },
  {
    table: "public.authenticator",
    by: "workspaces",
    access: "read and write",
    reason:
      "Setting up an authenticator writes the person's row and confirming verifies it; a session's standing and the factor facts read whether it is verified, and removing it or the operator's restore deletes it.",
  },
  {
    table: "public.recovery_code",
    by: "workspaces",
    access: "read and write",
    reason:
      "Recovery codes are minted, counted and spent here: a fresh set voids the old one, and spending deletes the one code typed in the transaction that confirms the session.",
  },
  {
    table: "public.second_factor_throttle",
    by: "workspaces",
    access: "read and write",
    reason:
      "Each failed confirm counts against the person and a success clears the count, so the wait a wrong code earns is read and written in the transaction that judged the code.",
  },
  {
    table: "public.identity_audit_event",
    by: "workspaces",
    access: "read",
    reason:
      "The operator's inspection of a person reads the identity set's records of their revocations, and an authenticator's addition is recorded once by reading for the record first; every write goes through the audit slice's face.",
  },
  {
    table: "public.user",
    by: "erasure",
    access: "read and write",
    reason:
      "The routine's step 5 pseudonymises the row on the person's last workspace — the address to a tombstone the erasure pseudonym names, the name cleared, the id kept because every row of a workspace's audit log and of the identity-set audit log names it — and reads the address off it first, because the two rows deleted below are keyed by address and not by person. The erasure rehearsal's seed writes one row the other way, the synthetic subject a drill erases, under a reserved domain that resolves nowhere.",
  },
  {
    table: "public.member",
    by: "erasure",
    access: "read and write",
    reason:
      "Every erasure request ends the person as a member here, which is the whole of what the arm for a person who holds another workspace does; the judgement between the two arms is the platform's and is never shown to an Admin. The read that makes it is `workspacesHeldBy` through the workspaces slice, recorded above. The erasure rehearsal's seed writes the one member it later ends, so the drill's subject is held where a real member is. The erasure map reads the rows first, so an access answer names each one.",
  },
  {
    table: "public.session",
    by: "erasure",
    access: "read and write",
    reason:
      "A sign-in carries the address it came from and the agent that made it, so the person's sessions go with the identity set on the last workspace. The erasure map reads them first, so an access answer names each one, and the verification sweep finds a person's session-keyed rows through them.",
  },
  {
    table: "public.verification",
    by: "erasure",
    access: "read and write",
    reason:
      "A verification row is keyed by the address a code was sent to rather than by person, so it is deleted by the identifier set's addresses and the one the user row still carries — the erasure map's own predicate, which is why it runs before the address is taken away. The erasure map reads the rows first, so an access answer names each one.",
  },
  {
    table: "public.invitation",
    by: "erasure",
    access: "read and write",
    reason:
      "An invitation names the address it was sent to. Deleted inside the requesting workspace and no other: an invitation another company sent is that company's record to answer for, and the map is fenced the same way. The erasure map reads the rows first, so an access answer names each one.",
  },
  {
    table: "public.account",
    by: "erasure",
    access: "write",
    reason:
      "A linked account is the external identity a sign-in came through — a name for this person at another provider — so it goes with the identity set on the last workspace.",
  },
  {
    table: "public.passkey",
    by: "erasure",
    access: "read and write",
    reason:
      "A passkey is the person's own credential, named by them and held for every workspace they belong to, so it goes with the identity set on the last workspace and stays while another workspace needs it. Its last-use row goes with it by the foreign key's cascade. The erasure map reads the rows first, so an access answer names each one.",
  },
  {
    table: "public.passkey_last_use",
    by: "erasure",
    access: "read",
    reason:
      "The erasure map names each passkey's last use beside the passkey, so an access answer covers when the person used it; the delete is the cascade from `passkey`.",
  },
  {
    table: "public.authenticator",
    by: "erasure",
    access: "write",
    reason:
      "An authenticator is the person's own second factor, across every workspace, so it goes with the identity set on the last workspace and stays while another workspace needs it; the user row's flag for it is cleared in the same step.",
  },
  {
    table: "public.recovery_code",
    by: "erasure",
    access: "write",
    reason:
      "The recovery codes stand in for the person's second factor, so they go with it on the last workspace and stay with it otherwise.",
  },
  {
    table: "public.second_factor_throttle",
    by: "erasure",
    access: "read and write",
    reason:
      "A person's failed confirms are a record of their sign-in, kept across every workspace, so they go with the second factor on the last workspace and stay with it otherwise. The erasure map reads the rows first, so an access answer names each one.",
  },
  {
    table: "public.workspace_last_active",
    by: "erasure",
    access: "read and write",
    reason:
      "When the person was last active here is this workspace's record of them, so every erasure from it deletes only that row under the workspace's scope. The erasure map reads it first, so an access answer names it.",
  },
  {
    table: "public.workspace_last_active",
    by: POSTGRES_DOOR,
    access: "read and write",
    reason:
      "The claims resolution reads whether the member's last-active row here is an hour old, in the claims transaction, and stamps it only then, one conditional write in its own short transaction under that workspace's scope, so every door — the tRPC roads and the MCP surface alike — counts a use; a removal or an erasure deletes the row through the members slice that owns it.",
  },
  {
    table: "public.question_asked",
    by: "erasure",
    access: "read and write",
    reason:
      "A record names who asked, so every erasure from the workspace rewrites that id to the erasure pseudonym and keeps the row, which is kept for good. The erasure map reads the records first, so an access answer names each one.",
  },
  {
    table: "public.question_content",
    by: "erasure",
    access: "write",
    reason:
      "The question is the person's own words, so the erasure deletes the content rows of the records it rewrites, ahead of the month's partition being dropped.",
  },
  {
    table: "public.question_feedback",
    by: "erasure",
    access: "write",
    reason:
      "Feedback names who gave it and may carry their note, so the erasure rewrites the id as it does on the record and clears the note and the disputed sentence; the reason and the disputed concept stay.",
  },
  {
    table: "index.passage",
    by: "erasure",
    access: "read",
    reason:
      "A person is found in the documents by searching the live passages for the identifier's words, and a candidate document's passages are read whole, in order, to confirm the match.",
  },
  {
    table: "public.source_document",
    by: "erasure",
    access: "read",
    reason:
      "The passage search keeps to documents that are not gone, and re-deriving after an erasure reads the connected source each matched document came from, so each is reprocessed. The rehearsal finds its seeded document's connected source the same way.",
  },
  {
    table: "public.bundle_commit",
    by: "erasure",
    access: "read",
    reason:
      "The erasure map lists every bundle commit the person is the actor of, so an access answer names each one.",
  },
  {
    table: "public.concept_verification",
    by: "erasure",
    access: "read",
    reason:
      "The erasure map lists every verification the person recorded on a concept, so an access answer names each one.",
  },
  {
    table: "public.concept_sensitivity_override",
    by: "erasure",
    access: "read and write",
    reason:
      "An override names who set it, so the erasure map lists each one the person set and every erasure from the workspace rewrites that id to the erasure pseudonym.",
  },
  {
    table: "public.concept_owner",
    by: "erasure",
    access: "read and write",
    reason:
      "An owner row names the person and nothing else, so the erasure map lists each one naming the person and the member's ending deletes them; the concept falls back to its collection's owner, or to Admins.",
  },
  {
    table: "public.write_up_version",
    by: "erasure",
    access: "read and write",
    reason:
      "A write-up version names who saved it, so the erasure map lists each one the person saved and every erasure from the workspace rewrites that id to the erasure pseudonym through `pseudonymise_record_actors`, keeping the version's text.",
  },
  {
    table: "public.guide_definition_version",
    by: "erasure",
    access: "read and write",
    reason:
      "A guide definition version names who saved it, so the erasure map lists each one the person saved and every erasure from the workspace rewrites that id to the erasure pseudonym through `pseudonymise_record_actors`, keeping the definition.",
  },
  {
    table: "public.usage",
    by: "erasure",
    access: "read and write",
    reason:
      "A usage row names who copied, exported or submitted the work, so the erasure map lists each one the person made and every erasure from the workspace rewrites that id to the erasure pseudonym.",
  },
  {
    table: "public.finding",
    by: "erasure",
    access: "read and write",
    reason:
      "A finding names who reviewed or restored it and keeps the reason they typed, so the erasure map lists each one and every erasure from the workspace rewrites the id to the erasure pseudonym and clears that person's reason: a review reason to NULL, and a restore reason to the empty string, because `finding_restore_check` needs one on a restored finding.",
  },
  {
    table: "public.suggestion",
    by: "erasure",
    access: "read and write",
    reason:
      "A suggestion names who proposed and who decided it and keeps the decider's reason, so the erasure map lists each one the person proposed or decided and every erasure from the workspace rewrites both ids to the erasure pseudonym, through `erase_from_the_suggestions`. That person's reason becomes a fixed sentence, because `suggestion_reason_length_check` refuses an empty one. `erase_from_the_write_requests` returns a waiting suggestion whose request body it had to replace.",
  },
  {
    table: "public.concept_write_request",
    by: "erasure",
    access: "write",
    reason:
      "A write request's title, frontmatter and body can carry the person's actor id or `human:<address>`, so the erasure map lists each request naming them through `concept_write_requests_naming` and every erasure from the workspace rewrites those to the erasure pseudonym through `erase_from_the_write_requests`, as it rewrites the bundle's files.",
  },
  {
    table: "public.concept_index",
    by: "erasure",
    access: "read",
    reason:
      "When the map finds the person named in a concept's file, the routine reads which concepts live at those paths, so it can re-derive each one.",
  },
  {
    table: "public.session",
    by: "sweeps",
    access: "write",
    reason:
      "A session holds the address it came from and the agent that made it, so the daily pass deletes every one past its expiry or its pending hour: nobody signs out of a session they abandoned.",
  },
  {
    table: "public.verification",
    by: "sweeps",
    access: "write",
    reason:
      "The library no longer deletes expired rows at lookup, because that made another person's just-expired code read as wrong, so the daily pass deletes every row a day past its expiry.",
  },
  {
    table: "public.member",
    by: POSTGRES_DOOR,
    access: "read",
    reason:
      "The Principal resolver reads the member row for (workspace, person) and the member's revocation instant, in the transaction that sets the scope — so the role is resolved in the same transaction as the read it authorises, which is what makes the door a door.",
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
      "The same one resolve query aggregates the caller's group ids into the Principal, because groups are re-read per call rather than carried on a credential: every visibility check then pays one member lookup it already has.",
  },
  {
    table: "public.workspace_config",
    by: POSTGRES_DOOR,
    access: "read and write",
    reason:
      "A transport reads one setting of the caller's workspace by key in the transaction the door already scoped, as the MCP surface reads how long a client may keep its tool list; a reservation of spend reads the spending limit held to its commit, so two cannot both pass it; and the platform sets a setting by key, as the ops command sets the spending limit.",
  },
  {
    table: "public.member",
    by: "members",
    access: "read and write",
    reason:
      "Adding a person to a group reads whether they are a member of the workspace first, so the action answers `no-such-member` rather than letting the composite foreign key abort the caller's transaction; the request action reads the same row to answer already-a-member neutrally. An Admin's actions on a member write the row itself — a role change, a removal and the member's revocation instant — and a role change or a removal first holds every Admin row of the workspace, so it never loses its last.",
  },
  {
    table: "public.user",
    by: "members",
    access: "read",
    reason:
      "Approving a request reads the requester's address to mint the invitation to it, and the Admin's queue names each requester so a person can be told apart from a person id; both reads are by the requester id already on a row of this workspace's queue.",
  },
  {
    table: "public.workspace",
    by: "members",
    access: "read",
    reason: "An invitation's email names the workspace it joins.",
  },
  {
    table: "public.user",
    by: "concepts",
    access: "read",
    reason:
      "Accepting an *edit* suggestion commits with the proposer as git author, and a git author line is a name and an address — which the audit log's `human:<person id>` deliberately is not, so the action reads them off the person the proposer names. Collections and owners names each collection's owner, and an owner who is no Admin cannot read the members list, so that read joins the owner's name.",
  },
  {
    table: "public.write_up_include",
    by: "concepts",
    access: "read",
    reason:
      "A direct edit asks once before it commits, and Waiting on you tells an owner before they accept, how many places use the concept an edit would change: the write-ups including it plus the concepts linking to it. A write counts inside its own transaction so it decides on the count it holds, and the waiting list counts in its one statement so a page of suggestions costs one query.",
  },
  {
    table: "public.member",
    by: "concepts",
    access: "read",
    reason:
      "The same read joins the member row: a proposer is a string a producer wrote and `user` is global by design, so a lookup by id alone would let a compromised producer put any person on the platform into another tenant's commit. Only a member of this workspace can be named as an author. Naming an owner reads it too, to refuse a person who is not a member before the owner row's foreign key to it would.",
  },
  {
    table: "public.bundle_commit",
    by: "bundle",
    access: "write",
    reason:
      "Every commit to the knowledge base lands its row in the transaction that holds the commit, whichever slice's write made it, so the slice that owns the write inserts it; the concepts slice keeps the table, because its reconciler reads the rows and a rewritten history moves them.",
  },
  {
    table: "public.user",
    by: "bundle",
    access: "read",
    reason:
      "A write to the knowledge base commits with the running member as git author, and a git author line is a name and an address — which the audit log's `human:<person id>` deliberately is not, so the write reads them off the member's person id.",
  },
  {
    table: "public.member",
    by: "bundle",
    access: "read",
    reason:
      "The same read joins the member row, so only a member of this workspace can sign one of its commits.",
  },
  {
    table: "public.invitation",
    by: "members",
    access: "read and write",
    reason:
      "Approving an access request mints the invitation row directly, in the same transaction as the decision — a direct row write through the identity-write seam, never Better Auth's endpoint path, so the two invitation fences stand until the accept page ships. The slice also lists, counts and accepts the workspace's invitations and reads their statuses, each row under the workspace's scope.",
  },
  {
    table: "public.audit_event",
    by: "members",
    access: "read",
    reason:
      "The audit log's search for a person finds them as an event's actor, its subject or a person its detail names, so a former member is found and an outsider never.",
  },
  {
    table: "public.identity_audit_event",
    by: "members",
    access: "read",
    reason:
      "A name flag is raised in the identity set, which no workspace's audit log holds, so the slice reads whether one still waits for a person and lists for the operator the flags not yet answered.",
  },
  {
    table: "public.connected_source",
    by: "members",
    access: "read",
    reason:
      "The audit log names a connected source an event's detail points at by its name, under the workspace's scope, rather than by an id no Admin can read.",
  },
  {
    table: "public.source_document",
    by: "members",
    access: "read",
    reason:
      "The audit log names a document an event's detail points at by its title, the same way.",
  },
  {
    table: "public.concept_index",
    by: "members",
    access: "read",
    reason: "The audit log names a concept an event's detail points at by its title, the same way.",
  },
  {
    table: "public.map_generation",
    by: MAP_DOOR,
    access: "read and write",
    reason:
      "The delta builder creates the live-generation row on a workspace's first delta and passes it as a parameter on every write; the traversal templates pass it on every walk, so a rebuild's flip is one row update every read sees at once.",
  },
  {
    table: "public.map_node",
    by: MAP_DOOR,
    access: "read and write",
    reason:
      "The delta builder upserts the bundle-and-record nodes inside the governed write's transaction, and the traversal templates read them with the predicate on every element of every path.",
  },
  {
    table: "public.map_edge",
    by: MAP_DOOR,
    access: "read and write",
    reason:
      "The delta builder replaces a concept's outgoing edges inside the governed write's transaction, and the traversal templates read them with the predicate on every element of every path.",
  },
  {
    table: "public.map_unresolved_reference",
    by: MAP_DOOR,
    access: "read and write",
    reason:
      "The delta builder replaces a concept's unresolved path references beside its edges, settles the ones naming the path a concept lands at, and sweeps a retired generation's; the delta and the worker's rebuild are its only writers, and no person reads it.",
  },
  {
    table: "public.concept_index",
    by: MAP_DOOR,
    access: "read",
    reason:
      "The delta builder resolves a link's target to a concept and reads its kind off the index inside the action's own transaction, and the citers waiting on a landed concept's path are read back from it — the map is derived from the rows the same transaction just wrote.",
  },
  {
    table: "public.source_document",
    by: "concepts",
    access: "read",
    reason:
      "The sensitivity derivation joins a concept's citations to the documents they locate, to reach the connected source each was yielded by — the platform-held fact a producer's citation cannot supply.",
  },
  {
    table: "public.connected_source",
    by: "concepts",
    access: "read",
    reason:
      "A concept's sensitivity is the most restrictive among the connected sources of the evidence it cites and its audience their intersection; the evidence pane applies the reader's predicate to the same rows to say which cited evidence they may reach.",
  },
  {
    table: "public.audit_event",
    by: "concepts",
    access: "read",
    reason:
      "A concept the reconciler replayed rests also on that replay's event, which records whether its evidence agreed, so its visibility reads the event through the concept's bundle commit; the sync cascade reads its own followed events to find when it first followed a sync and which syncs and attempts it has already followed, so it follows none twice.",
  },
  {
    table: "public.job",
    by: "sources",
    access: "read",
    reason:
      "The publish action reads the status of the connected source's latest sync, its `index` job by subject, inside its own transaction: the worker holds SELECT alone on `connected_source`, so the sync's own row is the only place the tier doing the work can say where it got to, and only *done* lets a publish through. One column of one row, by the statement in `packages/core/src/sources/publish-connected-source.ts`. The review read's other question of the same table — what the latest finished sync found — goes through the runs slice's own door (`latestIndexOutcomeIn`), because an outcome is read through the queue's boundary and a status word is not.",
  },
  {
    table: "public.audit_event",
    by: "sources",
    access: "read",
    reason:
      "A repeated upload connect answers with what the first one bound rather than streaming a second copy: `FIRST_OUTCOME` in `packages/core/src/sources/connected-source.ts` joins the connected source's document to the audit event the first connect wrote, by subject and action, to hand back that event's id. A read of one row the same action wrote, never a write.",
  },
  {
    table: "public.concept_index",
    by: "guides",
    access: "read",
    reason:
      "A write-up's sensitivity is the most restrictive among its includes, read off the concepts' rows; the footnote read applies the concept's own predicate to every include, so a write-up's citation is never a side door to a concept its reader may not see.",
  },
] as const satisfies readonly CrossOwnerAccess[];
