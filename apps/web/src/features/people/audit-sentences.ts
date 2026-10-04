import { byWords, counted, nameOrAddress } from "@/shared/words.ts";

import type { DECLARED_ACTS } from "./audit-acts.ts";
import { namedIn } from "./audit-details.ts";
import type { ReadAuditEvent } from "./audit-log-api.ts";
import { GONE_WORDS, removedWords, THING_NOUNS, type Thing } from "./audit-subjects.ts";

export type SaidEvent = Pick<ReadAuditEvent, "act" | "by" | "subject" | "detail" | "named">;

type Subject = SaidEvent["subject"];

type Slots = {
  /** Who acted, ready to open a sentence. */
  readonly by: string;
  readonly subject: Subject;
  readonly detail: SaidEvent["detail"];
  readonly named: SaidEvent["named"];
};

type Sentence = (slots: Slots) => string;

type DeclaredAct = (typeof DECLARED_ACTS)[number];

const sentenceCase = (words: string): string => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

/** `people.member.role_changed` reads "Member role changed": the action's subject, then its verb. */
const wordsOfName = (act: string): string => {
  const [, subject = "", verb = ""] = act.split(".");
  return sentenceCase(`${subject} ${verb}`.replaceAll("_", " "));
};

/** A display name is the person's own, so only words the platform supplies take a capital. */
const opening = (by: SaidEvent["by"]): string =>
  by.kind === "person" ? nameOrAddress(by.displayName, by.address) : sentenceCase(byWords(by));

/** An action on a person's identity alone names no member, so its subject reads as a person. */
const person = (subject: Subject | undefined): string => {
  if (subject?.kind === "person") return nameOrAddress(subject.displayName, subject.address);
  return subject?.kind === "former-member" ? GONE_WORDS["former-member"] : "a person";
};

const possessive = (subject: Subject | undefined): string => `${person(subject)}'s`;

const group = (subject: Subject): string =>
  subject?.kind === "group" ? `the group ${subject.name}` : GONE_WORDS["deleted-group"];

const groupNow = (subject: Subject): string =>
  subject?.kind === "group" ? `the group now called ${subject.name}` : GONE_WORDS["deleted-group"];

/** An invitation erasure deleted is said without the address it went to. */
const invitation = (subject: Subject): string =>
  subject?.kind === "invitation" ? `an invitation to ${subject.address}` : "an invitation";

/** Named as it stands now, or by its kind alone once it is removed. */
const thing = (kind: Thing) => {
  const noun = THING_NOUNS[kind];
  return (subject: Subject | undefined): string => {
    if (subject?.kind === kind) return `the ${noun} ${subject.name}`;
    return subject?.kind === "removed" ? removedWords(subject.of) : `a ${noun}`;
  };
};

const connectedSourceNamed = thing("connected-source");

const documentNamed = thing("document");

const conceptNamed = thing("concept");

const role = (detail: Slots["detail"]): string => {
  const held = detail["role"];
  return typeof held === "string" ? held : "a role";
};

const FACTOR_WORDS: ReadonlyMap<unknown, string> = new Map([
  ["passkey", "a passkey"],
  ["authenticator", "an authenticator"],
]);

const factorIn = (detail: Slots["detail"], field: string): string =>
  FACTOR_WORDS.get(detail[field]) ?? "a second factor";

const exported = (detail: Slots["detail"]): string => {
  const count = detail["eventCount"];
  return typeof count === "number" ? counted(count, "event", "events") : "events";
};

