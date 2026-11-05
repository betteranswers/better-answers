import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  couldNot,
  cubicEnvironment,
  EXIT,
  report,
  reviewFrom,
} from "@better-answers/devtools/cubic-review";
import type { CliRun } from "@better-answers/devtools/cubic-review";
import { repositoryRoot } from "@better-answers/devtools/paths";
import {
  gitIn,
  sweptFolder,
  throwawayRepository,
  writeUnder,
} from "@better-answers/devtools/throwaway-tree";

const NO_PROVIDER =
  "No AI provider is configured. Set CUBIC_API_KEY, or run `cubic auth login`, `cubic auth connect codex`, `cubic auth connect cursor`, or `claude login`.";

const SUBSCRIPTION_EXPIRED = `{
  "issues": [],
  "error": "Subscription expired. Visit https://www.cubic.dev/settings?tab=subscription to renew.",
  "repository_context": {
    "status": "loaded",
    "repository": "betteranswers/better-answers",
    "settings": true,
    "custom_agents": ["Require API Auth, Validation, and Tenant Scoping"],
    "learnings": 0
  }
}
`;

const LOADED = { status: "loaded", repository: "betteranswers/better-answers", settings: true };

const finding = (priority: string, file: string, title: string, line?: number) => ({
  priority,
  file,
  ...(line === undefined ? {} : { line }),
  title,
  description: "The handler reads the row\nbefore it checks the lock.",
});

const cli = (stdout: unknown, status: number | null, rest: Partial<CliRun> = {}): CliRun => ({
  stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout, null, 2),
  stderr: "",
  status,
  spawnError: undefined,
  ...rest,
});

describe("reading the cubic CLI's output", () => {
  it("reads no finding and a zero exit as clean", () => {
    expect(reviewFrom(cli({ issues: [], repository_context: LOADED }, 0)).kind).toBe("clean");
  });

  it("reads findings printed with exit 1 as findings", () => {
    const review = reviewFrom(
      cli({ issues: [finding("P1", "apps/api/src/server.ts", "Race on the lock", 12)] }, 1),
    );

    expect(review).toMatchObject({ kind: "findings", issues: [{ priority: "P1", line: 12 }] });
  });

  it("carries the CLI's own error word for word", () => {
    expect(reviewFrom(cli(SUBSCRIPTION_EXPIRED, 1))).toEqual(
      couldNot(
        "Subscription expired. Visit https://www.cubic.dev/settings?tab=subscription to renew.",
      ),
    );
  });

  it("reports an error over findings printed beside it", () => {
    const review = reviewFrom(
      cli({ issues: [finding("P0", "a.ts", "Bug")], error: "Review interrupted" }, 130),
    );

    expect(review).toEqual(couldNot("Review interrupted"));
  });

  it("never reads empty output as clean", () => {
    expect(reviewFrom(cli("", 0)).kind).toBe("could-not-run");
  });

  it("never reads a changed JSON shape as clean", () => {
    expect(reviewFrom(cli({ findings: [] }, 0)).kind).toBe("could-not-run");
  });

  it("quotes the CLI when its output is not JSON", () => {
    const review = reviewFrom(cli("", 1, { stderr: "error: unknown argument --nope\n" }));

    expect(JSON.stringify(review)).toContain("error: unknown argument --nope");
  });

  it("reads exit 1 with nothing to report as a failure", () => {
    expect(reviewFrom(cli({ issues: [] }, 1)).kind).toBe("could-not-run");
  });

  it("tells how to install a missing CLI without git-ai", () => {
    const review = reviewFrom(cli("", null, { spawnError: "ENOENT" }));

    expect(JSON.stringify(review)).toContain(
      "CUBIC_DISABLE_GIT_AI=1 npm install --global @cubic-dev-ai/cli",
    );
  });

  it("reads a timeout as a failure", () => {
    expect(reviewFrom(cli("", null, { spawnError: "ETIMEDOUT" })).kind).toBe("could-not-run");
  });

  it("keeps a review clean and notes a missing repository context", () => {
    const review = reviewFrom(
      cli({ issues: [], repository_context: { status: "unavailable", reason: "HTTP 502" } }, 0),
    );

    expect(review.kind).toBe("clean");
    expect(JSON.stringify(review)).toContain("HTTP 502");
  });

  it("maps each outcome to its own exit code", () => {
    expect(EXIT).toEqual({ clean: 0, findings: 1, "could-not-run": 2 });
  });
});

describe("the report", () => {
  const HEAD = "0123456789abcdef0123456789abcdef01234567";

  it("lists findings in the CLI's order with detail", () => {
    const text = report(
      HEAD,
      reviewFrom(
        cli(
          {
            issues: [
              finding("P2", "apps/web/src/page.tsx", "Unused prop"),
              finding("P0", "apps/api/src/server.ts", "Race on the lock", 12),
            ],
          },
          1,
        ),
      ),
    );

    expect(text).toBe(
      [
        `cubic-cli reviewed head ${HEAD}: 2 findings`,
        "P2 apps/web/src/page.tsx Unused prop",
        "   The handler reads the row",
        "   before it checks the lock.",
        "P0 apps/api/src/server.ts:12 Race on the lock",
        "   The handler reads the row",
        "   before it checks the lock.",
        "",
      ].join("\n"),
    );
  });

  it("states zero findings for a clean review", () => {
    expect(report(HEAD, reviewFrom(cli({ issues: [] }, 0)))).toBe(
      `cubic-cli reviewed head ${HEAD}: 0 findings\n`,
    );
  });

  it("prints the CLI's error as the reason", () => {
    const text = report(HEAD, reviewFrom(cli({ issues: [], error: NO_PROVIDER }, 1)));

    expect(text).toBe(`cubic-cli could not run on head ${HEAD}: ${NO_PROVIDER}\n`);
  });
});

