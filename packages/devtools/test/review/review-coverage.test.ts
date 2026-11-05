import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";
import {
  assess,
  parseCheckRuns,
  parsePullRequest,
  REVIEW_LABEL,
} from "@better-answers/devtools/review-coverage";
import type { CheckRun, PullRequest } from "@better-answers/devtools/review-coverage";
import { sweptFolder, writeUnder } from "@better-answers/devtools/throwaway-tree";

const HEAD = "50687082eea64fa7fad3bae37a5cf48d93c5cd50";
const NOW = Date.parse("2026-11-04T10:45:00Z");

const ago = (minutes: number): string => new Date(NOW - minutes * 60 * 1000).toISOString();

const run = (
  name: string,
  conclusion: string | null,
  title: string,
  startedAt: string = ago(60),
  status = "completed",
): CheckRun => ({ name, status, conclusion, started_at: startedAt, output: { title } });

const cubic = (conclusion: string | null, title: string, startedAt?: string, status?: string) =>
  run("cubic · AI code reviewer", conclusion, title, startedAt, status);
const rabbit = (conclusion: string | null, title: string, startedAt?: string, status?: string) =>
  run("CodeRabbit", conclusion, title, startedAt, status);

const REVIEWED = cubic("success", "AI review completed");
const MERGE_PASS = cubic("success", "AI review not needed for merge commit");
const NOT_STARTED = cubic("neutral", "Automatic AI review not started after branch rewrite");
const OVER_LIMIT = cubic("neutral", "AI review line limit reached");
const SKIPPED = rabbit("skipped", "No files to review");
const NO_ALERTS = run("CodeQL", "success", "No new alerts in code changed by this pull request");

const ASK = "@cubic-dev-ai review this PR";
const LIMIT_REPLY =
  "> @cubic-dev-ai review this PR\n\n@liam-jons cubic can't start this review because your workspace has reached its free monthly review limit.";
const comment = (body: string, minutesAgo = 120, login = "liam-jons") => ({
  body,
  createdAt: ago(minutesAgo),
  author: { login },
});
const reviewBy = (login: string) => ({ author: { login } });
const labelled = [{ name: REVIEW_LABEL }];
const CUBIC_REVIEWED_BEFORE = [reviewBy("cubic-dev-ai")];

const assessed = (pr: string, runs: readonly CheckRun[], rest: Partial<PullRequest> = {}) =>
  assess(
    pr,
    { headRefOid: HEAD, labels: [], comments: [], reviews: [], changedFiles: 15, ...rest },
    runs,
    NOW,
  );

const lines = (report: string): readonly string[] => report.trimEnd().split("\n");

const nextOf = (report: string): string =>
  lines(report).find((line) => line.startsWith("next:")) ?? "no next line";

const addLabel = (pr: string) => `next: gh pr edit ${pr} --add-label ${REVIEW_LABEL}`;
const askCubic = (pr: string) => `next: gh pr comment ${pr} --body "${ASK}"`;

describe("what counts as a review", () => {
  it("counts a completed Cubic review and reports each bot", () => {
    const result = assessed("973", [REVIEWED, SKIPPED, NO_ALERTS], {
      reviews: CUBIC_REVIEWED_BEFORE,
    });

    expect(result.exitCode).toBe(0);
    expect(lines(result.report)).toEqual([
      `head ${HEAD}`,
      "cubic\treviewed (success: AI review completed)",
      "coderabbit\tnot reviewed (skipped: No files to review)",
      "codeql\treviewed (success: No new alerts in code changed by this pull request)",
      "ai reviewers on this head: 1 of 2",
      "pull request: 15 files, label review:coderabbit not set, Cubic reviewed it: yes, Cubic hit its limit: no, Cubic asked: no",
      "next: none",
    ]);
  });

  it("does not count Cubic's merge commit pass", () => {
    const result = assessed("1", [MERGE_PASS], { reviews: CUBIC_REVIEWED_BEFORE });

    expect(result.exitCode).toBe(1);
    expect(lines(result.report)).toContain(
      "cubic\tnot reviewed (success: AI review not needed for merge commit)",
    );
    expect(lines(result.report)).toContain("ai reviewers on this head: 0 of 2");
    expect(nextOf(result.report)).toBe(addLabel("1"));
  });

  it("takes a completed run over a newer failed one", () => {
    const result = assessed("1", [
      REVIEWED,
      cubic("neutral", "Incremental review could not start"),
    ]);

    expect(result.exitCode).toBe(0);
  });

  it("counts CodeRabbit as an AI reviewer and CodeQL as none", () => {
    const rabbitReviewed = assessed("1", [NOT_STARTED, rabbit("success", "Review completed")]);
    const scannerOnly = assessed("1", [NOT_STARTED, SKIPPED, NO_ALERTS]);

    expect(rabbitReviewed.exitCode).toBe(0);
    expect(lines(rabbitReviewed.report)).toContain("ai reviewers on this head: 1 of 2");
    expect(scannerOnly.exitCode).toBe(1);
    expect(lines(scannerOnly.report)).toContain("ai reviewers on this head: 0 of 2");
  });

  describe("on #783's real merge head", () => {
    const fixture = (name: string): string =>
      readFileSync(path.join(repositoryRoot, "packages/devtools/test/review", name), "utf8");
    const pullRequest = parsePullRequest(fixture("pr-783-merge-head-view.json"));
    const runs = parseCheckRuns(fixture("pr-783-merge-head-check-runs.json"));

    it("counts no review, so the next step asks Cubic", () => {
      const result = assess("783", pullRequest, runs, NOW);

      expect(result.exitCode).toBe(1);
      expect(lines(result.report)).toContain(
        "cubic\tnot reviewed (success: AI review not needed for merge commit)",
      );
      expect(nextOf(result.report)).toBe(askCubic("783"));
    });

    it("adds the label once Cubic replies naming its limit", () => {
      const answered = {
        ...pullRequest,
        comments: [
          ...pullRequest.comments,
          comment(ASK, 40),
          comment(LIMIT_REPLY, 40, "cubic-dev-ai"),
        ],
      };

      const result = assess("783", answered, runs, NOW);

      expect(result.exitCode).toBe(1);
      expect(nextOf(result.report)).toBe(addLabel("783"));
    });
  });
});

