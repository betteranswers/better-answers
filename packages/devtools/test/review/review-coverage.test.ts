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
const EARLIER = "2026-11-04T09:00:00Z";

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
const comment = (body: string, createdAt: string) => ({ body, createdAt });
const labelled = [{ name: REVIEW_LABEL }];

const assessed = (pr: string, runs: readonly CheckRun[], rest: Partial<PullRequest> = {}) =>
  assess(pr, { headRefOid: HEAD, labels: [], comments: [], ...rest }, runs);

const LOCAL = "pnpm run cubic-review";
const lines = (report: string): readonly string[] => report.trimEnd().split("\n");

const nextOf = (report: string): readonly string[] =>
  lines(report).filter((line) => line.startsWith("next:") || line.startsWith("if it cannot run:"));

describe("the pull requests the script was written for", () => {
  it("shows #973 reviewed by Cubic, with nothing left to do", () => {
    const result = assessed("973", [REVIEWED, SKIPPED, codacy("action_required", "1 new issue")]);

    expect(result.exitCode).toBe(0);
    expect(lines(result.report)).toEqual([
      `head ${HEAD}`,
      "cubic\treviewed (success: AI review completed)",
      "coderabbit\tnot reviewed (skipped: No files to review)",
      "codacy\treviewed (action_required: 1 new issue)",
      "ai reviewers on this head: 1 of 2",
      "pull request: label review:coderabbit not set, Cubic asked for this head: no",
      "next: none",
    ]);
  });

  it("sends #972 to the local review, then to asking Cubic", () => {
    const result = assessed("972", [NOT_STARTED, SKIPPED, UP_TO_STANDARDS]);

    expect(result.exitCode).toBe(1);
    expect(nextOf(result.report)).toEqual([
      `next: ${LOCAL}`,
      `if it cannot run: gh pr comment 972 --body "${ASK}"`,
    ]);
  });

  it("sends #964 the same way", () => {
    const result = assessed("964", [COULD_NOT_START, SKIPPED, UP_TO_STANDARDS]);

    expect(nextOf(result.report)).toEqual([
      `next: ${LOCAL}`,
      `if it cannot run: gh pr comment 964 --body "${ASK}"`,
    ]);
  });

  it("sends #950 to the local review, then to the label", () => {
    const result = assessed("950", [OVER_LIMIT, SKIPPED]);

    expect(result.exitCode).toBe(1);
    expect(nextOf(result.report)).toEqual([
      `next: ${LOCAL}`,
      `if it cannot run: gh pr edit 950 --add-label ${REVIEW_LABEL}`,
    ]);
    expect(lines(result.report)).toContain("codacy\tmissing (no check run on this head)");
  });
});

describe("what counts as a review", () => {
  it("reads the conclusion before the title", () => {
    const result = assessed("1", [cubic("success", "AI review line limit reached")]);

    expect(result.exitCode).toBe(0);
    expect(nextOf(result.report)).toEqual(["next: none"]);
  });

  it("finds the limit only in the title", () => {
    const limited = assessed("1", [cubic("neutral", "AI review line limit reached")]);
    const other = assessed("1", [cubic("neutral", "Incremental review could not start")]);

    expect(nextOf(limited.report)[1]).toContain("--add-label");
    expect(nextOf(other.report)[1]).toContain("gh pr comment");
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
    expect(nextOf(result.report)[0]).toBe(`next: ${LOCAL}`);
  });
});

describe("a bot that is still running", () => {
  it("exits 3 and waits for Cubic", () => {
    const result = assessed("7", [cubic(null, "", ARRIVED, "in_progress"), SKIPPED]);

    expect(result.exitCode).toBe(3);
    expect(lines(result.report)).toContain("cubic\tpending (in_progress)");
    expect(lines(result.report)).toContain("a bot is still running, so this is not final");
    expect(nextOf(result.report)).toEqual([
      "next: wait for the running bot, then run pnpm run review-coverage 7 again",
    ]);
  });

  it("exits 3 for Codacy even after Cubic reviewed", () => {
    const result = assessed("7", [REVIEWED, codacy(null, "", ARRIVED, "queued")]);

    expect(result.exitCode).toBe(3);
  });
});

describe("asking Cubic and the CodeRabbit label", () => {
  it("moves to the label once Cubic is asked", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], { comments: [comment(ASK, LATER)] });

    expect(result.exitCode).toBe(1);
    expect(nextOf(result.report)).toEqual([`next: gh pr edit 5 --add-label ${REVIEW_LABEL}`]);
    expect(lines(result.report)).toContain(
      "pull request: label review:coderabbit not set, Cubic asked for this head: yes",
    );
  });

  it("ignores a request made before the head arrived", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], { comments: [comment(ASK, EARLIER)] });

    expect(nextOf(result.report)[0]).toBe(`next: ${LOCAL}`);
  });

  it("ignores a comment that only quotes the request", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], {
      comments: [comment(`Run it. Then comment ${ASK} if it fails.`, LATER)],
    });

    expect(nextOf(result.report)[0]).toBe(`next: ${LOCAL}`);
  });

  it("accepts the request in any case", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], {
      comments: [comment("@Cubic-Dev-AI Review", LATER)],
    });

    expect(nextOf(result.report)[0]).toContain("--add-label");
  });

  it("reads no request when the head has no check run", () => {
    const result = assessed("5", [], { comments: [comment(ASK, LATER)] });

    expect(nextOf(result.report)[0]).toBe(`next: ${LOCAL}`);
  });

  it("takes the label when Cubic is asked and limited", () => {
    const result = assessed("5", [OVER_LIMIT, SKIPPED], { comments: [comment(ASK, LATER)] });

    expect(nextOf(result.report)).toEqual([`next: gh pr edit 5 --add-label ${REVIEW_LABEL}`]);
  });

  it("ends the options on the pull request once labelled", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], {
      labels: labelled,
      comments: [comment(ASK, LATER)],
    });

    expect(result.exitCode).toBe(1);
    expect(nextOf(result.report)).toEqual([
      `next: none on the pull request. Run ${LOCAL} if it has not run on this head, then apply the verdict rule`,
    ]);
  });

  it("passes once CodeRabbit reviews the labelled head", () => {
    const result = assessed("5", [NOT_STARTED, rabbit("success", "Review completed")], {
      labels: labelled,
    });

    expect(result.exitCode).toBe(0);
    expect(nextOf(result.report)).toEqual(["next: none"]);
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
  });
  const pages = (...perPage: readonly CheckRun[][]): string =>
    JSON.stringify(perPage.map((runs) => ({ total_count: runs.length, check_runs: runs })));

  it("reads the head, the labels and the comments", () => {
    const read = parsePullRequest(view);

    expect(read.headRefOid).toBe(HEAD);
    expect(read.labels.map((one) => one.name)).toEqual(["bug", REVIEW_LABEL]);
    expect(read.comments).toEqual([{ body: ASK, createdAt: LATER }]);
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
    expect(() => parsePullRequest(JSON.stringify({ labels: [], comments: [] }))).toThrow(
      "headRefOid",
    );
  });

  it("throws on check runs that are not pages", () => {
    expect(() => parseCheckRuns(JSON.stringify({ check_runs: [] }))).toThrow("expected array");
  });
});
