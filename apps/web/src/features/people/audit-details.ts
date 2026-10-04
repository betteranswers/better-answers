import type { ReadAuditEvent } from "./audit-log-api.ts";
import { GONE_WORDS, personSaid, removedWords } from "./audit-subjects.ts";

type NamedOrList = ReadAuditEvent["named"][string];

type Named = Exclude<NamedOrList, readonly unknown[]>;

const isList = (named: NamedOrList): named is readonly Named[] => Array.isArray(named);

/** One thing a detail key names; a key naming a list names no one thing. */
export const namedIn = (named: ReadAuditEvent["named"], key: string): Named | undefined => {
  const held = named[key];
  return held === undefined || isList(held) ? undefined : held;
};

type DetailValue = ReadAuditEvent["detail"][string];

/** One line of an event's detail: its label, the value in words, and an address to show beneath. */
export type DetailLine = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly address?: string;
};

/** Stored keys holding an id, which the read names; one it could not name is left off. */
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

/** Stored keys, as the register pins them; a key listed nowhere is left off the page. */
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
    grants: "Access ended",
  }),
);

/** Stored values a reader would not say: a sign-in method, an audience, a family. */
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

/** A list, such as an export's matches, reads as its names alone. */
const namedLine = (key: string, label: string, named: NamedOrList): DetailLine =>
  isList(named)
    ? { key, label, value: named.map((one) => saidOf(one).value).join(", ") }
    : { key, label, ...saidOf(named) };

/** A list is the assistant access an action ended, each named by its assistant. */
const wordsOfValue = (value: DetailValue): string => {
  if (Array.isArray(value)) {
    const assistants = value.map((grant) => grant["clientName"] ?? grant["clientId"] ?? "");
    return assistants.length === 0 ? "none" : assistants.join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return VALUE_WORDS.get(value) ?? String(value);
};

/** An id is said by what it names, never as itself, and a key with no word is left off. */
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
