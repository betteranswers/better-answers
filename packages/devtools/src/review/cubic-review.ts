import { z } from "zod";

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

export type Review =
  | { readonly kind: "clean"; readonly contextNote: string | undefined }
  | {
      readonly kind: "findings";
      readonly issues: readonly Finding[];
      readonly contextNote: string | undefined;
    }
  | { readonly kind: "could-not-run"; readonly reason: string };

/** What `spawnSync` returned, with the error reduced to its errno code. */
export type CliRun = {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
  readonly spawnError: string | undefined;
};

/** The CLI exits 1 for findings and for a failure alike, so these are the script's own codes. */
export const EXIT = {
  clean: 0,
  findings: 1,
  "could-not-run": 2,
} as const satisfies Record<Review["kind"], number>;

export const couldNot = (reason: string): Review => ({ kind: "could-not-run", reason });

const NOT_INSTALLED =
  "`cubic` is not on PATH. Install it with `CUBIC_DISABLE_GIT_AI=1 npm install --global @cubic-dev-ai/cli`, where the variable keeps Cubic's git-ai notes and git hook off this machine";

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
  if (run.spawnError === "ENOENT") return couldNot(NOT_INSTALLED);
  if (run.spawnError === undefined) return undefined;
  return couldNot(`the cubic CLI did not run to the end (${run.spawnError})`);
};

const unreadableReview = (run: CliRun): Review => {
  const seen = (run.stderr === "" ? run.stdout : run.stderr).trim();
  return couldNot(
    `the cubic CLI exited ${String(run.status)} and printed JSON this script cannot read: ${seen === "" ? "nothing" : seen}`,
  );
};

/** Clean needs a zero exit, no `error` and no finding. Output this cannot read is a failure, never a pass. */
export const reviewFrom = (run: CliRun): Review => {
  const unrun = unrunReview(run);
  if (unrun !== undefined) return unrun;
  const output = parsedOutput(run.stdout);
  if (output === undefined) return unreadableReview(run);
  if (output.error !== undefined) return couldNot(output.error);
  const contextNote = contextNoteOf(output);
  if (output.issues.length > 0) return { kind: "findings", issues: output.issues, contextNote };
  if (run.status === 0) return { kind: "clean", contextNote };
  return couldNot(`the cubic CLI exited ${String(run.status)} with no finding and no error`);
};

/** The headless switches the CLI's docs recommend, and the opt-out that keeps its git-ai hook off the machine. */
export const cubicEnvironment = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...env,
  CUBIC_DISABLE_AUTOUPDATE: "1",
  CUBIC_DISABLE_LSP_DOWNLOAD: "1",
  CUBIC_DISABLE_GIT_AI: "1",
});

const findingLines = (finding: Finding): readonly string[] => {
  const where =
    finding.line === undefined ? finding.file : `${finding.file}:${String(finding.line)}`;
  const first = `${finding.priority} ${where} ${finding.title}`;
  const detail = finding.description.trim();
  return detail === "" ? [first] : [first, `   ${detail.replaceAll("\n", "\n   ")}`];
};

export const report = (head: string, review: Review): string => {
  if (review.kind === "could-not-run") {
    return `cubic-cli could not run on head ${head}: ${review.reason}\n`;
  }
  const issues = review.kind === "findings" ? review.issues : [];
  const lines = [
    `cubic-cli reviewed head ${head}: ${String(issues.length)} ${issues.length === 1 ? "finding" : "findings"}`,
    ...issues.flatMap(findingLines),
    ...(review.contextNote === undefined ? [] : [`context: ${review.contextNote}`]),
  ];
  return `${lines.join("\n")}\n`;
};
