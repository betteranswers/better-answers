import { z } from "zod";

import { byCodeUnit } from "@better-answers/schema/code-unit";

export const REVIEW_LABEL = "review:coderabbit";

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
  comments: z.array(z.object({ body: z.string() })),
  reviews: z.array(z.object({ author: z.object({ login: z.string() }).nullish() })),
});

export type CheckRun = z.infer<typeof checkRunSchema>;

export type PullRequest = z.infer<typeof pullRequestSchema>;

/** The text of `gh pr view --json headRefOid,labels,comments,reviews`. */
export const parsePullRequest = (text: string): PullRequest =>
  pullRequestSchema.parse(JSON.parse(text));

/** The text of `gh api --paginate --slurp` over a head's check runs. */
export const parseCheckRuns = (text: string): readonly CheckRun[] =>
  checkRunPagesSchema.parse(JSON.parse(text)).flatMap((page) => page.check_runs);

type Bot = {
  readonly name: "cubic" | "coderabbit" | "codacy";
  readonly check: string;
  readonly ai: boolean;
  readonly reviewed: readonly string[];
};

const BOTS: readonly Bot[] = [
  { name: "cubic", check: "cubic · AI code reviewer", ai: true, reviewed: ["success"] },
  { name: "coderabbit", check: "CodeRabbit", ai: true, reviewed: ["success"] },
  {
    name: "codacy",
    check: "Codacy Static Code Analysis",
    ai: false,
    reviewed: ["success", "action_required"],
  },
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

const stateOf = (bot: Bot, runs: readonly CheckRun[]): BotState => {
  const mine = runs.filter((one) => one.name === bot.check).toSorted(newestFirst);
  const passed = mine.find(
    (one) => one.conclusion !== null && bot.reviewed.includes(one.conclusion),
  );
  const latest = passed ?? mine[0];
  if (latest === undefined) return { kind: "missing" };
  if (passed === undefined && latest.status !== "completed") {
    return { kind: "pending", status: latest.status };
  }
  return { kind: passed === undefined ? "not reviewed" : "reviewed", ...detailOf(latest) };
};

const describeState = (state: BotState): string => {
  if (state.kind === "missing") return "missing (no check run on this head)";
  if (state.kind === "pending") return `pending (${state.status})`;
  return `${state.kind} (${state.conclusion}: ${state.title})`;
};

/** Cubic words its over-quota check run in the title only. A conclusion alone cannot tell it from the other reasons it skips. */
const LINE_LIMIT_TITLE = /line limit/iu;

const CUBIC_REQUEST = /^\s*@cubic-dev-ai\s+review\b/iu;

const CUBIC_LOGIN = "cubic-dev-ai";

type Facts = {
  readonly pending: boolean;
  readonly reviewed: boolean;
  readonly cubicReviewed: boolean;
  readonly limited: boolean;
  readonly asked: boolean;
  readonly labelled: boolean;
};

type Judged = { readonly bot: Bot; readonly state: BotState };

const factsOf = (judged: readonly Judged[], pullRequest: PullRequest) => {
  const cubic = judged.find(({ bot }) => bot.name === "cubic")?.state;
  return {
    pending: judged.some(({ state }) => state.kind === "pending"),
    reviewed: judged.some(({ bot, state }) => bot.ai && state.kind === "reviewed"),
    cubicReviewed: pullRequest.reviews.some((review) => review.author?.login === CUBIC_LOGIN),
    limited: cubic?.kind === "not reviewed" && LINE_LIMIT_TITLE.test(cubic.title),
    asked: pullRequest.comments.some((comment) => CUBIC_REQUEST.test(comment.body)),
    labelled: pullRequest.labels.some((label) => label.name === REVIEW_LABEL),
  } satisfies Facts;
};

/** Another request would review the whole pull request again with `incremental_commits` off, and spend its lines a second time. */
const cubicHadItsTurn = (facts: Facts): boolean =>
  facts.cubicReviewed || facts.limited || facts.asked;

type Rule = {
  readonly when: (facts: Facts) => boolean;
  readonly exit: 0 | 1 | 3;
  readonly next: (pr: string) => string;
};

const addLabel = (pr: string): string => `gh pr edit ${pr} --add-label ${REVIEW_LABEL}`;

const RULES: readonly Rule[] = [
  {
    when: (facts) => facts.pending,
    exit: 3,
    next: (pr) => `wait for the running bot, then run pnpm run review-coverage ${pr} again`,
  },
  { when: (facts) => facts.reviewed, exit: 0, next: () => "none" },
  {
    when: (facts) => cubicHadItsTurn(facts) && facts.labelled,
    exit: 1,
    next: () =>
      "none. The label is on the pull request and no AI reviewer has reviewed this head, so apply the verdict rule",
  },
  { when: cubicHadItsTurn, exit: 1, next: addLabel },
];

const ASK_CUBIC: Rule = {
  when: () => true,
  exit: 1,
  next: (pr) => `gh pr comment ${pr} --body "@cubic-dev-ai review this PR"`,
};

export type Assessment = { readonly report: string; readonly exitCode: 0 | 1 | 3 };

const yesNo = (value: boolean): string => (value ? "yes" : "no");

export const assess = (
  pr: string,
  pullRequest: PullRequest,
  runs: readonly CheckRun[],
): Assessment => {
  const judged = BOTS.map((bot) => ({ bot, state: stateOf(bot, runs) }));
  const facts = factsOf(judged, pullRequest);
  const rule = RULES.find((one) => one.when(facts)) ?? ASK_CUBIC;
  const reviewers = judged.filter(({ bot, state }) => bot.ai && state.kind === "reviewed");
  const lines = [
    `head ${pullRequest.headRefOid}`,
    ...judged.map(({ bot, state }) => `${bot.name}\t${describeState(state)}`),
    `ai reviewers on this head: ${String(reviewers.length)} of ${String(BOTS.filter((bot) => bot.ai).length)}`,
    ...(facts.pending ? ["a bot is still running, so this is not final"] : []),
    `pull request: label ${REVIEW_LABEL} ${facts.labelled ? "set" : "not set"}, Cubic reviewed it: ${yesNo(facts.cubicReviewed)}, Cubic asked: ${yesNo(facts.asked)}`,
    `next: ${rule.next(pr)}`,
  ];
  return { report: `${lines.join("\n")}\n`, exitCode: rule.exit };
};
