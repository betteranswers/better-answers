import { byWords } from "@/shared/words.ts";

import type { DECLARED_ACTS } from "./audit-acts.ts";
import type { ReadAuditEvent } from "./audit-log-api.ts";

export type SaidEvent = Pick<ReadAuditEvent, "act" | "by" | "subject" | "detail">;

type Subject = SaidEvent["subject"];

type Slots = {
  /** Who acted, ready to open a sentence. */
  readonly by: string;
  readonly subject: Subject;
  readonly detail: SaidEvent["detail"];
};

type Sentence = (slots: Slots) => string;

export const sentenceCase = (words: string): string =>
  `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

/** `people.member.role_changed` reads "Member role changed": the act's subject, then its verb. */
export const labelOfAct = (act: string): string => {
  const [, subject = "", verb = ""] = act.split(".");
  return sentenceCase(`${subject} ${verb}`.replaceAll("_", " "));
};

/** A display name is the person's own, so only words the platform supplies take a capital. */
const opening = (by: SaidEvent["by"]): string =>
  by.kind === "person" ? by.displayName : sentenceCase(byWords(by));

/** An act on a person's identity alone names no member, so its subject reads as a person. */
const person = (subject: Subject): string => {
  if (subject?.kind === "person") return subject.displayName;
  return subject?.kind === "former-member" ? "a former member" : "a person";
};

const possessive = (subject: Subject): string => `${person(subject)}'s`;

const group = (subject: Subject): string =>
  subject?.kind === "group" ? `the group ${subject.name}` : "a deleted group";

const groupNow = (subject: Subject): string =>
  subject?.kind === "group" ? `the group now called ${subject.name}` : "a deleted group";

/** An invitation erasure deleted is said without the address it went to. */
const invitation = (subject: Subject): string =>
  subject?.kind === "invitation" ? `an invitation to ${subject.address}` : "an invitation";

const role = (detail: Slots["detail"]): string => {
  const held = detail["role"];
  return typeof held === "string" ? held : "a role";
};

const SENTENCES = {
  "knowledge.check.imported": ({ by }) => `${by} imported a check of a concept`,
  "knowledge.concept.class_overridden": ({ by }) => `${by} overrode a concept's class`,
  "knowledge.concept.committed": ({ by }) => `${by} committed a concept`,
  "knowledge.manifest.written": ({ by }) => `${by} wrote the bundle manifest`,
  "knowledge.suggestion.accepted": ({ by }) => `${by} accepted a suggestion`,
  "knowledge.suggestion.declined": ({ by }) => `${by} declined a suggestion`,
  "knowledge.suggestion.returned": ({ by }) => `${by} returned a suggestion to its proposer`,
  "people.client.consented": ({ by }) => `${by} gave a client access`,
  "people.erasure.completed": ({ by }) => `${by} carried out an erasure request`,
  "people.group.created": ({ by, subject }) => `${by} created ${group(subject)}`,
  "people.group.deleted": ({ by }) => `${by} deleted a group`,
  "people.group.member_added": ({ by, subject }) => `${by} added a member to ${group(subject)}`,
  "people.group.member_removed": ({ by, subject }) =>
    `${by} removed a member from ${group(subject)}`,
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
    `${by} revoked ${possessive(subject)} credentials in this workspace`,
  "people.member.joined": ({ by, detail }) => `${by} joined as ${role(detail)}`,
  "people.member.removed": ({ by, subject }) =>
    `${by} removed ${person(subject)} from the workspace`,
  "people.member.role_changed": ({ by, subject, detail }) =>
    `${by} changed ${possessive(subject)} role to ${role(detail)}`,
  "people.name_flag.raised": ({ by, subject }) =>
    `${by} flagged ${possessive(subject)} display name to the operator`,
  "people.operator.granted": ({ by, subject }) => `${by} made ${person(subject)} the operator`,
  "people.operator.revoked": ({ by, subject }) =>
    `${by} revoked ${possessive(subject)} operator mark`,
  "people.person.added": ({ by, subject }) => `${by} added ${person(subject)} to the platform`,
  "people.person.authenticator_added": ({ by }) => `${by} set up an authenticator`,
  "people.person.authenticator_removed": ({ by }) => `${by} removed their authenticator`,
  "people.person.credentials_revoked": ({ by, subject }) =>
    `${by} revoked ${possessive(subject)} credentials everywhere`,
  "people.person.grants_ended": ({ by, subject }) =>
    `${by} ended ${possessive(subject)} client grants in a workspace`,
  "people.person.name_flagged": ({ by, subject }) =>
    `${by} flagged ${possessive(subject)} display name`,
  "people.person.named": ({ by }) => `${by} gave their display name`,
  "people.person.recovery_code_used": ({ by }) => `${by} used a recovery code`,
  "people.person.recovery_codes_issued": ({ by, detail }) =>
    detail["replaced"] === true
      ? `${by} replaced their recovery codes`
      : `${by} was given recovery codes`,
  "people.person.renamed": ({ by, subject }) =>
    `${by} corrected ${possessive(subject)} display name`,
  "people.person.signed_in": ({ by }) => `${by} signed in`,
  "people.request.approved": ({ by }) => `${by} approved an access request`,
  "people.request.asked": ({ by }) => `${by} asked to join the workspace`,
  "people.request.declined": ({ by }) => `${by} declined an access request`,
  "people.subject_request.received": ({ by }) => `${by} recorded a subject request`,
  "platform.erasure.rehearsed": ({ by }) => `${by} rehearsed an erasure`,
  "platform.erasure.replayed": ({ by }) => `${by} replayed an erasure over a restored copy`,
  "platform.graph.swept": ({ by }) => `${by} swept the graph's older generations`,
  "platform.reconciler.replayed": ({ by }) => `${by} replayed a bundle commit`,
  "platform.workspace.marked": ({ by }) =>
    `${by} kept the workspace's invitations to its testing domain`,
  "platform.workspace.provisioned": ({ by }) => `${by} provisioned the workspace`,
  "platform.workspace.renamed": ({ by }) => `${by} renamed the workspace`,
  "sources.binding.bound": ({ by }) => `${by} bound a source`,
  "sources.binding.narrowed": ({ by }) => `${by} narrowed a binding`,
  "sources.binding.published": ({ by }) => `${by} published a binding`,
  "sources.binding.widened": ({ by }) => `${by} widened a binding`,
  "sources.document.narrowed": ({ by }) => `${by} narrowed a document`,
  "sources.document.special_category_dismissed": ({ by }) =>
    `${by} dismissed a document's findings as not special category`,
  "sources.finding.restored": ({ by }) => `${by} kept a finding in text`,
  "sources.upload.swept": ({ by }) => `${by} swept away an upload no document names`,
} as const satisfies Readonly<Record<(typeof DECLARED_ACTS)[number], Sentence>>;

const SAID: ReadonlyMap<string, Sentence> = new Map(Object.entries(SENTENCES));

/** Each act a sentence says, so a test can hold the list to the acts core declares. */
export const ACTS_SAID: readonly string[] = [...SAID.keys()];

/** An act the web was built before falls back to the act's own name in words. */
export const sentenceOf = (event: SaidEvent): string => {
  const sentence = SAID.get(event.act);
  return sentence === undefined
    ? labelOfAct(event.act)
    : sentence({ by: opening(event.by), subject: event.subject, detail: event.detail });
};
