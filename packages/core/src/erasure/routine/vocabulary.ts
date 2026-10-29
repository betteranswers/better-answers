import { processActorId, type Clock, type PlatformPrincipal } from "../../kernel/index.ts";
import type { GitDoor } from "../../store/git/index.ts";
import type { ObjectDoor } from "../../store/objects/index.ts";
import type { PostgresDoor } from "../../store/postgres/index.ts";
import type { ErasureMap } from "../map.ts";
import type { IdentityArm } from "./identity.ts";

const ERASURE_ACTOR = processActorId("erasure");

export type ErasurePrincipal = PlatformPrincipal & {
  readonly actorId: typeof ERASURE_ACTOR;
};

export const ERASURE: ErasurePrincipal = { kind: "platform", actorId: ERASURE_ACTOR };

export type ErasureLogLine = {
  readonly actor: typeof ERASURE_ACTOR;
  readonly erasure_request_id: string;
  readonly arm: IdentityArm;
  readonly pseudonymised: number;
  readonly sessions_deleted: number;
  readonly verifications_deleted: number;
  readonly accounts_deleted: number;
  readonly invitations_deleted_here: number;
  readonly invitations_deleted: number;
  readonly passkeys_deleted: number;
  readonly authenticators_deleted: number;
  readonly recovery_codes_deleted: number;
  readonly confirm_failures_deleted: number;
  readonly last_active_deleted: number;
};

export type QuestionsLogLine = {
  readonly actor: typeof ERASURE_ACTOR;
  readonly erasure_request_id: string;
  readonly records_rewritten: number;
  readonly questions_removed: number;
  readonly feedback_rewritten: number;
};

export type ErasureLog = {
  readonly info: (line: ErasureLogLine | QuestionsLogLine, message: string) => void;
};

export type RunErasureRefusal = "malformed" | "no-such-request" | "not-an-erasure" | "no-address";

export type ErasureRun = {
  readonly workspaceId: string;
  readonly subjectRequestId: string;
  readonly erasureRequestId: string;

  readonly anchoredAt: Date;
  readonly completedAt: Date;
  readonly report: string;

  readonly map: ErasureMap;

  readonly auditEventId: string;
};

export type ErasureDoors = {
  readonly git: GitDoor;
  readonly postgres: PostgresDoor;
  readonly objects: ObjectDoor;
  readonly clock: Clock;
  readonly log: ErasureLog;
};
