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
  "public.usage": "usage",
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
      "The workspaces slice may read and write this table because provisioning inserts the row and its config in one transaction, and the member read and the operator's lists of people and workspaces look up a workspace's name. Better Auth owns the table as its organisation model, and this slice owns each tenant's lifecycle.",
  },
  {
    table: "public.member",
    by: "workspaces",
    access: "read and write",
    reason:
      "The workspaces slice may read and write this table because provisioning writes the first Admin member in the same transaction as the workspace, and the workspace picker finds a person's workspaces by person id before any workspace is known. The operator's lists read every workspace's members, which is the only cross-workspace read after authentication and is allowed to the operator alone.",
  },
  {
    table: "public.user",
    by: "workspaces",
    access: "read and write",
    reason:
      "The workspaces slice may read and write this table because it writes the revocation instant that ends every sign-in and token a person holds, creates the row for a person the platform names before their first sign-in, and saves a person's own display name. It reads the table to refuse a new member or a provisioning with no display name, to show a person's name and address in the app shell, and to list every person with their revocation instant for the operator.",
  },
  {
    table: "public.session",
    by: POSTGRES_DOOR,
    access: "read",
    reason:
      "The Postgres store may read this table because the principal resolver reads the named session's confirmation beside the member and user rows, so the principal records how fresh the session is. High-impact actions and operator writes check that freshness, and a caller whose claims name no session has none.",
  },
  {
    table: "public.session",
    by: "workspaces",
    access: "read and write",
    reason:
      "The workspaces slice may read and write this table because revoking everywhere ends every browser session created before the revocation instant, in the same transaction that wrote the instant, and a person can sign out their own sessions, with each ending recorded in the identity audit log. A person's own view and the operator's inspection of a person show each session's device and when it began, was last extended, and ends, but never the address it came from.",
  },
  {
    table: "public.oauth_refresh_token",
    by: "workspaces",
    access: "read and write",
    reason:
      "The workspaces slice may read and write this table because revocation ends the refresh tokens minted before the revocation instant, either all of a person's tokens or only those consented for this workspace. The operator's inspection of a person reads each grant as its chain of rotated refresh tokens.",
  },
  {
    table: "public.oauth_client",
    by: "workspaces",
    access: "read",
    reason:
      "The workspaces slice may read this table because the operator's inspection of a person names the assistant each grant was issued to, using the name from the client's metadata document.",
  },
  {
    table: "public.oauth_access_token",
    by: "workspaces",
    access: "write",
    reason:
      "The workspaces slice may write this table because revocation ends access tokens with the same two scopes as refresh tokens, so a live access token cannot outlive its refresh token.",
  },
  {
    table: "public.verification",
    by: "workspaces",
    access: "read and write",
    reason:
      "The workspaces slice may read and write this table because a second-factor confirm stores what it waits for as a row keyed by session or address (an authenticator's secret, a passkey's challenge, or the operator's restore code), reads it back while it is valid, and deletes it once used, so no code verifies twice.",
  },
  {
    table: "public.passkey",
    by: "workspaces",
    access: "read and write",
    reason:
      "The workspaces slice may read and write this table because a person names, removes, and confirms with their own passkeys here, a confirm advances the passkey's counter, a session's standing and the second-factor facts check whether the person has a passkey, and the operator's restore removes every passkey except the one kept.",
  },
  {
    table: "public.passkey_last_use",
    by: "workspaces",
    access: "read and write",
    reason:
      "The workspaces slice may read and write this table because a confirm by passkey records when the passkey was last used, and the list of a person's passkeys shows that time beside each one.",
  },
  {
    table: "public.authenticator",
    by: "workspaces",
    access: "read and write",
    reason:
      "The workspaces slice may read and write this table because setting up an authenticator writes the person's row and confirming it marks it verified, a session's standing and the second-factor facts check whether it is verified, and removing it or the operator's restore deletes it.",
  },
  {
    table: "public.recovery_code",
    by: "workspaces",
    access: "read and write",
    reason:
      "The workspaces slice may read and write this table because it creates, counts, and spends recovery codes, a new set replaces the old one, and spending a code deletes it in the same transaction that confirms the session.",
  },
  {
    table: "public.second_factor_throttle",
    by: "workspaces",
    access: "read and write",
    reason:
      "The workspaces slice may read and write this table because each failed confirm counts against the person and a success clears the count, so the wait after a wrong code is read and written in the same transaction that checked the code.",
  },
  {
    table: "public.identity_audit_event",
    by: "workspaces",
    access: "read",
    reason:
      "The workspaces slice may read this table because the operator's inspection of a person reads the records of their revocations, and adding an authenticator first checks for an existing record so the addition is recorded once. Every write goes through the audit slice's functions.",
  },
  {
    table: "public.user",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because step 5 of the erasure routine pseudonymises the row on the person's last workspace: it replaces the address with a tombstone that names the erasure pseudonym, clears the name, and keeps the id, which every row of both audit logs names. It reads the address first, because the verification and invitation rows it deletes are keyed by address and not by person. The erasure rehearsal's seed also writes one row for the synthetic subject that a drill erases, under a reserved domain that resolves nowhere.",
  },
  {
    table: "public.member",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because every erasure request ends the person's membership here, and for a person who belongs to another workspace that is all the erasure does. The platform chooses between those two paths by calling `workspacesHeldBy` in the workspaces slice, and never shows that choice to an Admin. The erasure rehearsal's seed writes the one member it later ends, and the erasure map reads the rows first so that the answer to an access request names each one.",
  },
  {
    table: "public.session",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because a session records the address it came from and the agent that made it, so the person's sessions are deleted with the rest of their identity on the last workspace. The erasure map reads them first so that the answer to an access request names each one, and the verification sweep uses them to find the person's session-keyed rows.",
  },
  {
    table: "public.verification",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because a verification row is keyed by the address a code was sent to, not by person, so the erasure deletes rows by the identifier set's addresses and by the address still on the user row. That match is the erasure map's own predicate, so the delete runs before the address is replaced. The erasure map reads the rows first so that the answer to an access request names each one.",
  },
  {
    table: "public.invitation",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because an invitation names the address it was sent to. The erasure deletes invitations only in the requesting workspace, because an invitation another company sent is that company's record, and the erasure map is limited in the same way. The erasure map reads the rows first so that the answer to an access request names each one.",
  },
  {
    table: "public.account",
    by: "erasure",
    access: "write",
    reason:
      "The erasure slice may write this table because a linked account is the external identity a sign-in came through, a name for this person at another provider, so it is deleted with the rest of their identity on the last workspace.",
  },
  {
    table: "public.passkey",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because a passkey is the person's own credential, named by them and used for every workspace they belong to, so it is deleted with their identity on the last workspace and kept while another workspace needs it. The foreign key's cascade deletes its last-use row with it, and the erasure map reads the rows first so that the answer to an access request names each one.",
  },
  {
    table: "public.passkey_last_use",
    by: "erasure",
    access: "read",
    reason:
      "The erasure slice may read this table because the erasure map shows each passkey's last use beside the passkey, so the answer to an access request says when the person used it. The cascade from `passkey` deletes the rows.",
  },
  {
    table: "public.authenticator",
    by: "erasure",
    access: "write",
    reason:
      "The erasure slice may write this table because an authenticator is the person's own second factor for every workspace, so it is deleted with their identity on the last workspace and kept while another workspace needs it. The same step clears the user row's flag for it.",
  },
  {
    table: "public.recovery_code",
    by: "erasure",
    access: "write",
    reason:
      "The erasure slice may write this table because recovery codes stand in for the person's second factor, so they are deleted with it on the last workspace and kept with it otherwise.",
  },
  {
    table: "public.second_factor_throttle",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because a person's failed confirms are a record of their sign-in, kept across every workspace, so they are deleted with the second factor on the last workspace and kept with it otherwise. The erasure map reads the rows first so that the answer to an access request names each one.",
  },
  {
    table: "public.workspace_last_active",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because the person's last-active time here is this workspace's record of them, so every erasure from the workspace deletes only that row, under the workspace's scope. The erasure map reads it first so that the answer to an access request includes it.",
  },
  {
    table: "public.workspace_last_active",
    by: POSTGRES_DOOR,
    access: "read and write",
    reason:
      "The Postgres store may read and write this table because claims resolution checks whether the member's last-active row is an hour old and only then updates it, with one conditional write in its own short transaction under the workspace's scope, so every entry point, including the tRPC routes and the MCP server, counts a use. A removal or an erasure deletes the row through the members slice, which owns the table.",
  },
  {
    table: "public.question_asked",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because a record names who asked, so every erasure from the workspace rewrites that id to the erasure pseudonym and keeps the row, which is never deleted. The erasure map reads the records first so that the answer to an access request names each one.",
  },
  {
    table: "public.question_content",
    by: "erasure",
    access: "write",
    reason:
      "The erasure slice may write this table because a question is the person's own words, so the erasure deletes the content rows of the records it rewrites, before the month's partition is dropped.",
  },
  {
    table: "public.question_feedback",
    by: "erasure",
    access: "write",
    reason:
      "The erasure slice may write this table because feedback names who gave it and may carry their note, so the erasure rewrites the id as it does on the record and clears the note and the disputed sentence, but keeps the reason and the disputed concept.",
  },
  {
    table: "index.passage",
    by: "erasure",
    access: "read",
    reason:
      "The erasure slice may read this table because it finds a person in the documents by searching the live passages for the identifier's words, and then reads a candidate document's passages in full, in order, to confirm the match.",
  },
  {
    table: "public.source_document",
    by: "erasure",
    access: "read",
    reason:
      "The erasure slice may read this table because the passage search skips documents that are gone, and re-deriving after an erasure reads the connected source each matched document came from, so that each document is reprocessed. The rehearsal finds its seeded document's connected source in the same way.",
  },
  {
    table: "public.bundle_commit",
    by: "erasure",
    access: "read",
    reason:
      "The erasure slice may read this table because the erasure map lists every bundle commit the person is the actor of, so that the answer to an access request names each one.",
  },
  {
    table: "public.concept_verification",
    by: "erasure",
    access: "read",
    reason:
      "The erasure slice may read this table because the erasure map lists every verification the person recorded on a concept, so that the answer to an access request names each one.",
  },
  {
    table: "public.concept_sensitivity_override",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because an override names who set it, so the erasure map lists each override the person set, and every erasure from the workspace rewrites that id to the erasure pseudonym.",
  },
  {
    table: "public.concept_owner",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because an owner row names only the person, so the erasure map lists each row that names them, and ending their membership deletes those rows. The concept then falls back to its collection's owner, or to the Admins.",
  },
  {
    table: "public.write_up_version",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because a write-up version names who saved it, so the erasure map lists each version the person saved, and every erasure from the workspace rewrites that id to the erasure pseudonym through `pseudonymise_record_actors` and keeps the version's text.",
  },
  {
    table: "public.guide_definition_version",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because a guide definition version names who saved it, so the erasure map lists each version the person saved, and every erasure from the workspace rewrites that id to the erasure pseudonym through `pseudonymise_record_actors` and keeps the definition.",
  },
  {
    table: "public.usage",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because a usage row names who copied, exported, or submitted the work, so the erasure map lists each row the person made, and every erasure from the workspace rewrites that id to the erasure pseudonym.",
  },
  {
    table: "public.finding",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because a finding names who reviewed or restored it and keeps the reason they typed. The erasure map lists each such finding, and every erasure from the workspace rewrites the id to the erasure pseudonym and clears that person's reason: a review reason becomes NULL, and a restore reason becomes the empty string, because `finding_restore_check` requires one on a restored finding.",
  },
  {
    table: "public.suggestion",
    by: "erasure",
    access: "read and write",
    reason:
      "The erasure slice may read and write this table because a suggestion names who proposed it and who decided it, and keeps the decider's reason. The erasure map lists each suggestion the person proposed or decided, and every erasure from the workspace rewrites both ids to the erasure pseudonym through `erase_from_the_suggestions`. That person's reason becomes a fixed sentence, because `suggestion_reason_length_check` refuses an empty one, and `erase_from_the_write_requests` returns a waiting suggestion whose request body it had to replace.",
  },
  {
    table: "public.concept_write_request",
    by: "erasure",
    access: "write",
    reason:
      "The erasure slice may write this table because a write request's title, frontmatter, and body can carry the person's actor id or `human:<address>`. The erasure map lists each request that names them through `concept_write_requests_naming`, and every erasure from the workspace rewrites those values to the erasure pseudonym through `erase_from_the_write_requests`, as it rewrites the bundle's files.",
  },
  {
    table: "public.concept_index",
    by: "erasure",
    access: "read",
    reason:
      "The erasure slice may read this table because, when the erasure map finds the person named in a concept's file, the routine reads which concepts live at those paths so that it can re-derive each one.",
  },
  {
    table: "public.session",
    by: "sweeps",
    access: "write",
    reason:
      "The sweeps slice may write this table because a session holds the address it came from and the agent that made it, and nobody signs out of a session they abandoned, so the daily pass deletes every session past its expiry or its pending hour.",
  },
  {
    table: "public.verification",
    by: "sweeps",
    access: "write",
    reason:
      "The sweeps slice may write this table because the library no longer deletes expired rows at lookup, since that made another person's just-expired code look wrong, so the daily pass deletes every row that is a day past its expiry.",
  },
  {
    table: "public.member",
    by: POSTGRES_DOOR,
    access: "read",
    reason:
      "The Postgres store may read this table because the principal resolver reads the member row for (workspace, person) and the member's revocation instant in the transaction that sets the scope, so the role is resolved in the same transaction as the read it authorises.",
  },
  {
    table: "public.user",
    by: POSTGRES_DOOR,
    access: "read",
    reason:
      "The Postgres store may read this table because the same resolve query joins the person's own revocation instant, so checking person-wide revocation costs no second round trip on the path every call takes.",
  },
  {
    table: "public.group_member",
    by: POSTGRES_DOOR,
    access: "read",
    reason:
      "The Postgres store may read this table because the same resolve query collects the caller's group ids into the principal, since groups are read again on every call instead of being carried on a credential, so each visibility check uses a member lookup the query already made.",
  },
  {
    table: "public.workspace_config",
    by: POSTGRES_DOOR,
    access: "read and write",
    reason:
      "The Postgres store may read and write this table because a transport reads one setting of the caller's workspace by key in the transaction the store already scoped, as the MCP server reads how long a client may keep its tool list. A spend reservation reads the spending limit and holds it until commit so that two reservations cannot both pass it, and the platform sets a setting by key, as the ops command sets the spending limit.",
  },
  {
    table: "public.member",
    by: "members",
    access: "read and write",
    reason:
      "The members slice may read and write this table because adding a person to a group first checks that they are a member of the workspace, so the action returns `no-such-member` instead of letting the composite foreign key abort the caller's transaction, and an access request reads the same row to answer already-a-member neutrally. An Admin's actions on a member (a role change, a removal, and the member's revocation instant) write the row itself, and a role change or a removal first locks every Admin row of the workspace so that the workspace never loses its last Admin.",
  },
  {
    table: "public.user",
    by: "members",
    access: "read",
    reason:
      "The members slice may read this table because approving an access request reads the requester's address to send the invitation to, and the Admin's queue shows each requester's name so that a person is not shown as a bare person id. Both reads look up a requester id that is already on a row of this workspace's queue.",
  },
  {
    table: "public.workspace",
    by: "members",
    access: "read",
    reason:
      "The members slice may read this table because an invitation's email names the workspace it joins.",
  },
  {
    table: "public.user",
    by: "concepts",
    access: "read",
    reason:
      "The concepts slice may read this table because accepting an *edit* suggestion commits with the proposer as git author, and a git author line needs a name and an address, which the audit log's `human:<person id>` deliberately leaves out, so the action reads them from the person the proposer names. The collections and owners page also shows each collection owner's name, and an owner who is not an Admin cannot read the members list, so that read joins the owner's name.",
  },
  {
    table: "public.write_up_include",
    by: "concepts",
    access: "read",
    reason:
      "The concepts slice may read this table because a direct edit asks once before it commits, and Waiting on you tells an owner before they accept, how many places use the concept the edit would change: the write-ups that include it plus the concepts that link to it. A write counts inside its own transaction so that it decides on the count it holds, and the waiting list counts in one statement so that a page of suggestions costs one query.",
  },
  {
    table: "public.member",
    by: "concepts",
    access: "read",
    reason:
      "The concepts slice may read this table because a proposer is a string a producer wrote and `user` is global by design, so a lookup by id alone would let a compromised producer put any person on the platform into another tenant's commit. Joining the member row means that only a member of this workspace can be named as an author. Naming an owner also reads the member row, to refuse a person who is not a member before the owner row's foreign key does.",
  },
  {
    table: "public.bundle_commit",
    by: "bundle",
    access: "read and write",
    reason:
      "The bundle slice may read and write this table because every commit to the knowledge base writes its row in the transaction that holds the commit, whichever slice made the write, and first checks that the commit it builds on has its row, since a commit on top of one whose rows were lost would stop the reconciler's replay. The concepts slice owns the table, because its reconciler reads the rows and a rewritten history moves them.",
  },
  {
    table: "public.user",
    by: "bundle",
    access: "read",
    reason:
      "The bundle slice may read this table because a write to the knowledge base commits with the running member as git author, and a git author line needs a name and an address, which the audit log's `human:<person id>` deliberately leaves out, so the write reads them from the member's person id.",
  },
  {
    table: "public.member",
    by: "bundle",
    access: "read",
    reason:
      "The bundle slice may read this table because the same read joins the member row, so that only a member of this workspace can sign one of its commits.",
  },
  {
    table: "public.invitation",
    by: "members",
    access: "read and write",
    reason:
      "The members slice may read and write this table because approving an access request writes the invitation row directly, in the same transaction as the decision, and never through Better Auth's endpoint, so the two invitation fences stay in place until the accept page ships. The slice also lists, counts, and accepts the workspace's invitations and reads their statuses, each under the workspace's scope.",
  },
  {
    table: "public.audit_event",
    by: "members",
    access: "read",
    reason:
      "The members slice may read this table because the audit log's search for a person finds them as an event's actor, its subject, or a person its detail names, so it finds a former member but never an outsider.",
  },
  {
    table: "public.identity_audit_event",
    by: "members",
    access: "read",
    reason:
      "The members slice may read this table because a name flag is raised in the identity audit log, which no workspace's audit log holds, so the slice checks whether a flag still waits for a person and lists the unanswered flags for the operator.",
  },
  {
    table: "public.connected_source",
    by: "members",
    access: "read",
    reason:
      "The members slice may read this table because the audit log shows a connected source that an event's detail points at by its name, under the workspace's scope, instead of by an id that no Admin can read.",
  },
  {
    table: "public.source_document",
    by: "members",
    access: "read",
    reason:
      "The members slice may read this table because the audit log shows a document that an event's detail points at by its title, in the same way as a connected source.",
  },
  {
    table: "public.concept_index",
    by: "members",
    access: "read",
    reason:
      "The members slice may read this table because the audit log shows a concept that an event's detail points at by its title, in the same way as a connected source.",
  },
  {
    table: "public.map_generation",
    by: MAP_DOOR,
    access: "read and write",
    reason:
      "The map store may read and write this table because the delta builder creates the live-generation row on a workspace's first delta and passes it as a parameter on every write, and the traversal templates pass it on every walk, so a rebuild switches generation with one row update that every read sees at once.",
  },
  {
    table: "public.map_node",
    by: MAP_DOOR,
    access: "read and write",
    reason:
      "The map store may read and write this table because the delta builder upserts the bundle and record nodes inside the governed write's transaction, and the traversal templates read them with the predicate on every element of every path.",
  },
  {
    table: "public.map_edge",
    by: MAP_DOOR,
    access: "read and write",
    reason:
      "The map store may read and write this table because the delta builder replaces a concept's outgoing edges inside the governed write's transaction, and the traversal templates read them with the predicate on every element of every path.",
  },
  {
    table: "public.map_unresolved_reference",
    by: MAP_DOOR,
    access: "read and write",
    reason:
      "The map store may read and write this table because the delta builder replaces a concept's unresolved path references beside its edges, resolves the ones that name the path where a concept lands, and deletes a retired generation's rows. The delta builder and the worker's rebuild are its only writers, and no person reads it.",
  },
  {
    table: "public.concept_index",
    by: MAP_DOOR,
    access: "read",
    reason:
      "The map store may read this table because the delta builder resolves a link's target to a concept and reads its kind from the index inside the action's own transaction, and reads back the citers that wait on a landed concept's path, so the map is derived from the rows that the same transaction just wrote.",
  },
  {
    table: "public.source_document",
    by: "concepts",
    access: "read",
    reason:
      "The concepts slice may read this table because the sensitivity derivation joins a concept's citations to the documents they point at, to find the connected source that produced each one, which the platform holds and a producer's citation cannot supply.",
  },
  {
    table: "public.connected_source",
    by: "concepts",
    access: "read",
    reason:
      "The concepts slice may read this table because a concept's sensitivity is the most restrictive among the connected sources of the evidence it cites, and its audience is their intersection. The evidence pane applies the reader's predicate to the same rows to show which cited evidence the reader may open.",
  },
  {
    table: "public.audit_event",
    by: "concepts",
    access: "read",
    reason:
      "The concepts slice may read this table because a concept that the reconciler replayed also depends on that replay's event, which records whether its evidence agreed, so the concept's visibility reads the event through its bundle commit. The sync cascade reads its own earlier events to find when it first followed a sync and which syncs and attempts it has already followed, so that it never follows one twice.",
  },
  {
    table: "public.job",
    by: "sources",
    access: "read",
    reason:
      "The sources slice may read this table because the publish action reads the status of the connected source's latest sync, its `index` job by subject, inside its own transaction, and only *done* lets a publish through. The worker holds only SELECT on `connected_source`, so the sync's job row is the only place where the worker can record how far it got. The read is one column of one row, by the statement in `packages/core/src/sources/publish-connected-source.ts`. The review read's other question about this table, what the latest finished sync found, goes through the runs slice's own function (`latestIndexOutcomeIn`), because an outcome is read through the queue's boundary and a status word is not.",
  },
  {
    table: "public.audit_event",
    by: "sources",
    access: "read",
    reason:
      "The sources slice may read this table because a repeated upload connect returns what the first connect bound instead of streaming a second copy. `FIRST_OUTCOME` in `packages/core/src/sources/connected-source.ts` joins the connected source's document to the audit event the first connect wrote, by subject and action, to return that event's id. It reads one row that the same action wrote and never writes.",
  },
  {
    table: "public.concept_index",
    by: "guides",
    access: "read",
    reason:
      "The guides slice may read this table because a write-up's sensitivity is the most restrictive among its includes, read from the concepts' rows, and the footnote read applies each included concept's own predicate, so that a write-up's citation never exposes a concept its reader may not see.",
  },
  {
    table: "public.usage",
    by: "concepts",
    access: "read",
    reason:
      "The concepts slice may read this table because the records export lists, in one statement, every use of a concept or a write-up that the Admin may read, so a large workspace's uses cost one query. Writing a use stays with the usage slice's `recordUsage`.",
  },
  {
    table: "public.write_up",
    by: "concepts",
    access: "read",
    reason:
      "The concepts slice may read this table because the records export keeps a use of a write-up only when the Admin may read that write-up, so its one statement applies the read predicate to the write-up's own row.",
  },
] as const satisfies readonly CrossOwnerAccess[];
