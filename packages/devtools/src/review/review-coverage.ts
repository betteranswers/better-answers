import { z } from "zod";

import { byCodeUnit } from "@better-answers/schema/code-unit";

export const REVIEW_LABEL = "review:coderabbit";

/** CodeRabbit skips a pull request of more files than this, so the label would do nothing. */
const CODERABBIT_FILE_LIMIT = 100;

/** A run still going after this long did not run, so the verdict rule decides. */
const RUNNING_LIMIT_MINUTES = 20;

/** Cubic, asked by comment, shows a check run within this long or did not start. Only that wait is timed. */
const START_WAIT_MINUTES = 10;

const minutes = (count: number): number => count * 60 * 1000;

const checkRunSchema = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  started_at: z.string().nullish(),
  output: z.object({ title: z.string().nullish() }).nullish(),
});

const checkRunPagesSchema = z.array(z.object({ check_runs: z.array(checkRunSchema) }));

const pullRequestSchema = z.object({
  headRefOid: z.string(),
  labels: z.array(z.object({ name: z.string() })),
  comments: z.array(
    z.object({
      body: z.string(),
      createdAt: z.string(),
      author: z.object({ login: z.string() }).nullish(),
    }),
  ),
  reviews: z.array(z.object({ author: z.object({ login: z.string() }).nullish() })),
  changedFiles: z.number(),
});

export type CheckRun = z.infer<typeof checkRunSchema>;

export type PullRequest = z.infer<typeof pullRequestSchema>;

/** The text of `gh pr view --json headRefOid,labels,comments,reviews,changedFiles`. */
export const parsePullRequest = (text: string): PullRequest =>
  pullRequestSchema.parse(JSON.parse(text));

/** The text of `gh api --paginate --slurp` over a head's check runs. */
export const parseCheckRuns = (text: string): readonly CheckRun[] =>
  checkRunPagesSchema.parse(JSON.parse(text)).flatMap((page) => page.check_runs);

type Bot = {
  readonly name: "cubic" | "coderabbit" | "codeql";
  readonly check: string;
  readonly ai: boolean;
  readonly reviewed: (run: CheckRun) => boolean;
};

const concluded =
  (...conclusions: readonly string[]) =>
  (run: CheckRun): boolean =>
    run.conclusion !== null && conclusions.includes(run.conclusion);

/** Cubic also posts `success: AI review not needed for merge commit`, which reviews nothing. Only its completed title counts. */
const cubicCompleted = (run: CheckRun): boolean =>
  run.conclusion === "success" && /review completed/iu.test(run.output?.title ?? "");

const BOTS: readonly Bot[] = [
  { name: "cubic", check: "cubic · AI code reviewer", ai: true, reviewed: cubicCompleted },
  { name: "coderabbit", check: "CodeRabbit", ai: true, reviewed: concluded("success") },
  { name: "codeql", check: "CodeQL", ai: false, reviewed: concluded("success", "failure") },
];

type BotState =
  | { readonly kind: "missing" }
  | { readonly kind: "pending"; readonly status: string }
  | {
      readonly kind: "reviewed" | "not reviewed";
      readonly conclusion: string;
      readonly title: string;
    };

const newestFirst = (one: CheckRun, other: CheckRun): number =>
  byCodeUnit(other.started_at ?? "", one.started_at ?? "");

const detailOf = (run: CheckRun) => ({
  conclusion: run.conclusion ?? "none",
  title: run.output?.title ?? "",
});

const stalled = (run: CheckRun, now: number): boolean =>
  run.started_at != null && now - Date.parse(run.started_at) > minutes(RUNNING_LIMIT_MINUTES);

const stateOf = (bot: Bot, runs: readonly CheckRun[], now: number): BotState => {
  const mine = runs.filter((one) => one.name === bot.check).toSorted(newestFirst);
  const passed = mine.find(bot.reviewed);
  const latest = passed ?? mine[0];
  if (latest === undefined) return { kind: "missing" };
  if (passed === undefined && latest.status !== "completed") {
    return stalled(latest, now)
      ? {
          kind: "not reviewed",
          conclusion: latest.status,
          title: `still running after ${String(RUNNING_LIMIT_MINUTES)} minutes`,
        }
      : { kind: "pending", status: latest.status };
  }
  return { kind: passed === undefined ? "not reviewed" : "reviewed", ...detailOf(latest) };
};

const describeState = (state: BotState): string => {
  if (state.kind === "missing") return "missing (no check run on this head)";
  if (state.kind === "pending") return `pending (${state.status})`;
  return `${state.kind} (${state.conclusion}: ${state.title})`;
};

/** Cubic words the limit in a check run title ("line limit reached") and in its reply to an ask ("monthly review limit"). */
const LIMIT_TEXT = /(?:line|review) limit/iu;

const CUBIC_REQUEST = /^\s*@cubic-dev-ai\s+(?:please\s+)?review\b/iu;

/** Cubic opens a reply by quoting the comment it answers, and the quote can name a limit that is not Cubic's. */
const unquoted = (body: string): string =>
  body
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");

const CUBIC_LOGIN = "cubic-dev-ai";

type Facts = {
  readonly running: boolean;
  readonly pending: boolean;
  readonly reviewed: boolean;
  readonly cubicReviewed: boolean;
  readonly limited: boolean;
  readonly asked: boolean;
  readonly waitingOnAsk: boolean;
  readonly labelled: boolean;
  readonly tooBigForCodeRabbit: boolean;
};

