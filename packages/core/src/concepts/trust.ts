import { CONCEPT_DRAFT_STATUS, type UNREVIEWED_TIERS } from "@better-answers/schema";

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

export const VERIFIED_TIERS = ["machine-confirmed", "human-reviewed"] as const;

export type VerificationEvent = {
  readonly tier: (typeof VERIFIED_TIERS)[number];
  readonly actor: ActorId;
  readonly name: string | null;
  readonly at: string;
};

export const verificationEventOf = (verification: ConceptVerification): VerificationEvent => ({
  tier: isPersonActor(verification.actor) ? "human-reviewed" : "machine-confirmed",
  actor: verification.actor,
  name: verification.verifierName,
  at: verification.at.toISOString(),
});

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

export const verifierWords = (verifiedBy: string): string =>
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

const trustOfVerification = (verification: Trusted["verification"]): Verification => {
  if (verification === undefined) {
    return { tier: "unverified", verifiedBy: null, verifiedAt: null, rider: null };
  }
  const { tier, actor, name, at } = verificationEventOf(verification);
  return {
    tier,
    verifiedBy: name ?? actor,
    verifiedAt: at,
    rider: verification.contentHash === null ? "imported" : null,
  };
};

const trustStatusOf = (concept: Trusted, now: Date): TrustStatus => {
  if (concept.status === "deprecated") return "deprecated";
  if (pastShelfLife(concept.frontmatter["stale_after"], now)) return "out-of-date";
  if (concept.status === CONCEPT_DRAFT_STATUS) return "draft";
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

const STATUS_RANK = {
  deprecated: 0,
  "out-of-date": 1,
  draft: 2,
  "changed-since-checked": 3,
  current: 4,
} as const satisfies Record<TrustStatus, number>;

const TIER_RANK = {
  unverified: 0,
  "machine-confirmed": 1,
  "human-reviewed": 2,
} as const satisfies Record<Trust["tier"], number>;

export const standsOn = (trust: Trust, rung: Trust["tier"]): boolean =>
  TIER_RANK[trust.status === "current" ? trust.tier : "unverified"] >= TIER_RANK[rung];

const rankOf = (trust: Trust): number =>
  trust.status === "current"
    ? STATUS_RANK.current + TIER_RANK[trust.tier]
    : STATUS_RANK[trust.status];

/**
 * When two trusts are equally weak, the one verified longest ago sets the trust of prose that cites
 * both.
 */
const weaker = (one: Trust, other: Trust): Trust => {
  const difference = rankOf(one) - rankOf(other);
  if (difference !== 0) return difference < 0 ? one : other;
  return (one.verifiedAt ?? "") <= (other.verifiedAt ?? "") ? one : other;
};

const NOTHING_CITED: Trust = {
  tier: "unverified",
  verifiedBy: null,
  verifiedAt: null,
  rider: null,
  status: "current",
};

/** Prose is as trusted as the least trusted concept it cites, and unverified when it cites none. */
export const weakestTrust = (trusts: readonly Trust[]): Trust =>
  trusts.reduce(weaker, trusts[0] ?? NOTHING_CITED);
