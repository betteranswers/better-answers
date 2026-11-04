import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  couldNot,
  cubicEnvironment,
  drift,
  EXIT,
  redact,
  refusal,
  report,
  reviewFrom,
} from "@better-answers/devtools/cubic-review";
import type { CliRun, Review } from "@better-answers/devtools/cubic-review";
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
  description: "The   handler\nreads the row before it checks the lock.",
});

const cli = (stdout: unknown, status: number | null, rest: Partial<CliRun> = {}): CliRun => ({
  stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout, null, 2),
  stderr: "",
  status,
  spawnError: undefined,
  ...rest,
});

const kindOf = (review: Review): string =>
  review.kind === "could-not-run" ? `${review.kind}:${review.cause}` : review.kind;

describe("reading the cubic CLI's output", () => {
  it("reads no finding and a zero exit as clean", () => {
    expect(kindOf(reviewFrom(cli({ issues: [], repository_context: LOADED }, 0)))).toBe("clean");
  });

  it("reads findings printed with exit 1 as findings", () => {
    const review = reviewFrom(
      cli({ issues: [finding("P1", "apps/api/src/server.ts", "Race on the lock", 12)] }, 1),
    );

    expect(review).toMatchObject({ kind: "findings", issues: [{ priority: "P1", line: 12 }] });
  });

  it("reads the failure the real CLI 1.14.2 printed", () => {
    expect(kindOf(reviewFrom(cli(SUBSCRIPTION_EXPIRED, 1)))).toBe("could-not-run:subscription");
  });

  it("lets an error outrank findings printed beside it", () => {
    const review = reviewFrom(
      cli({ issues: [finding("P0", "a.ts", "Bug")], error: "Review interrupted" }, 130),
    );

    expect(kindOf(review)).toBe("could-not-run:failed");
  });

  it.each([
    ["a rate limit", "Rate limit exceeded. Try again in 60 seconds.", "rate-limit"],
    ["a 429", "Server error (429)", "rate-limit"],
    ["no provider configured", NO_PROVIDER, "no-credential"],
    ["a missing credential", "Cubic credentials are missing", "no-credential"],
    ["a malformed key", "CUBIC_API_KEY does not look like a cubic API key", "no-credential"],
    ["an unknown failure", "Review returned an invalid final response", "failed"],
  ])("names %s", (_name, error, cause) => {
    expect(kindOf(reviewFrom(cli({ issues: [], error }, 1)))).toBe(`could-not-run:${cause}`);
  });

  it("never reads empty output as clean", () => {
    expect(kindOf(reviewFrom(cli("", 0)))).toBe("could-not-run:failed");
  });

  it("never reads a changed JSON shape as clean", () => {
    expect(kindOf(reviewFrom(cli({ findings: [] }, 0)))).toBe("could-not-run:failed");
  });

  it("quotes the CLI when its output is not JSON", () => {
    const review = reviewFrom(cli("", 1, { stderr: "error: unknown argument --nope\n" }));

    expect(review).toMatchObject({ kind: "could-not-run", cause: "failed" });
    expect(JSON.stringify(review)).toContain("error: unknown argument --nope");
  });

  it("reads exit 1 with nothing to report as a failure", () => {
    expect(kindOf(reviewFrom(cli({ issues: [] }, 1)))).toBe("could-not-run:failed");
  });

  it("reads a missing executable as a missing CLI", () => {
    const review = reviewFrom(cli("", null, { spawnError: "ENOENT" }));

    expect(kindOf(review)).toBe("could-not-run:cli-absent");
  });

  it("reads a timeout as a failure", () => {
    expect(kindOf(reviewFrom(cli("", null, { spawnError: "ETIMEDOUT" })))).toBe(
      "could-not-run:failed",
    );
  });

  it("keeps a clean review and notes a missing context", () => {
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
  const BASE = "origin/main at 89abcdef0123456789abcdef0123456789abcdef";

  it("lists findings by priority with one detail line each", () => {
    const text = report(
      HEAD,
      BASE,
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
        `base ${BASE}`,
        "P0 apps/api/src/server.ts:12 Race on the lock",
        "   The handler reads the row before it checks the lock.",
        "P2 apps/web/src/page.tsx Unused prop",
        "   The handler reads the row before it checks the lock.",
        "",
      ].join("\n"),
    );
  });

  it("states zero findings for a clean review", () => {
    const text = report(HEAD, BASE, reviewFrom(cli({ issues: [] }, 0)));

    expect(text).toBe(`cubic-cli reviewed head ${HEAD}: 0 findings\nbase ${BASE}\n`);
  });

  it("cuts a long detail line", () => {
    const long = { ...finding("P1", "a.ts", "Long"), description: "word ".repeat(200) };
    const lines = report(HEAD, BASE, reviewFrom(cli({ issues: [long] }, 1))).split("\n");

    expect(lines[3]?.length).toBeLessThanOrEqual(250);
    expect(lines[3]).toMatch(/…$/u);
  });

  it("names the connect and sign-in routes without a credential", () => {
    const text = report(HEAD, BASE, reviewFrom(cli({ issues: [], error: NO_PROVIDER }, 1)));

    expect(text).toContain("could not run on head " + HEAD + " (no credential)");
    expect(text).toContain("`cubic auth connect claude-code`");
    expect(text).toContain("`cubic auth login`");
    expect(text).toContain("CUBIC_API_KEY");
  });

  it("names the provider connection for a lapsed subscription", () => {
    const text = report(HEAD, BASE, reviewFrom(cli(SUBSCRIPTION_EXPIRED, 1)));

    expect(text).toContain("(subscription)");
    expect(text).toContain("`cubic auth connect claude-code`");
  });

  it("tells how to install a missing CLI without git-ai", () => {
    const text = report(HEAD, BASE, couldNot("cli-absent", "`cubic` is not on PATH"));

    expect(text).toContain("CUBIC_DISABLE_GIT_AI=1 npm install --global @cubic-dev-ai/cli");
  });

  it("says unknown when no head could be read", () => {
    expect(report(undefined, "origin/main", couldNot("not-ready", "no git"))).toContain(
      "on head unknown",
    );
  });
});

describe("the branch the review would cover", () => {
  const tree = { head: "a".repeat(40), dirty: false };

  it("accepts a clean branch whose head held still", () => {
    expect(refusal(tree)).toBeUndefined();
    expect(drift(tree, tree)).toBeUndefined();
  });

  it("refuses uncommitted tracked changes", () => {
    expect(refusal({ ...tree, dirty: true })).toContain("uncommitted");
  });

  it("refuses a head that moved", () => {
    expect(drift(tree, { ...tree, head: "b".repeat(40) })).toContain("HEAD moved");
  });

  it("refuses a tree edited during the review", () => {
    expect(drift(tree, { ...tree, dirty: true })).toContain("changed during");
  });
});

describe("the child's environment and the printed text", () => {
  it("keeps the key and adds the headless and git-ai switches", () => {
    const env = { CUBIC_API_KEY: "cbk_secret", PATH: "/bin" };
    const child = cubicEnvironment(env);

    expect(child).toEqual({
      CUBIC_API_KEY: "cbk_secret",
      PATH: "/bin",
      CUBIC_DISABLE_AUTOUPDATE: "1",
      CUBIC_DISABLE_LSP_DOWNLOAD: "1",
      CUBIC_DISABLE_GIT_AI: "1",
    });
    expect(env).toEqual({ CUBIC_API_KEY: "cbk_secret", PATH: "/bin" });
  });

  it("removes the key from text", () => {
    expect(redact("bad key cbk_secret, again cbk_secret", "cbk_secret")).toBe(
      "bad key [redacted], again [redacted]",
    );
  });

  it("leaves text alone when no key is set", () => {
    expect(redact("nothing here", undefined)).toBe("nothing here");
    expect(redact("nothing here", "")).toBe("nothing here");
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

const stubCubic = (one: Setup, stdout: unknown, status: number, before = ""): void => {
  const answer = path.join(one.bin, "answer.json");
  writeUnder(one.bin, "answer.json", JSON.stringify(stdout));
  writeUnder(
    one.bin,
    "cubic",
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${one.args}'\n${before}\ncat '${answer}'\nexit ${String(status)}\n`,
  );
  chmodSync(path.join(one.bin, "cubic"), 0o755);
};

const pathWithoutCubic = (): string =>
  (process.env["PATH"] ?? "")
    .split(path.delimiter)
    .filter((folder) => !existsSync(path.join(folder, "cubic")))
    .join(path.delimiter);

const ranOn = (one: Setup, env: Readonly<Record<string, string>> = {}, args: string[] = []) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: one.work,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${one.bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
      ...env,
    },
  });

describe("the cubic-review script", () => {
  it("reviews the head against its merge base, exit 0", () => {
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

  it("exits 2 when the cubic CLI is not installed", () => {
    const one = setup();

    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: one.work,
      encoding: "utf8",
      env: { ...process.env, PATH: pathWithoutCubic() },
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("cubic CLI not installed");
  });

  it("exits 2 without the CLI when tracked files changed", () => {
    const one = setup();
    stubCubic(one, { issues: [] }, 0);
    writeUnder(one.work, "b.txt", "changed\n");

    const result = ranOn(one);

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("uncommitted");
    expect(existsSync(one.args)).toBe(false);
  });

  it("reviews only the branch's changes once the base moved", () => {
    const one = setup();
    stubCubic(one, { issues: [] }, 0);
    const mergeBase = gitIn(one.work, "rev-parse", "origin/main").trim();
    writeUnder(one.origin, "c.txt", "three\n");
    gitIn(one.origin, "add", "--", "c.txt");
    gitIn(one.origin, "commit", "-q", "-m", "three");
    const newBase = gitIn(one.origin, "rev-parse", "HEAD").trim();

    const result = ranOn(one);

    expect(result.status).toBe(0);
    expect(gitIn(one.work, "rev-parse", "origin/main").trim()).toBe(newBase);
    expect(result.stdout).toContain(`origin/main...HEAD, merge base ${mergeBase}`);
    expect(readFileSync(one.args, "utf8")).toContain("origin/main...HEAD");
  });

  it("exits 2 when the head moves during the review", () => {
    const one = setup();
    stubCubic(one, { issues: [] }, 0, "git commit -q --allow-empty -m moved");

    const result = ranOn(one);

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("HEAD moved");
  });

  it("never prints the key it was given", () => {
    const one = setup();
    stubCubic(one, { issues: [], error: "key cbk_secret_value was refused" }, 1);

    const result = ranOn(one, { CUBIC_API_KEY: "cbk_secret_value" });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("key [redacted] was refused");
    expect(result.stdout + result.stderr).not.toContain("cbk_secret_value");
  });

  it("hides the key before a long output is cut", () => {
    const one = setup();
    stubCubic(one, `${"x".repeat(230)} cbk_secret_value`, 1);

    const result = ranOn(one, { CUBIC_API_KEY: "cbk_secret_value" });

    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain("cbk_");
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
    expect(result.stdout).toContain("origin/main...HEAD, merge base");
  });

  it("refuses a base outside origin", () => {
    const result = ranOn(setup(), {}, ["main"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: pnpm run cubic-review");
  });
});