type Judged = { readonly bot: Bot; readonly state: BotState };

const factsOf = (judged: readonly Judged[], pullRequest: PullRequest, now: number): Facts => {
  const cubic = judged.find(({ bot }) => bot.name === "cubic")?.state;
  const asks = pullRequest.comments.filter((comment) => CUBIC_REQUEST.test(comment.body));
  const limited =
    (cubic?.kind === "not reviewed" && LIMIT_TEXT.test(cubic.title)) ||
    pullRequest.comments.some(
      (comment) => comment.author?.login === CUBIC_LOGIN && LIMIT_TEXT.test(unquoted(comment.body)),
    );
  const reviewed = judged.some(({ bot, state }) => bot.ai && state.kind === "reviewed");
  return {
    running: judged.some(({ state }) => state.kind === "pending"),
    pending: judged.some(({ bot, state }) => state.kind === "pending" && (bot.ai || !reviewed)),
    reviewed,
    cubicReviewed: pullRequest.reviews.some((review) => review.author?.login === CUBIC_LOGIN),
    limited,
    asked: asks.length > 0,
    waitingOnAsk:
      !limited && asks.some((ask) => now - Date.parse(ask.createdAt) < minutes(START_WAIT_MINUTES)),
    labelled: pullRequest.labels.some((label) => label.name === REVIEW_LABEL),
    tooBigForCodeRabbit: pullRequest.changedFiles > CODERABBIT_FILE_LIMIT,
  };
};

/** Another request would review the whole pull request again with `incremental_commits` off, and spend its lines a second time. */
const cubicHadItsTurn = (facts: Facts): boolean =>
  facts.cubicReviewed || facts.limited || facts.asked;

type ExitCode = 0 | 1 | 3;

type Rule = {
  readonly when: (facts: Facts) => boolean;
  readonly exit: ExitCode;
  readonly next: (pr: string) => string;
};

const addLabel = (pr: string): string => `gh pr edit ${pr} --add-label ${REVIEW_LABEL}`;

const RULES: readonly Rule[] = [
  {
    when: (facts) => facts.pending,
    exit: 3,
    next: (pr) =>
      `wait for the running bot, then run pnpm run review-coverage ${pr} again. After ${String(RUNNING_LIMIT_MINUTES)} minutes this treats a bot still running as one that did not run`,
  },
  { when: (facts) => facts.reviewed, exit: 0, next: () => "none" },
  {
    when: (facts) => facts.waitingOnAsk,
    exit: 3,
    next: (pr) =>
      `wait for Cubic, which was asked less than ${String(START_WAIT_MINUTES)} minutes ago, then run pnpm run review-coverage ${pr} again. After ${String(START_WAIT_MINUTES)} minutes this moves on to the label`,
  },
  {
    when: (facts) => cubicHadItsTurn(facts) && facts.tooBigForCodeRabbit,
    exit: 1,
    next: () =>
      `none. CodeRabbit skips a pull request of over ${String(CODERABBIT_FILE_LIMIT)} files, so the label would do nothing. Apply the verdict rule`,
  },
  {
    when: (facts) => cubicHadItsTurn(facts) && facts.labelled,
    exit: 1,
    next: (pr) =>
      `none to add. The label is on the pull request and no AI reviewer has reviewed this head. If CodeRabbit has not started, run pnpm run review-coverage ${pr} again for up to ${String(START_WAIT_MINUTES)} minutes, then apply the verdict rule`,
  },
  { when: cubicHadItsTurn, exit: 1, next: addLabel },
];

const ASK_CUBIC: Rule = {
  when: () => true,
  exit: 1,
  next: (pr) => `gh pr comment ${pr} --body "@cubic-dev-ai review this PR"`,
};

export type Assessment = { readonly report: string; readonly exitCode: ExitCode };

const yesNo = (value: boolean): string => (value ? "yes" : "no");

export const assess = (
  pr: string,
  pullRequest: PullRequest,
  runs: readonly CheckRun[],
  now: number,
): Assessment => {
  const judged = BOTS.map((bot) => ({ bot, state: stateOf(bot, runs, now) }));
  const facts = factsOf(judged, pullRequest, now);
  const rule = RULES.find((one) => one.when(facts)) ?? ASK_CUBIC;
  const reviewers = judged.filter(({ bot, state }) => bot.ai && state.kind === "reviewed");
  const lines = [
    `head ${pullRequest.headRefOid}`,
    ...judged.map(({ bot, state }) => `${bot.name}\t${describeState(state)}`),
    `ai reviewers on this head: ${String(reviewers.length)} of ${String(BOTS.filter((bot) => bot.ai).length)}`,
    ...(facts.running ? ["a bot is still running, so this is not final"] : []),
    `pull request: ${String(pullRequest.changedFiles)} files, label ${REVIEW_LABEL} ${facts.labelled ? "set" : "not set"}, Cubic reviewed it: ${yesNo(facts.cubicReviewed)}, Cubic hit its limit: ${yesNo(facts.limited)}, Cubic asked: ${yesNo(facts.asked)}`,
    `next: ${rule.next(pr)}`,
  ];
  return { report: `${lines.join("\n")}\n`, exitCode: rule.exit };
};
