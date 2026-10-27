import type { UNREVIEWED_TIERS } from "@better-answers/schema";

import { isActorId, isPersonActor, type ActorId } from "../kernel/index.ts";
import type { Frontmatter, FrontmatterValue } from "./file.ts";

export { TRUST_TIERS, UNREVIEWED_TIERS } from "@better-answers/schema";

export const TRUST_STATUSES = [
  "current",
  "changed-since-checked",
  "out-of-date",
  "draft",
  "deprecated",
] as const;
export type TrustStatus = (typeof TRUST_STATUSES)[number];

export const TRUST_RIDERS = ["imported", "source-moved-on"] as const;
type TrustRider = (typeof TRUST_RIDERS)[number];

type Verification = {
  readonly verifiedAt: string | null;

  readonly rider: TrustRider | null;
} & (
  | { readonly tier: "human-reviewed"; readonly verifiedBy: string }
  | { readonly tier: (typeof UNREVIEWED_TIERS)[number]; readonly verifiedBy: string | null }
);

export type Trust = Verification & { readonly status: TrustStatus };

export type ConceptVerification = {
  readonly actor: ActorId;
  readonly at: Date;

  readonly contentHash: string | null;

  readonly verifierName: string | null;
};

type Trusted = {
  readonly status: string;
  readonly frontmatter: Frontmatter;
  readonly contentHash: string;
  readonly verification: ConceptVerification | undefined;
};

export type VerificationRow = {
  readonly verified_by: string | null;
  readonly verified_at: Date | null;
  readonly verified_hash: string | null;
  readonly verified_by_name: string | null;
};

export const verificationOf = (row: VerificationRow): ConceptVerification | undefined => {
  if (row.verified_by === null || row.verified_at === null || !isActorId(row.verified_by)) {
    return undefined;
  }
  return {
    actor: row.verified_by,
    at: row.verified_at,
    contentHash: row.verified_hash,
    verifierName: row.verified_by_name,
  };
};

const RIDER_WORDS = {
  imported: " · imported",
  "source-moved-on": " · source moved on",
} satisfies Record<TrustRider, string>;

const STATUS_WORDS = {
  "changed-since-checked": "Changed since verified",
  "out-of-date": "Out of date",
  draft: "Draft",
  deprecated: "Deprecated",
} satisfies Record<Exclude<TrustStatus, "current">, string>;

export const trustWords = (trust: Trust): string =>
  trust.status === "current" ? verificationWords(trust) : STATUS_WORDS[trust.status];

const verificationWords = (trust: Trust): string => {
  const rider = trust.rider === null ? "" : RIDER_WORDS[trust.rider];
  switch (trust.tier) {
    case "human-reviewed":
      return `Verified by ${verifierWords(trust.verifiedBy)}${trust.verifiedAt === null ? "" : ` · ${ukLongDate(trust.verifiedAt)}`}${rider}`;
    case "machine-confirmed":
      return `Verified automatically${rider}`;
    case "unverified":
      return "Unverified";
  }
};

const verifierWords = (verifiedBy: string): string =>
  isActorId(verifiedBy) && isPersonActor(verifiedBy) ? "a former member" : verifiedBy;

export const ukLongDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
};

export const trustOf = (concept: Trusted, now: Date): Trust => ({
  ...trustOfVerification(concept.verification),
  status: trustStatusOf(concept, now),
});

const trustOfVerification = (verification: Trusted["verification"]): Verification =>
  verification === undefined
    ? { tier: "unverified", verifiedBy: null, verifiedAt: null, rider: null }
    : {
        tier: isPersonActor(verification.actor) ? "human-reviewed" : "machine-confirmed",
        verifiedBy: verification.verifierName ?? verification.actor,
        verifiedAt: verification.at.toISOString(),
        rider: verification.contentHash === null ? "imported" : null,
      };

const trustStatusOf = (concept: Trusted, now: Date): TrustStatus => {
  if (concept.status === "deprecated") return "deprecated";
  if (pastShelfLife(concept.frontmatter["stale_after"], now)) return "out-of-date";
  const verifiedHash = concept.verification?.contentHash;
  return verifiedHash != null && verifiedHash !== concept.contentHash
    ? "changed-since-checked"
    : "current";
};

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const OFFSET_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/u;

const utcMidnight = (year: number, month: number, day: number): number | undefined => {
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);

  const same =
    at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
  return same ? at.getTime() : undefined;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const pastShelfLife = (staleAfter: FrontmatterValue | undefined, now: Date): boolean => {
  if (typeof staleAfter !== "string") return false;

  const datetime = OFFSET_DATETIME.exec(staleAfter);
  if (datetime !== null) {
    const day = utcMidnight(Number(datetime[1]), Number(datetime[2]), Number(datetime[3]));
    if (day === undefined) return false;
    const instant = new Date(staleAfter);
    return !Number.isNaN(instant.getTime()) && instant.getTime() < now.getTime();
  }

  const date = CALENDAR_DATE.exec(staleAfter);
  if (date === null) return false;
  const midnight = utcMidnight(Number(date[1]), Number(date[2]), Number(date[3]));

  return midnight !== undefined && midnight + ONE_DAY_MS <= now.getTime();
};