const SENTENCES = {
  "knowledge.check.imported": ({ by, named }) =>
    `${by} imported a verification of ${conceptNamed(namedIn(named, "iri"))}`,
  "knowledge.concept.class_overridden": ({ by, subject }) =>
    `${by} overrode the sensitivity of ${conceptNamed(subject)}`,
  "knowledge.concept.committed": ({ by, subject }) => `${by} saved ${conceptNamed(subject)}`,
  "knowledge.manifest.written": ({ by }) => `${by} updated the knowledge base's description`,
  "knowledge.suggestion.accepted": ({ by, named }) =>
    `${by} accepted a suggestion, saved as ${conceptNamed(namedIn(named, "iri"))}`,
  "knowledge.suggestion.declined": ({ by }) => `${by} declined a suggestion`,
  "knowledge.suggestion.returned": ({ by }) => `${by} sent a suggestion back to whoever made it`,
  "people.client.consented": ({ by }) => `${by} gave an assistant access`,
  "people.erasure.completed": ({ by }) => `${by} carried out an erasure request`,
  "people.group.created": ({ by, subject }) => `${by} created ${group(subject)}`,
  "people.group.deleted": ({ by }) => `${by} deleted a group`,
  "people.group.member_added": ({ by, subject, named }) =>
    `${by} added ${person(namedIn(named, "userId"))} to ${group(subject)}`,
  "people.group.member_removed": ({ by, subject, named }) =>
    `${by} removed ${person(namedIn(named, "userId"))} from ${group(subject)}`,
  "people.group.renamed": ({ by, subject }) => `${by} renamed ${groupNow(subject)}`,
  "people.invitation.cancelled": ({ by, subject, detail }) =>
    detail["replacedByInvitationId"] === undefined
      ? `${by} cancelled ${invitation(subject)}`
      : `${by} replaced ${invitation(subject)} with a new one`,
  "people.invitation.created": ({ by, subject, detail }) =>
    `${by} sent ${invitation(subject)} as ${role(detail)}`,
  "people.invitation.resent": ({ by, subject }) => `${by} resent ${invitation(subject)}`,
  "people.member.added": ({ by, subject, detail }) =>
    `${by} added ${person(subject)} as ${role(detail)}`,
  "people.member.credentials_revoked": ({ by, subject }) =>
    `${by} ended every sign-in and token ${person(subject)} held in this workspace`,
  "people.member.joined": ({ by, detail }) => `${by} joined as ${role(detail)}`,
  "people.member.removed": ({ by, subject }) =>
    `${by} removed ${person(subject)} from the workspace`,
  "people.member.role_changed": ({ by, subject, detail }) =>
    `${by} changed ${possessive(subject)} role to ${role(detail)}`,
  "people.name_flag.raised": ({ by, subject }) =>
    `${by} flagged ${possessive(subject)} display name to better-answers support`,
  "people.operator.granted": ({ by, subject }) =>
    `${by} made ${person(subject)} better-answers support`,
  "people.operator.revoked": ({ by, subject }) =>
    `${by} took ${person(subject)} off better-answers support`,
  "people.person.added": ({ by, subject }) => `${by} added ${person(subject)} to better-answers`,
  "people.person.authenticator_added": ({ by }) => `${by} set up an authenticator`,
  "people.person.authenticator_removed": ({ by }) => `${by} removed their authenticator`,
  "people.person.credentials_revoked": ({ by, subject }) =>
    `${by} ended every sign-in and token ${person(subject)} held, everywhere`,
  "people.person.factors_replaced": ({ by, detail }) =>
    `${by} replaced their second factors with ${factorIn(detail, "by")}`,
  "people.person.grants_ended": ({ by, subject }) =>
    `${by} ended the access ${person(subject)} gave assistants in a workspace`,
  "people.person.name_flagged": ({ by, subject }) =>
    `${by} flagged ${possessive(subject)} display name`,
  "people.person.named": ({ by }) => `${by} gave their display name`,
  "people.person.passkey_added": ({ by }) => `${by} added a passkey`,
  "people.person.passkey_removed": ({ by }) => `${by} removed a passkey`,
  "people.person.passkey_renamed": ({ by }) => `${by} renamed a passkey`,
  "people.person.recovery_code_used": ({ by }) => `${by} used a recovery code`,
  "people.person.recovery_codes_issued": ({ by, detail }) =>
    detail["replaced"] === true
      ? `${by} replaced their recovery codes`
      : `${by} was given recovery codes`,
  "people.person.renamed": ({ by, subject }) =>
    `${by} corrected ${possessive(subject)} display name`,
  "people.person.restore_code_accepted": ({ by }) =>
    `${by} used a restore code from better-answers support`,
  "people.person.second_factor_confirmed": ({ by, detail }) =>
    `${by} confirmed their second factor with ${factorIn(detail, "method")}`,
  "people.person.sign_in_restored": ({ by, subject }) =>
    `${by} restored ${possessive(subject)} sign-in`,
  "people.person.signed_in": ({ by }) => `${by} signed in`,
  "people.request.approved": ({ by, named }) =>
    `${by} approved ${possessive(namedIn(named, "requesterId"))} access request`,
  "people.request.asked": ({ by }) => `${by} asked to join the workspace`,
  "people.request.declined": ({ by, named }) =>
    `${by} declined ${possessive(namedIn(named, "requesterId"))} access request`,
  "people.subject_request.received": ({ by }) => `${by} recorded a subject request`,
  "platform.audit_log.exported": ({ by, detail }) =>
    `${by} exported ${exported(detail)} from the audit log`,
  "platform.erasure.rehearsed": ({ by }) => `${by} tested an erasure on a test copy`,
  "platform.erasure.replayed": ({ by }) => `${by} re-applied an erasure to a restored backup`,
  "platform.graph.swept": ({ by }) => `${by} cleared older copies of the map`,
  "platform.reconciler.replayed": ({ by }) => `${by} re-applied a change to the knowledge base`,
  "platform.workspace.marked": ({ by }) =>
    `${by} kept the workspace's invitations to its testing domain`,
  "platform.workspace.provisioned": ({ by }) => `${by} provisioned the workspace`,
  "platform.workspace.renamed": ({ by }) => `${by} renamed the workspace`,
  "sources.binding.bound": ({ by, subject }) => `${by} added ${connectedSourceNamed(subject)}`,
  "sources.binding.narrowed": ({ by, subject }) =>
    `${by} narrowed ${connectedSourceNamed(subject)}`,
  "sources.binding.published": ({ by, subject }) =>
    `${by} published ${connectedSourceNamed(subject)}`,
  "sources.binding.widened": ({ by, subject }) => `${by} widened ${connectedSourceNamed(subject)}`,
  "sources.document.narrowed": ({ by, subject }) => `${by} narrowed ${documentNamed(subject)}`,
  "sources.document.special_category_dismissed": ({ by, subject }) =>
    `${by} dismissed the findings in ${documentNamed(subject)} as not special category`,
  "sources.finding.restored": ({ by }) => `${by} kept a finding in text`,
  "sources.upload.swept": ({ by }) => `${by} deleted an uploaded file no document uses`,
} as const satisfies Readonly<Record<DeclaredAct, Sentence>>;

