import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  accessRequest,
  ACCESS_REQUEST_REASON_MAX,
  ACCESS_REQUEST_STATUSES,
} from "../people/access-request-tables.ts";
import { ACTOR_ID as ACTOR_ID_REGEX } from "../people/actor-id.ts";
import { ACTION, auditEvent, FAMILIES, identityAuditEvent } from "../people/audit-tables.ts";
import { EMAIL_ADDRESS } from "../people/email-address.ts";
import { group, GROUP_ORIGINS, groupMember } from "../people/group-tables.ts";
import {
  account,
  authenticator,
  invitation,
  jwks,
  member,
  oauthAccessToken,
  oauthClient,
  oauthClientAssertion,
  oauthClientResource,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
  passkey,
  passkeyLastUse,
  recoveryCode,
  secondFactorThrottle,
  session,
  user,
  verification,
} from "../people/identity-tables.ts";
import { workspaceLastActive } from "../people/last-active-tables.ts";
import { ROLES } from "../people/roles.ts";
import { testWorkspaceMark } from "../people/test-workspace-tables.ts";
import { ULID } from "../ulid.ts";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "./drizzle-zod.ts";
import { workspaceId, groupId } from "./shared.ts";

const userId = (schema: z.ZodString) => schema.regex(ULID).brand<"UserId">();

const identityId = (schema: z.ZodString) => schema.regex(ULID);

const plain = <TTable extends PgTable>(table: TTable) =>
  ({
    table,
    select: createSelectSchema(table),
    insert: createInsertSchema(table),
    update: createUpdateSchema(table),
  }) as const;

const userRefinements = {
  id: userId,
  email: (schema: z.ZodString) => schema.trim().min(1),
};

const userSelect = createSelectSchema(user, userRefinements);
const userInsert = createInsertSchema(user, userRefinements);
const userUpdate = createUpdateSchema(user, userRefinements);

const memberRefinements = {
  id: identityId,
  workspaceId,
  userId,

  role: (schema: z.ZodString) => schema.pipe(z.enum(ROLES)),
};

const memberSelect = createSelectSchema(member, memberRefinements);
const memberInsert = createInsertSchema(member, memberRefinements);
const memberUpdate = createUpdateSchema(member, memberRefinements);

const sessionRefinements = { id: identityId };

const sessionSelect = createSelectSchema(session, sessionRefinements);
const sessionInsert = createInsertSchema(session, sessionRefinements);
const sessionUpdate = createUpdateSchema(session, sessionRefinements);

const invitationRefinements = { id: identityId };

const invitationSelect = createSelectSchema(invitation, invitationRefinements);
const invitationInsert = createInsertSchema(invitation, invitationRefinements);
const invitationUpdate = createUpdateSchema(invitation, invitationRefinements);

const groupRefinements = {
  id: groupId,
  workspaceId,
  name: (schema: z.ZodString) => schema.trim().min(1),

  origin: (schema: z.ZodString) => schema.pipe(z.enum(GROUP_ORIGINS)),
};

const groupSelect = createSelectSchema(group, groupRefinements);
const groupInsert = createInsertSchema(group, groupRefinements);
const groupUpdate = createUpdateSchema(group, groupRefinements);

const groupMemberRefinements = { workspaceId, groupId, userId };

const groupMemberSelect = createSelectSchema(groupMember, groupMemberRefinements);
const groupMemberInsert = createInsertSchema(groupMember, groupMemberRefinements);
const groupMemberUpdate = createUpdateSchema(groupMember, groupMemberRefinements);

const isTestingDomain = (testingDomain: string): boolean =>
  testingDomain === testingDomain.toLowerCase() &&
  EMAIL_ADDRESS.safeParse(`mark@${testingDomain}`).success;

const testWorkspaceMarkRefinements = {
  workspaceId,
  testingDomain: (schema: z.ZodString) => schema.refine(isTestingDomain),
};

const testWorkspaceMarkSelect = createSelectSchema(testWorkspaceMark, testWorkspaceMarkRefinements);
const testWorkspaceMarkInsert = createInsertSchema(testWorkspaceMark, testWorkspaceMarkRefinements);
const testWorkspaceMarkUpdate = createUpdateSchema(testWorkspaceMark, testWorkspaceMarkRefinements);

const detailEntry = z.record(z.string(), z.union([z.string(), z.null()]));

const detail = z.union([
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(detailEntry)])),
  z.null(),
]);

