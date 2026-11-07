import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";

const TRUST_WORDS = [
  "verified-by",
  "verified-automatically",
  "unverified",
  "changed-since-verified",
  "out-of-date",
  "draft",
  "deprecated",
] as const;

type TrustWord = (typeof TRUST_WORDS)[number];

type Tone = "verified" | "unverified" | "stale" | "draft";

const MARKS = {
  "verified-by": { lead: "Verified by ", tone: "verified" },
  "verified-automatically": { lead: "Verified automatically", tone: "verified" },
  unverified: { lead: "Unverified", tone: "unverified" },
  "changed-since-verified": { lead: "Changed since verified", tone: "stale" },
  "out-of-date": { lead: "Out of date", tone: "stale" },
  draft: { lead: "Draft", tone: "draft" },
  deprecated: { lead: "Deprecated", tone: "unverified" },
} as const satisfies Record<TrustWord, { readonly lead: string; readonly tone: Tone }>;

const TINTS = {
  verified:
    "border-[var(--trust-verified-border)] bg-[var(--trust-verified-bg)] text-[var(--trust-verified-fg)]",
  unverified:
    "border-[var(--trust-unverified-border)] bg-[var(--trust-unverified-bg)] text-[var(--trust-unverified-fg)]",
  stale:
    "border-[var(--trust-stale-border)] bg-[var(--trust-stale-bg)] text-[var(--trust-stale-fg)]",
  draft:
    "border-[var(--trust-draft-border)] bg-[var(--trust-draft-bg)] text-[var(--trust-draft-fg)]",
} as const satisfies Record<Tone, string>;

const trustWordOf = (words: string): TrustWord | undefined =>
  TRUST_WORDS.find((word) => words.startsWith(MARKS[word].lead));

export function TrustMark(properties: { readonly words: string; readonly className?: string }) {
  const word = trustWordOf(properties.words);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 border px-2 py-0.5 font-medium",
        TINTS[word === undefined ? "unverified" : MARKS[word].tone],
        properties.className,
      )}
    >
      {word === undefined ? null : <Icon name={word} weight="bold" />}
      <span className="min-w-0 wrap-anywhere">{properties.words}</span>
    </span>
  );
}
