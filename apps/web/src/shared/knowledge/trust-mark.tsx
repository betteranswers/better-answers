import { Icon, type IconName } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { dayWords } from "@/shared/words.ts";

import type { Concept } from "./knowledge-reads.ts";

type Trust = Concept["trust"];

type Standing = Pick<Trust, "tier" | "status">;

type Tier = Trust["tier"];

type Status = Trust["status"];

type Tone = "verified" | "unverified" | "stale" | "draft";

type Mark = { readonly tone: Tone; readonly icon: IconName };

const TIER_MARKS = {
  unverified: { tone: "unverified", icon: "unverified" },
  "machine-confirmed": { tone: "verified", icon: "verified-automatically" },
  "human-reviewed": { tone: "verified", icon: "verified-by" },
} as const satisfies Record<Tier, Mark>;

const STATUS_MARKS = {
  "changed-since-checked": { tone: "stale", icon: "changed-since-verified" },
  "out-of-date": { tone: "stale", icon: "out-of-date" },
  draft: { tone: "draft", icon: "draft" },
  deprecated: { tone: "unverified", icon: "deprecated" },
} as const satisfies Record<Exclude<Status, "current">, Mark>;

/** A status other than `current` is the word the reader sees, so it decides the mark before the tier does. */
export const markOf = (trust: Standing): Mark =>
  trust.status === "current" ? TIER_MARKS[trust.tier] : STATUS_MARKS[trust.status];

export const TONE_CLASSES = {
  verified:
    "border-[var(--trust-verified-border)] bg-[var(--trust-verified-bg)] text-[var(--trust-verified-fg)]",
  unverified:
    "border-[var(--trust-unverified-border)] bg-[var(--trust-unverified-bg)] text-[var(--trust-unverified-fg)]",
  stale:
    "border-[var(--trust-stale-border)] bg-[var(--trust-stale-bg)] text-[var(--trust-stale-fg)]",
  draft:
    "border-[var(--trust-draft-border)] bg-[var(--trust-draft-bg)] text-[var(--trust-draft-fg)]",
} as const satisfies Record<Tone, string>;

type TrustMarkProperties = {
  readonly words: string;
  readonly className?: string;
} & (
  | { readonly trust: Standing; readonly dated?: undefined }
  | { readonly trust: Standing & Pick<Trust, "verifiedAt">; readonly dated: true }
);

/** The server's words already carry the date of a person's verification, so only a machine's check needs it. */
const checkedOn = (properties: TrustMarkProperties): string | null => {
  if (properties.dated !== true) return null;
  const { status, tier, verifiedAt } = properties.trust;
  return status === "current" && tier === "machine-confirmed" && verifiedAt !== null
    ? verifiedAt
    : null;
};

export function TrustMark(properties: TrustMarkProperties) {
  const { tone, icon } = markOf(properties.trust);
  const date = checkedOn(properties);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 border px-2 py-0.5 font-medium",
        TONE_CLASSES[tone],
        properties.className,
      )}
    >
      <Icon name={icon} weight="bold" />
      <span className="min-w-0 wrap-anywhere">
        {properties.words}
        {date === null ? null : (
          <>
            {" · "}
            <span className="font-mono">{dayWords(date)}</span>
          </>
        )}
      </span>
    </span>
  );
}
