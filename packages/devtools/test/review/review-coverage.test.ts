import { describe, expect, it } from "vitest";

import {
  assess,
  parseCheckRuns,
  parsePullRequest,
  REVIEW_LABEL,
} from "@better-answers/devtools/review-coverage";
import type { CheckRun, PullRequest } from "@better-answers/devtools/review-coverage";

const HEAD = "50687082eea64fa7fad3bae37a5cf48d93c5cd50";
const ARRIVED = "2026-11-04T10:00:00Z";
const LATER = "2026-11-04T10:30:00Z";

const run = (
  name: string,
  conclusion: string | null,
  title: string,
  startedAt: string = ARRIVED,
  status = "completed",
): CheckRun => ({ name, status, conclusion, started_at: startedAt, output: { title } });

const cubic = (conclusion: string | null, title: string, startedAt?: string, status?: string) =>
  run("cubic · AI code reviewer", conclusion, title, startedAt, status);
const rabbit = (conclusion: string | null, title: string, startedAt?: string, status?: string) =>
  run("CodeRabbit", conclusion, title, startedAt, status);
const codacy = (conclusion: string | null, title: string, startedAt?: string, status?: string) =>
  run("Codacy Static Code Analysis", conclusion, title, startedAt, status);

const REVIEWED = cubic("success", "AI review completed");
const NOT_STARTED = cubic("neutral", "Automatic AI review not started after branch rewrite");
const COULD_NOT_START = cubic("neutral", "Incremental review could not start");
const OVER_LIMIT = cubic("neutral", "AI review line limit reached");
const SKIPPED = rabbit("skipped", "No files to review");
const UP_TO_STANDARDS = codacy("success", "Your pull request is up to standards!");

const ASK = "@cubic-dev-ai review this PR";
const comment = (body: string) => ({ body });
const reviewBy = (login: string) => ({ author: { login } });
const labelled = [{ name: REVIEW_LABEL }];
const CUBIC_REVIEWED_BEFORE = [reviewBy("cubic-dev-ai")];

const assessed = (pr: string, runs: readonly CheckRun[], rest: Partial<PullRequest> = {}) =>
  assess(pr, { headRefOid: HEAD, labels: [], comments: [], reviews: [], ...rest }, runs);

const lines = (report: string): readonly string[] => report.trimEnd().split("\n");

const nextOf = (report: string): string =>
  lines(report).find((line) => line.startsWith("next:")) ?? "no next line";

const addLabel = (pr: string) => `next: gh pr edit ${pr} --add-label ${REVIEW_LABEL}`;
const askCubic = (pr: string) => `next: gh pr comment ${pr} --body "${ASK}"`;

describe("the pull requests the script was written for", () => {
  it("shows #973 reviewed by Cubic, with nothing left to do", () => {
    const result = assessed("973", [REVIEWED, SKIPPED, codacy("action_required", "1 new issue")], {
      reviews: CUBIC_REVIEWED_BEFORE,
    });

    expect(result.exitCode).toBe(0);
    expect(lines(result.report)).toEqual([
      `head ${HEAD}`,
      "cubic\treviewed (success: AI review completed)",
      "coderabbit\tnot reviewed (skipped: No files to review)",
      "codacy\treviewed (action_required: 1 new issue)",
      "ai reviewers on this head: 1 of 2",
      "pull request: label review:coderabbit not set, Cubic reviewed it: yes, Cubic asked: no",
      "next: none",
    ]);
  });

  it("sends #964 to the label after an earlier Cubic review", () => {
    const result = assessed("964", [COULD_NOT_START, SKIPPED, UP_TO_STANDARDS], {
      reviews: CUBIC_REVIEWED_BEFORE,
    });

    expect(result.exitCode).toBe(1);
    expect(nextOf(result.report)).toBe(addLabel("964"));
  });

  it("sends #950 to the label past Cubic's line limit", () => {
    const result = assessed("950", [OVER_LIMIT, SKIPPED]);

    expect(result.exitCode).toBe(1);
    expect(nextOf(result.report)).toBe(addLabel("950"));
    expect(lines(result.report)).toContain("codacy\tmissing (no check run on this head)");
  });

  it("asks Cubic on #934, which it never reviewed", () => {
    const result = assessed("934", [NOT_STARTED, SKIPPED]);

    expect(result.exitCode).toBe(1);
    expect(nextOf(result.report)).toBe(askCubic("934"));
  });
});

describe("what counts as a review", () => {
  it("reads the conclusion before the title", () => {
    const result = assessed("1", [cubic("success", "AI review line limit reached")]);

    expect(result.exitCode).toBe(0);
    expect(nextOf(result.report)).toBe("next: none");
  });

  it("finds the limit only in the title", () => {
    const limited = assessed("1", [cubic("neutral", "AI review line limit reached")]);
    const other = assessed("1", [cubic("neutral", "Incremental review could not start")]);

    expect(nextOf(limited.report)).toBe(addLabel("1"));
    expect(nextOf(other.report)).toBe(askCubic("1"));
  });

  it("takes a passing run over a newer failed one", () => {
    const result = assessed("1", [
      REVIEWED,
      cubic("neutral", "Incremental review could not start", LATER),
    ]);

    expect(result.exitCode).toBe(0);
  });

  it("counts CodeRabbit as an AI reviewer", () => {
    const result = assessed("1", [NOT_STARTED, rabbit("success", "Review completed")]);

    expect(result.exitCode).toBe(0);
    expect(lines(result.report)).toContain("ai reviewers on this head: 1 of 2");
  });

  it("does not count Codacy as an AI reviewer", () => {
    const result = assessed("1", [NOT_STARTED, SKIPPED, UP_TO_STANDARDS]);

    expect(lines(result.report)).toContain("ai reviewers on this head: 0 of 2");
  });

  it("names a head with no Cubic run", () => {
    const result = assessed("1", [SKIPPED]);

    expect(lines(result.report)).toContain("cubic\tmissing (no check run on this head)");
    expect(nextOf(result.report)).toBe(askCubic("1"));
  });
});