describe("the next step", () => {
  it("waits for a running bot and says for how long", () => {
    const result = assessed("7", [cubic(null, "", ago(5), "in_progress"), SKIPPED]);

    expect(result.exitCode).toBe(3);
    expect(lines(result.report)).toContain("cubic\tpending (in_progress)");
    expect(lines(result.report)).toContain("a bot is still running, so this is not final");
    expect(nextOf(result.report)).toBe(
      "next: wait for the running bot, then run pnpm run review-coverage 7 again. After 20 minutes, review-coverage counts a bot that is still running as not run",
    );
  });

  it("waits for a scanner only when no AI review exists", () => {
    const scanning = run("CodeQL", null, "", ago(5), "in_progress");
    const reviewed = assessed("7", [REVIEWED, scanning]);
    const unreviewed = assessed("7", [NOT_STARTED, scanning]);

    expect(lines(reviewed.report)).toContain("codeql\tpending (in_progress)");
    expect(reviewed.exitCode).toBe(0);
    expect(lines(reviewed.report)).toContain("a bot is still running, so this is not final");
    expect(nextOf(reviewed.report)).toBe("next: none");
    expect(unreviewed.exitCode).toBe(3);
  });

  it("treats a bot running over 20 minutes as not run", () => {
    const result = assessed("7", [cubic(null, "", ago(30), "in_progress")]);

    expect(lines(result.report)).toContain(
      "cubic\tnot reviewed (in_progress: still running after 20 minutes)",
    );
    expect(result.exitCode).toBe(1);
    expect(nextOf(result.report)).toBe(askCubic("7"));
  });

  it("waits for Cubic for 10 minutes after an ask", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], { comments: [comment(ASK, 3)] });

    expect(result.exitCode).toBe(3);
    expect(nextOf(result.report)).toMatch(
      /^next: wait for Cubic, which was asked less than 10 minutes ago/u,
    );
  });

  it("adds the label when Cubic replies naming its limit", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], {
      comments: [comment(ASK, 3), comment(LIMIT_REPLY, 3, "cubic-dev-ai")],
    });

    expect(result.exitCode).toBe(1);
    expect(nextOf(result.report)).toBe(addLabel("5"));
  });

  it("ignores a limit that Cubic only quotes from another comment", () => {
    const quoting = "> cubic hit its line limit on #12\n\n@liam-jons starting the review now.";
    const result = assessed("5", [NOT_STARTED, SKIPPED], {
      comments: [comment(ASK, 3), comment(quoting, 3, "cubic-dev-ai")],
    });

    expect(result.exitCode).toBe(3);
  });

  it("ignores a limit named by anyone but Cubic", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], {
      comments: [comment(ASK, 3), comment(LIMIT_REPLY, 3)],
    });

    expect(result.exitCode).toBe(3);
  });

  it.each([
    ["an earlier Cubic review", [NOT_STARTED, SKIPPED], { reviews: CUBIC_REVIEWED_BEFORE }],
    ["the limit on the head's run", [OVER_LIMIT, SKIPPED], {}],
    ["an ask over 10 minutes old", [], { comments: [comment(ASK, 11)] }],
  ])("adds the label after %s", (_cause, runs, rest) => {
    const result = assessed("5", runs, rest);

    expect(result.exitCode).toBe(1);
    expect(nextOf(result.report)).toBe(addLabel("5"));
  });

  it("offers no next step once the label is on", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], {
      labels: labelled,
      reviews: CUBIC_REVIEWED_BEFORE,
    });

    expect(result.exitCode).toBe(1);
    expect(nextOf(result.report)).toMatch(/^next: none to add\. The label is on the pull request/u);
    expect(nextOf(result.report)).toContain("review-coverage 5 again for up to 10 minutes");
  });

  it("skips the label past 100 changed files", () => {
    const big = assessed("5", [OVER_LIMIT, SKIPPED], { changedFiles: 101 });
    const edge = assessed("5", [OVER_LIMIT, SKIPPED], { changedFiles: 100 });

    expect(nextOf(big.report)).toMatch(
      /^next: none\. CodeRabbit skips a pull request of over 100/u,
    );
    expect(big.exitCode).toBe(1);
    expect(nextOf(edge.report)).toBe(addLabel("5"));
  });

  it("asks Cubic when it has not run on this head", () => {
    const labelledNever = assessed("5", [NOT_STARTED, SKIPPED], { labels: labelled });
    const noCubicRun = assessed("5", [SKIPPED]);

    expect(nextOf(labelledNever.report)).toBe(askCubic("5"));
    expect(lines(noCubicRun.report)).toContain("cubic\tmissing (no check run on this head)");
    expect(nextOf(noCubicRun.report)).toBe(askCubic("5"));
  });

  it("counts only Cubic's own reviews", () => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], {
      reviews: [reviewBy("coderabbitai"), reviewBy("liam-jons"), { author: null }],
    });

    expect(nextOf(result.report)).toBe(askCubic("5"));
  });

  it.each([
    ["only quotes the request", `Run it. Then comment ${ASK} if it fails.`, askCubic("5")],
    ["spells the request in any case", "@Cubic-Dev-AI Review", addLabel("5")],
    ["asks politely, as #750 did", "@cubic-dev-ai please review this pull request", addLabel("5")],
    [
      "is Cubic quoting a polite request",
      "> @cubic-dev-ai please review this pull request\n\n@liam-jons cubic is on it.",
      askCubic("5"),
    ],
  ])("reads a comment that %s", (_case, body, expected) => {
    const result = assessed("5", [NOT_STARTED, SKIPPED], { comments: [comment(body)] });

    expect(nextOf(result.report)).toBe(expected);
  });
});