describe("the child's environment", () => {
  it("adds the headless and git-ai switches", () => {
    const env = { PATH: "/bin" };

    expect(cubicEnvironment(env)).toEqual({
      PATH: "/bin",
      CUBIC_DISABLE_AUTOUPDATE: "1",
      CUBIC_DISABLE_LSP_DOWNLOAD: "1",
      CUBIC_DISABLE_GIT_AI: "1",
    });
    expect(env).toEqual({ PATH: "/bin" });
  });
});

const SCRIPT = path.join(repositoryRoot, "scripts/cubic-review.mjs");

const scratch = sweptFolder();

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

let made = 0;

type Setup = {
  readonly origin: string;
  readonly work: string;
  readonly bin: string;
  readonly args: string;
};

const setup = (): Setup => {
  made += 1;
  const root = path.join(scratch, `case-${String(made)}`);
  mkdirSync(root);
  const origin = throwawayRepository(path.join(root, "origin"));
  writeUnder(origin, "a.txt", "one\n");
  gitIn(origin, "add", "--", "a.txt");
  gitIn(origin, "commit", "-q", "-m", "one");
  const work = path.join(root, "work");
  gitIn(root, "clone", "-q", origin, work);
  gitIn(work, "config", "user.email", "test@example.invalid");
  gitIn(work, "config", "user.name", "throwaway repository");
  gitIn(work, "checkout", "-q", "-b", "feature");
  writeUnder(work, "b.txt", "two\n");
  gitIn(work, "add", "--", "b.txt");
  gitIn(work, "commit", "-q", "-m", "two");
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  return { origin, work, bin, args: path.join(root, "args.txt") };
};

const stubCubic = (one: Setup, stdout: unknown, status: number): void => {
  const answer = path.join(one.bin, "answer.json");
  writeUnder(one.bin, "answer.json", JSON.stringify(stdout));
  writeUnder(
    one.bin,
    "cubic",
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${one.args}'\ncat '${answer}'\nexit ${String(status)}\n`,
  );
  chmodSync(path.join(one.bin, "cubic"), 0o755);
};

const pathWithoutCubic = (): string =>
  (process.env["PATH"] ?? "")
    .split(path.delimiter)
    .filter((folder) => !existsSync(path.join(folder, "cubic")))
    .join(path.delimiter);

const ranOn = (one: Setup) =>
  spawnSync(process.execPath, [SCRIPT], {
    cwd: one.work,
    encoding: "utf8",
    env: { ...process.env, PATH: `${one.bin}${path.delimiter}${process.env["PATH"] ?? ""}` },
  });

describe("the cubic-review script", () => {
  it("reviews the head against origin/main, exit 0", () => {
    const one = setup();
    stubCubic(one, { issues: [], repository_context: LOADED }, 0);

    const result = ranOn(one);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `cubic-cli reviewed head ${gitIn(one.work, "rev-parse", "HEAD").trim()}: 0 findings`,
    );
    expect(readFileSync(one.args, "utf8").trim().split("\n")).toEqual([
      "review",
      "--base",
      "origin/main...HEAD",
      "--output-format",
      "json",
    ]);
  });

  it("exits 1 and lists the findings", () => {
    const one = setup();
    stubCubic(one, { issues: [finding("P1", "b.txt", "Wrong total", 1)] }, 1);

    const result = ranOn(one);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("P1 b.txt:1 Wrong total");
  });

  it("exits 2 and names the install without the CLI", () => {
    const one = setup();

    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: one.work,
      encoding: "utf8",
      env: { ...process.env, PATH: pathWithoutCubic() },
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("CUBIC_DISABLE_GIT_AI=1 npm install --global");
  });

  it("reviews only the branch's changes once the base moved", () => {
    const one = setup();
    stubCubic(one, { issues: [] }, 0);
    writeUnder(one.origin, "c.txt", "three\n");
    gitIn(one.origin, "add", "--", "c.txt");
    gitIn(one.origin, "commit", "-q", "-m", "three");
    const newBase = gitIn(one.origin, "rev-parse", "HEAD").trim();

    const result = ranOn(one);

    expect(result.status).toBe(0);
    expect(gitIn(one.work, "rev-parse", "origin/main").trim()).toBe(newBase);
    expect(readFileSync(one.args, "utf8")).toContain("origin/main...HEAD");
  });

  it("reviews a clone that fetches only its own branch", () => {
    const one = setup();
    stubCubic(one, { issues: [] }, 0);
    gitIn(
      one.work,
      "config",
      "remote.origin.fetch",
      "+refs/heads/feature:refs/remotes/origin/feature",
    );
    gitIn(one.work, "update-ref", "-d", "refs/remotes/origin/main");

    const result = ranOn(one);

    expect(result.status).toBe(0);
    expect(gitIn(one.work, "rev-parse", "--verify", "origin/main").trim()).not.toBe("");
  });
});