const auditLogRefinements = {
  id: (schema: z.ZodString) => schema.regex(ULID).brand<"AuditEventId">(),
  action: (schema: z.ZodString) =>
    schema
      .regex(ACTION)
      .pipe(z.templateLiteral([z.enum(FAMILIES), ".", z.string(), ".", z.string()])),
  actor: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
  subjectId: (schema: z.ZodString) => schema.trim().min(1),
  detail: (schema: z.ZodType) => schema.pipe(detail),
  batchId: (schema: z.ZodString) => schema.regex(ULID),
};

const auditLogDerivedRefinements = {
  family: (schema: z.ZodString) => schema.pipe(z.enum(FAMILIES)),
  subjectKind: (schema: z.ZodString) => schema.trim().min(1),
};

const auditEventRefinements = { ...auditLogRefinements, workspaceId };

const auditEventSelect = createSelectSchema(auditEvent, {
  ...auditEventRefinements,
  ...auditLogDerivedRefinements,
});
const auditEventInsert = createInsertSchema(auditEvent, auditEventRefinements);
const auditEventUpdate = createUpdateSchema(auditEvent, auditEventRefinements);

const identityAuditEventSelect = createSelectSchema(identityAuditEvent, {
  ...auditLogRefinements,
  ...auditLogDerivedRefinements,
});
const identityAuditEventInsert = createInsertSchema(identityAuditEvent, auditLogRefinements);
const identityAuditEventUpdate = createUpdateSchema(identityAuditEvent, auditLogRefinements);

const accessRequestRefinements = {
  id: (schema: z.ZodString) => schema.regex(ULID).brand<"AccessRequestId">(),
  workspaceId,
  requesterId: userId,
  reason: (schema: z.ZodString) => schema.trim().min(1).max(ACCESS_REQUEST_REASON_MAX),
  status: (schema: z.ZodString) => schema.pipe(z.enum(ACCESS_REQUEST_STATUSES)),
  decidedBy: userId,
  invitationId: identityId,
};

const accessRequestSelect = createSelectSchema(accessRequest, accessRequestRefinements);
const accessRequestInsert = createInsertSchema(accessRequest, accessRequestRefinements);
const accessRequestUpdate = createUpdateSchema(accessRequest, accessRequestRefinements);

export const peopleSchemas = {
  auditEvent: {
    table: auditEvent,
    select: auditEventSelect,
    insert: auditEventInsert,
    update: auditEventUpdate,
  },
  identityAuditEvent: {
    table: identityAuditEvent,
    select: identityAuditEventSelect,
    insert: identityAuditEventInsert,
    update: identityAuditEventUpdate,
  },
  user: { table: user, select: userSelect, insert: userInsert, update: userUpdate },
  member: { table: member, select: memberSelect, insert: memberInsert, update: memberUpdate },
  group: { table: group, select: groupSelect, insert: groupInsert, update: groupUpdate },
  groupMember: {
    table: groupMember,
    select: groupMemberSelect,
    insert: groupMemberInsert,
    update: groupMemberUpdate,
  },
  session: {
    table: session,
    select: sessionSelect,
    insert: sessionInsert,
    update: sessionUpdate,
  },
  account: plain(account),
  verification: plain(verification),
  jwks: plain(jwks),
  invitation: {
    table: invitation,
    select: invitationSelect,
    insert: invitationInsert,
    update: invitationUpdate,
  },
  oauthClient: plain(oauthClient),
  oauthResource: plain(oauthResource),
  oauthClientResource: plain(oauthClientResource),
  oauthRefreshToken: plain(oauthRefreshToken),
  oauthAccessToken: plain(oauthAccessToken),
  oauthConsent: plain(oauthConsent),
  oauthClientAssertion: plain(oauthClientAssertion),
  authenticator: plain(authenticator),
  passkey: plain(passkey),
  passkeyLastUse: plain(passkeyLastUse),
  recoveryCode: plain(recoveryCode),
  secondFactorThrottle: plain(secondFactorThrottle),
  workspaceLastActive: plain(workspaceLastActive),
  testWorkspaceMark: {
    table: testWorkspaceMark,
    select: testWorkspaceMarkSelect,
    insert: testWorkspaceMarkInsert,
    update: testWorkspaceMarkUpdate,
  },
  accessRequest: {
    table: accessRequest,
    select: accessRequestSelect,
    insert: accessRequestInsert,
    update: accessRequestUpdate,
  },
} as const;