/** A few words for an action, where a sentence is too long: a control's name, a column. */
const HEADLINES = {
  "knowledge.check.imported": "Verification imported",
  "knowledge.concept.class_overridden": "Sensitivity overridden",
  "knowledge.concept.committed": "Concept saved",
  "knowledge.manifest.written": "Knowledge base description updated",
  "knowledge.suggestion.accepted": "Suggestion accepted",
  "knowledge.suggestion.declined": "Suggestion declined",
  "knowledge.suggestion.returned": "Suggestion sent back",
  "people.client.consented": "Assistant given access",
  "people.erasure.completed": "Erasure request carried out",
  "people.group.created": "Group created",
  "people.group.deleted": "Group deleted",
  "people.group.member_added": "Added to a group",
  "people.group.member_removed": "Removed from a group",
  "people.group.renamed": "Group renamed",
  "people.invitation.cancelled": "Invitation cancelled",
  "people.invitation.created": "Invitation sent",
  "people.invitation.resent": "Invitation resent",
  "people.member.added": "Member added",
  "people.member.credentials_revoked": "Every sign-in and token ended here",
  "people.member.joined": "Member joined",
  "people.member.removed": "Member removed",
  "people.member.role_changed": "Role changed",
  "people.name_flag.raised": "Display name flagged to support",
  "people.operator.granted": "Made better-answers support",
  "people.operator.revoked": "Taken off better-answers support",
  "people.person.added": "Person added",
  "people.person.authenticator_added": "Authenticator set up",
  "people.person.authenticator_removed": "Authenticator removed",
  "people.person.credentials_revoked": "Every sign-in and token ended everywhere",
  "people.person.factors_replaced": "Second factors replaced",
  "people.person.grants_ended": "Assistant access ended",
  "people.person.name_flagged": "Display name flagged",
  "people.person.named": "Display name given",
  "people.person.passkey_added": "Passkey added",
  "people.person.passkey_removed": "Passkey removed",
  "people.person.passkey_renamed": "Passkey renamed",
  "people.person.recovery_code_used": "Recovery code used",
  "people.person.recovery_codes_issued": "Recovery codes given",
  "people.person.renamed": "Display name corrected",
  "people.person.restore_code_accepted": "Restore code used",
  "people.person.second_factor_confirmed": "Second factor confirmed",
  "people.person.sign_in_restored": "Sign-in restored",
  "people.person.signed_in": "Signed in",
  "people.request.approved": "Access request approved",
  "people.request.asked": "Access requested",
  "people.request.declined": "Access request declined",
  "people.subject_request.received": "Subject request recorded",
  "platform.audit_log.exported": "Audit log exported",
  "platform.erasure.rehearsed": "Erasure tested",
  "platform.erasure.replayed": "Erasure re-applied",
  "platform.graph.swept": "Older map copies cleared",
  "platform.reconciler.replayed": "Change re-applied",
  "platform.workspace.marked": "Invitations kept to the testing domain",
  "platform.workspace.provisioned": "Workspace provisioned",
  "platform.workspace.renamed": "Workspace renamed",
  "sources.binding.bound": "Connected source added",
  "sources.binding.narrowed": "Connected source narrowed",
  "sources.binding.published": "Connected source published",
  "sources.binding.widened": "Connected source widened",
  "sources.document.narrowed": "Document narrowed",
  "sources.document.special_category_dismissed": "Findings dismissed",
  "sources.finding.restored": "Finding kept in text",
  "sources.upload.swept": "Unused upload deleted",
} as const satisfies Readonly<Record<DeclaredAct, string>>;

const SAID: ReadonlyMap<string, Sentence> = new Map(Object.entries(SENTENCES));

const HEADED: ReadonlyMap<string, string> = new Map(Object.entries(HEADLINES));

/** Each action a sentence says, so a test can hold the list to the actions core declares. */
export const ACTS_SAID: readonly string[] = [...SAID.keys()];

export const ACTS_HEADED: readonly string[] = [...HEADED.keys()];

/** An action the web was built before falls back to its stored name in words. */
export const headlineOf = (act: string): string => HEADED.get(act) ?? wordsOfName(act);

export const sentenceOf = (event: SaidEvent): string => {
  const sentence = SAID.get(event.act);
  return sentence === undefined
    ? wordsOfName(event.act)
    : sentence({
        by: opening(event.by),
        subject: event.subject,
        detail: event.detail,
        named: event.named,
      });
};
