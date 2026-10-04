import { nameOrAddress } from "@/shared/words.ts";

import type { ReadAuditEvent } from "./audit-log-api.ts";

type Named = ReadAuditEvent["named"][string];

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

const THING_WORDS = {
  "connected-source": "a connected source",
  document: "a document",
  concept: "a concept",
} as const;

const GONE_WORDS = {
  "former-member": "a former member",
  "deleted-group": "a deleted group",
  "erased-invitation": "an erased invitation",
} as const;

const namedLine = (key: string, label: string, named: Named): DetailLine => {
  switch (named.kind) {
    case "person": {
      const line = { key, label, value: nameOrAddress(named.displayName, named.address) };
      return named.displayName === "" ? line : { ...line, address: named.address };
    }
    case "invitation":
      return { key, label, value: named.address };
    case "removed":
      return { key, label, value: `${THING_WORDS[named.of]} (removed)` };
    case "former-member":
    case "deleted-group":
    case "erased-invitation":
      return { key, label, value: GONE_WORDS[named.kind] };
    default:
      return { key, label, value: named.name };
  }
};

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