describe("a bot that is still running", () => {
  it("exits 3 and waits for Cubic", () => {
    const result = assessed("7", [cubic(null, "", ARRIVED, "in_progress"), SKIPPED]);

    expect(result.exitCode).toBe(3);
    expect(lines(result.report)).toContain("cubic\tpending (in_progress)");
    expect(lines(result.report)).toContain("a bot is still running, so this is not final");
    expect(nextOf(result.report)).toBe(
      "next: wait for the running bot, then run pnpm run review-coverage 7 again",
    );
  });

  it("exits 3 for Codacy even after Cubic reviewed", () => {
    const result = assessed("7", [REVIEWED, codacy(null, "", ARRIVED, "queued")]);

    expect(result.exitCode).toBe(3);
  });
});

describe("asking Cubic again and the CodeRabbit label", () => {
  it("never asks Cubic again once it reviewed an earlier commit", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], { reviews: CUBIC_REVIEWED_BEFORE });

    expect(nextOf(result.report)).toBe(addLabel("5"));
  });

  it("ignores a review by anyone but Cubic", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], {
      reviews: [reviewBy("codacy-production"), reviewBy("liam-jons"), { author: null }],
    });

    expect(nextOf(result.report)).toBe(askCubic("5"));
  });

  it("moves to the label once Cubic is asked", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], { comments: [comment(ASK)] });

    expect(result.exitCode).toBe(1);
    expect(nextOf(result.report)).toBe(addLabel("5"));
    expect(lines(result.report)).toContain(
      "pull request: label review:coderabbit not set, Cubic reviewed it: no, Cubic asked: yes",
    );
  });

  it("counts a request made for an earlier head", () => {
    const result = assessed("5", [], { comments: [comment(ASK)] });

    expect(nextOf(result.report)).toBe(addLabel("5"));
  });

  it("ignores a comment that only quotes the request", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], {
      comments: [comment(`Run it. Then comment ${ASK} if it fails.`)],
    });

    expect(nextOf(result.report)).toBe(askCubic("5"));
  });

  it("accepts the request in any case", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], {
      comments: [comment("@Cubic-Dev-AI Review")],
    });

    expect(nextOf(result.report)).toBe(addLabel("5"));
  });

  it("ends the options on the pull request once labelled", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], {
      labels: labelled,
      reviews: CUBIC_REVIEWED_BEFORE,
    });

    expect(result.exitCode).toBe(1);
    expect(nextOf(result.report)).toMatch(/^next: none\. The label is on the pull request/u);
  });

  it("asks Cubic on a labelled pull request it never reviewed", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], { labels: labelled });

    expect(nextOf(result.report)).toBe(askCubic("5"));
  });

  it("passes once CodeRabbit reviews the labelled head", () => {
    const result = assessed("5", [NOT_STARTED, rabbit("success", "Review completed")], {
      labels: labelled,
    });

    expect(result.exitCode).toBe(0);
    expect(nextOf(result.report)).toBe("next: none");
  });

  it("waits while CodeRabbit runs on the labelled head", () => {
    const result = assessed("5", [NOT_STARTED, rabbit(null, "", LATER, "in_progress")], {
      labels: labelled,
    });

    expect(result.exitCode).toBe(3);
  });
});

describe("reading what gh prints", () => {
  const view = JSON.stringify({
    headRefOid: HEAD,
    labels: [{ name: "bug", color: "d73a4a" }, { name: REVIEW_LABEL }],
    comments: [{ body: ASK, createdAt: LATER, author: { login: "liam-jons" } }],
    reviews: [
      { author: { login: "cubic-dev-ai" }, state: "COMMENTED", commit: { oid: HEAD } },
      { author: null, state: "COMMENTED" },
    ],
  });
  const pages = (...perPage: readonly CheckRun[][]): string =>
    JSON.stringify(perPage.map((runs) => ({ total_count: runs.length, check_runs: runs })));

  it("reads the head, the labels, the comments and the reviewers", () => {
    const read = parsePullRequest(view);

    expect(read.headRefOid).toBe(HEAD);
    expect(read.labels.map((one) => one.name)).toEqual(["bug", REVIEW_LABEL]);
    expect(read.comments).toEqual([{ body: ASK }]);
    expect(read.reviews.map((one) => one.author?.login)).toEqual(["cubic-dev-ai", undefined]);
  });

  it("joins the pages of check runs", () => {
    const read = parseCheckRuns(pages([NOT_STARTED], [SKIPPED, UP_TO_STANDARDS]));

    expect(read.map((one) => one.name)).toEqual([
      "cubic · AI code reviewer",
      "CodeRabbit",
      "Codacy Static Code Analysis",
    ]);
  });

  it("reads a check run with no start time or title", () => {
    const bare = { name: "CodeRabbit", status: "queued", conclusion: null, output: {} };

    expect(parseCheckRuns(JSON.stringify([{ check_runs: [bare] }]))).toHaveLength(1);
  });

  it("throws on a pull request without a head", () => {
    expect(() =>
      parsePullRequest(JSON.stringify({ labels: [], comments: [], reviews: [] })),
    ).toThrow("headRefOid");
  });

  it("throws on check runs that are not pages", () => {
    expect(() => parseCheckRuns(JSON.stringify({ check_runs: [] }))).toThrow("expected array");
  });
});
