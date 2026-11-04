import { z } from "zod";

import { byCodeUnit } from "@better-answers/schema/code-unit";

const findingSchema = z.object({
  priority: z.string(),
  file: z.string(),
  line: z
    .number()
    .nullish()
    .transform((line) => line ?? undefined),
  title: z.string(),
  description: z
    .string()
    .nullish()
    .transform((text) => text ?? ""),
});

const outputSchema = z.object({
  issues: z.array(findingSchema),
  error: z.string().optional(),
  repository_context: z.object({ status: z.string(), reason: z.string().nullish() }).optional(),
});

type Finding = z.infer<typeof findingSchema>;

export type Cause =
  | "no-credential"
  | "subscription"
  | "rate-limit"
  | "cli-absent"
  | "not-ready"
  | "failed";

export type Review =
  | { readonly kind: "clean"; readonly contextNote: string | undefined }
  | {
      readonly kind: "findings";
      readonly issues: readonly Finding[];
      readonly contextNote: string | undefined;
    }
  | { readonly kind: "could-not-run"; readonly cause: Cause; readonly reason: string };

/** What `spawnSync` returned, with the error reduced to its errno code. */
export type CliRun = {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
  readonly spawnError: string | undefined;
};

export type Tree = {
  readonly head: string;
  readonly dirty: boolean;
};

/** The CLI exits 1 for findings and for a failure alike, so these are the script's own codes. */
export const EXIT = {
  clean: 0,
  findings: 1,
  "could-not-run": 2,
} as const satisfies Record<Review["kind"], number>;

const CAUSES = {
  "no-credential": {
    label: "no credential",
    fix: "run `cubic auth connect claude-code` (or `codex`) to review with that model, which needs no Cubic seat. Or sign in with `cubic auth login`, or export CUBIC_API_KEY (a `cbk_` personal key from cubic.dev), which need an active Cubic subscription",
  },
  "rate-limit": { label: "rate limit", fix: "wait a few minutes, then run it again" },
  subscription: {
    label: "subscription",
    fix: "Cubic's included model needs an active subscription, which the owner manages at cubic.dev/settings. Run `cubic auth connect claude-code` (or `codex`) to review without a seat",
  },
  "cli-absent": {
    label: "cubic CLI not installed",
    fix: "CUBIC_DISABLE_GIT_AI=1 npm install --global @cubic-dev-ai/cli (the variable keeps Cubic's git-ai notes and git hook off this machine)",
  },
  "not-ready": { label: "branch not ready", fix: undefined },
  failed: { label: "cubic failed", fix: undefined },
} as const satisfies Record<Cause, { readonly label: string; readonly fix: string | undefined }>;

/** Most specific first: a rate-limit message can also name the key. */
const CAUSE_PATTERNS: readonly { readonly cause: Cause; readonly pattern: RegExp }[] = [
  { cause: "rate-limit", pattern: /rate.?limit|too many requests|\b429\b/iu },
  { cause: "subscription", pattern: /subscription/iu },
  {
    cause: "no-credential",
    pattern: /CUBIC_API_KEY|auth login|not authenticated|credentials are missing/iu,
  },
];

const causeOf = (message: string): Cause =>
  CAUSE_PATTERNS.find(({ pattern }) => pattern.test(message))?.cause ?? "failed";

export const couldNot = (cause: Cause, reason: string): Review => ({
  kind: "could-not-run",
  cause,
  reason,
});

const PREVIEW_LIMIT = 240;