describe("reading what gh prints", () => {
  const view = JSON.stringify({
    headRefOid: HEAD,
    labels: [{ name: "bug", color: "d73a4a" }, { name: REVIEW_LABEL }],
    comments: [{ body: ASK, createdAt: ago(5), author: { login: "liam-jons" } }],
    changedFiles: 15,
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
    expect(read.comments).toEqual([
      { body: ASK, createdAt: ago(5), author: { login: "liam-jons" } },
    ]);
    expect(read.reviews.map((one) => one.author?.login)).toEqual(["cubic-dev-ai", undefined]);
    expect(read.changedFiles).toBe(15);
  });

  it("joins the pages of check runs", () => {
    const read = parseCheckRuns(pages([NOT_STARTED], [SKIPPED, NO_ALERTS]));

    expect(read.map((one) => one.name)).toEqual([
      "cubic · AI code reviewer",
      "CodeRabbit",
      "CodeQL",
    ]);
  });

  it("throws on a pull request without a head", () => {
    expect(() =>
      parsePullRequest(JSON.stringify({ labels: [], comments: [], reviews: [], changedFiles: 1 })),
    ).toThrow("headRefOid");
  });

  it("throws on check runs that are not pages", () => {
    expect(() => parseCheckRuns(JSON.stringify({ check_runs: [] }))).toThrow("expected array");
  });
});

const SCRIPT = path.join(repositoryRoot, "scripts/review-coverage.mjs");

const scratch = sweptFolder();

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const pathWith = (bin: string): string => `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`;

describe("the review-coverage script", () => {
  it("reads the pull request through gh and exits 1", () => {
    const bin = path.join(scratch, "stub-gh");
    mkdirSync(bin);
    const args = path.join(bin, "args.txt");
    const view = { headRefOid: HEAD, labels: [], comments: [], reviews: [], changedFiles: 15 };
    writeUnder(bin, "view.json", JSON.stringify(view));
    writeUnder(bin, "runs.json", JSON.stringify([{ check_runs: [NOT_STARTED] }]));
    writeUnder(
      bin,
      "gh",
      `#!/bin/sh\nprintf '%s\\n' "$@" >> '${args}'\ncase "$1" in pr) cat '${path.join(bin, "view.json")}';; *) cat '${path.join(bin, "runs.json")}';; esac\n`,
    );
    chmodSync(path.join(bin, "gh"), 0o755);

    const result = spawnSync(process.execPath, [SCRIPT, "934"], {
      encoding: "utf8",
      env: { ...process.env, PATH: pathWith(bin) },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(askCubic("934"));
    expect(readFileSync(args, "utf8")).toContain("headRefOid,labels,comments,reviews,changedFiles");
  });
});
