import { isActorId, isPersonActor, type ActorId } from "../kernel/index.ts";
import type { Frontmatter, FrontmatterValue } from "./file.ts";

export const TRUST_TIERS = ["unverified", "machine-confirmed", "human-reviewed"] as const;
type TrustTier = (typeof TRUST_TIERS)[number];

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

export type Trust = {
  readonly tier: TrustTier;
  readonly status: TrustStatus;

  readonly verifiedBy: string | null;

  readonly verifiedAt: string | null;

  readonly rider: TrustRider | null;
};

export type ConceptVerification = {
  readonly actor: ActorId;
  readonly at: Date;

  readonly contentHash: string | null;

  /** Read by person id, so it stands after the member leaves; null once erasure clears the name. */
  readonly verifierName: string | null;
};

type Trusted = {
  readonly status: string;
  readonly frontmatter: Frontmatter;
  readonly contentHash: string;
  readonly verification: ConceptVerification | undefined;
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

/** `verifiedBy` falls back to the person's actor id once erasure has cleared their name. */
const verifierWords = (verifiedBy: string | null): string => {
  if (verifiedBy === null) return "a person";
  return isActorId(verifiedBy) && isPersonActor(verifiedBy) ? "a former member" : verifiedBy;
};

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

export const trustOf = (concept: Trusted, now: Date): Trust => {
  const { tier, verifiedBy, verifiedAt, rider } = trustOfVerification(concept.verification);
  return { tier, status: trustStatusOf(concept, now), verifiedBy, verifiedAt, rider };
};

const trustOfVerification = (verification: Trusted["verification"]): Omit<Trust, "status"> =>
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

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const OFFSET_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

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