const oneLine = (text: string, limit: number): string => {
  const flat = text.replaceAll(/\s+/gu, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
};

const parsedOutput = (stdout: string): z.infer<typeof outputSchema> | undefined => {
  try {
    const read = outputSchema.safeParse(JSON.parse(stdout));
    return read.success ? read.data : undefined;
  } catch {
    return undefined;
  }
};

const contextNoteOf = (output: z.infer<typeof outputSchema>): string | undefined => {
  const context = output.repository_context;
  if (context?.status !== "unavailable") return undefined;
  return `the review ran without cubic.yaml, learnings or repository settings (${context.reason ?? "no reason given"})`;
};

const unrunReview = (run: CliRun): Review | undefined => {
  if (run.spawnError === "ENOENT") return couldNot("cli-absent", "`cubic` is not on PATH");
  if (run.spawnError === undefined) return undefined;
  return couldNot("failed", `the cubic CLI did not run to the end (${run.spawnError})`);
};

const unreadableReview = (run: CliRun): Review => {
  const seen = oneLine(run.stderr === "" ? run.stdout : run.stderr, PREVIEW_LIMIT);
  return couldNot(
    "failed",
    `the cubic CLI exited ${String(run.status)} and printed JSON this script cannot read: ${seen === "" ? "nothing" : seen}`,
  );
};

/**
 * Clean needs a zero exit, no `error` and no finding. Any output this cannot read is a failure,
 * never a pass.
 */
export const reviewFrom = (run: CliRun): Review => {
  const unrun = unrunReview(run);
  if (unrun !== undefined) return unrun;
  const output = parsedOutput(run.stdout);
  if (output === undefined) return unreadableReview(run);
  if (output.error !== undefined) return couldNot(causeOf(output.error), output.error);
  const contextNote = contextNoteOf(output);
  if (output.issues.length > 0) return { kind: "findings", issues: output.issues, contextNote };
  if (run.status === 0) return { kind: "clean", contextNote };
  return couldNot(
    "failed",
    `the cubic CLI exited ${String(run.status)} with no finding and no error`,
  );
};

export const refusal = (tree: Tree): string | undefined =>
  tree.dirty
    ? "tracked files have uncommitted changes, so the review would not be of the head. Commit or stash them."
    : undefined;

export const drift = (before: Tree, after: Tree): string | undefined => {
  if (before.head !== after.head) {
    return `HEAD moved from ${before.head} to ${after.head} during the review, so it covers neither head alone.`;
  }
  return after.dirty ? "tracked files changed during the review." : undefined;
};

/** The headless switches the CLI's docs recommend, and the opt-out that keeps its git-ai hook off the machine. */
export const cubicEnvironment = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...env,
  CUBIC_DISABLE_AUTOUPDATE: "1",
  CUBIC_DISABLE_LSP_DOWNLOAD: "1",
  CUBIC_DISABLE_GIT_AI: "1",
});

export const redact = (text: string, secret: string | undefined): string =>
  secret === undefined || secret === "" ? text : text.replaceAll(secret, "[redacted]");

const findingLines = (finding: Finding): readonly string[] => {
  const where =
    finding.line === undefined ? finding.file : `${finding.file}:${String(finding.line)}`;
  const first = `${finding.priority} ${where} ${oneLine(finding.title, PREVIEW_LIMIT)}`;
  const detail = oneLine(finding.description, PREVIEW_LIMIT);
  return detail === "" ? [first] : [first, `   ${detail}`];
};

const byPriority = (one: Finding, other: Finding): number =>
  byCodeUnit(one.priority, other.priority);

const countLabel = (count: number): string => `${String(count)} finding${count === 1 ? "" : "s"}`;

export const report = (head: string | undefined, base: string, review: Review): string => {
  const where = `head ${head ?? "unknown"}`;
  if (review.kind === "could-not-run") {
    const { label, fix } = CAUSES[review.cause];
    const lines = [
      `cubic-cli could not run on ${where} (${label}): ${review.reason}`,
      `base ${base}`,
    ];
    return `${(fix === undefined ? lines : [...lines, `fix: ${fix}`]).join("\n")}\n`;
  }
  const issues = review.kind === "findings" ? review.issues.toSorted(byPriority) : [];
  const lines = [
    `cubic-cli reviewed ${where}: ${countLabel(issues.length)}`,
    `base ${base}`,
    ...issues.flatMap(findingLines),
    ...(review.contextNote === undefined ? [] : [`context: ${review.contextNote}`]),
  ];
  return `${lines.join("\n")}\n`;
};
