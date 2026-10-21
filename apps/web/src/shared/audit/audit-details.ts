import type { DECLARED_ACTIONS } from "./audit-actions.ts";
import type { ReadAuditEvent } from "./audit-event.ts";
import { GONE_WORDS, personSaid, removedWords } from "./audit-subjects.ts";

type DeclaredAction = (typeof DECLARED_ACTIONS)[number];

type NamedOrList = ReadAuditEvent["named"][string];

type Named = Exclude<NamedOrList, readonly unknown[]>;

const isList = (named: NamedOrList): named is readonly Named[] => Array.isArray(named);

export const namedIn = (named: ReadAuditEvent["named"], key: string): Named | undefined => {
  const held = named[key];
  return held === undefined || isList(held) ? undefined : held;
};

type DetailValue = ReadAuditEvent["detail"][string];

export type DetailLine = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly address?: string;
};

const NAMED_LABELS = new Map(
  Object.entries({
    userId: "Person",
    personId: "Person",
    requesterId: "Asked by",
    adminUserId: "Admin",
    invitationId: "Invitation",
    replacedByInvitationId: "Replaced by",
    bindingId: "Connected source",
    documentId: "Document",
    iri: "Concept",
    matched: "Search matched",
  }),
);

const VALUE_LABELS = new Map(
  Object.entries({
    role: "Role",
    previousRole: "Role before",
    sensitivity: "Sensitivity",
    fromSensitivity: "Sensitivity before",
    audience: "Audience",
    fromAudience: "Audience before",
    method: "Method",
    by: "Replaced with",
    replaced: "Replaced earlier codes",
    nameChanged: "Name changed",
    slugChanged: "Short name changed",
    corrected: "Testing domain corrected",
    evidenceCount: "Evidence",
    evidenceAgrees: "Evidence agrees",
    findingCount: "Findings",
    lawfulBasisRecorded: "Lawful basis recorded",
    privacyInformationUpdated: "Privacy information updated",
    dpiaReferenced: "DPIA referenced",
    findingsSpecialCategory: "Special category findings",
    findingsBankDetails: "Bank details found",
    findingsGovernmentIdentifier: "Government identifiers found",
    findingsDateOfBirth: "Dates of birth found",
    findingsHomeAddress: "Home addresses found",
    findingsPersonalContact: "Personal contact details found",
    findingsPersonName: "Names of people found",
    findingsJobTitle: "Job titles found",
    identifierCount: "Identifiers",
    locations: "Places erased from",
    tokens: "Tokens",
    fromReplayCopy: "On a restored copy",
    family: "Family",
    eventCount: "Events",
    capped: "Stopped at the limit",
    searchTooBroad: "Search named too many",
    purpose: "Used for",
    provider: "Model provider",
    model: "AI model",
    effectiveFrom: "Priced from",
    gbpPerMillionIn: "£ per million tokens in",
    gbpPerMillionOut: "£ per million tokens out",
    threshold: "Yes at or above",
    grants: "Access ended",
    closedAs: "Closed as",
    sessions: "Sessions signed out",
  }),
);

export const LABELLED_DETAIL_KEYS: readonly string[] = [
  ...NAMED_LABELS.keys(),
  ...VALUE_LABELS.keys(),
];

export const KEPT_OFF_DETAIL_KEYS: Readonly<Partial<Record<DeclaredAction, readonly string[]>>> = {
  "knowledge.check.imported": ["verificationId"],
  "knowledge.concept.committed": ["commitSha", "contentHash"],
  "knowledge.feedback.closed": ["recordId"],
  "knowledge.manifest.written": ["bundleId", "commitSha"],
  "knowledge.suggestion.accepted": ["commitSha", "contentHash", "setId"],
  "knowledge.suggestion.declined": ["setId"],
  "knowledge.suggestion.returned": ["setId"],
  "people.erasure.completed": ["subjectRequestId"],
  "people.name_flag.raised": ["workspaceId"],
  "people.person.authenticator_added": ["authenticatorId"],
  "people.person.authenticator_removed": ["authenticatorId"],
  "people.person.grants_ended": ["workspaceId"],
  "people.person.passkey_added": ["passkeyId"],
  "people.person.passkey_removed": ["passkeyId"],
  "people.person.passkey_renamed": ["passkeyId"],
  "platform.erasure.rehearsed": ["erasureRequestId", "subjectRequestId"],
  "platform.erasure.replayed": ["erasureRequestId", "subjectRequestId"],
  "platform.graph.swept": ["edges", "generation", "nodes"],
  "platform.job.followed": ["attempts", "concepts", "documents", "writeUps"],
  "platform.reconciler.replayed": ["bundleId", "commitSha", "contentHash"],
  "sources.binding.published": ["dpiaHash"],
  "sources.finding.restored": ["findingId"],
};

const VALUE_WORDS: ReadonlyMap<unknown, string> = new Map([
  ["email_code", "Emailed code"],
  ["email_link", "Sign-in link"],
  ["passkey", "Passkey"],
  ["authenticator", "Authenticator"],
  ["everyone", "Everyone in the workspace"],
  ["groups", "Named groups"],
  ["people", "People"],
  ["knowledge", "Knowledge"],
  ["sources", "Sources"],
  ["platform", "Platform"],
  ["anthropic", "Anthropic"],
  ["mistral", "Mistral AI"],
  ["fixed-in-the-knowledge", "Fixed in the knowledge"],
  ["no-fault-in-the-knowledge", "No fault in the knowledge"],
]);

type Said = { readonly value: string; readonly address?: string };

const saidOf = (named: Named): Said => {
  switch (named.kind) {
    case "person":
      return personSaid(named.displayName, named.address);
    case "invitation":
      return { value: named.address };
    case "removed":
      return { value: removedWords(named.of) };
    case "former-member":
    case "deleted-group":
    case "erased-invitation":
      return { value: GONE_WORDS[named.kind] };
    default:
      return { value: named.name };
  }
};

const namedLine = (key: string, label: string, named: NamedOrList): DetailLine =>
  isList(named)
    ? { key, label, value: named.map((one) => saidOf(one).value).join(", ") }
    : { key, label, ...saidOf(named) };

const wordsOfValue = (value: DetailValue): string => {
  if (Array.isArray(value)) {
    const named = value.map(
      (entry) => entry["device"] ?? entry["clientName"] ?? entry["clientId"] ?? "",
    );
    return named.length === 0 ? "none" : named.join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return VALUE_WORDS.get(value) ?? String(value);
};

export const detailLinesOf = (
  event: Pick<ReadAuditEvent, "detail" | "named">,
): readonly DetailLine[] =>
  Object.entries(event.detail).flatMap(([key, value]): DetailLine[] => {
    const named = event.named[key];
    const namedLabel = NAMED_LABELS.get(key);
    if (namedLabel !== undefined)
      return named === undefined ? [] : [namedLine(key, namedLabel, named)];
    const label = VALUE_LABELS.get(key);
    return label === undefined ? [] : [{ key, label, value: wordsOfValue(value) }];
  });
