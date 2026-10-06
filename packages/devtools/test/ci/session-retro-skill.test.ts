import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";

const skillDirectory = ".claude/skills/session-retro";
const script = path.join(repositoryRoot, skillDirectory, "scripts/session.py");
const fixtures = path.join(repositoryRoot, "packages/devtools/test/ci/fixtures/session-retro");

const PAST = "5e55a0e1-0000-4000-8000-000000000001";
const CURRENT = "5e55a0e1-0000-4000-8000-000000000002";

const home = mkdtempSync(path.join(tmpdir(), "session-retro-"));
const projectFolder = path.join(home, ".claude/projects", repositoryRoot.replaceAll(/[/.]/g, "-"));
mkdirSync(path.join(projectFolder, PAST, "subagents"), { recursive: true });
cpSync(path.join(fixtures, `${PAST}.jsonl`), path.join(projectFolder, `${PAST}.jsonl`));
cpSync(path.join(fixtures, `${CURRENT}.jsonl`), path.join(projectFolder, `${CURRENT}.jsonl`));
cpSync(path.join(fixtures, "subagents"), path.join(projectFolder, PAST, "subagents"), {
  recursive: true,
});

type Run = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

const session = (args: readonly string[], sessionId?: string): Run => {
  const env: Record<string, string> = { HOME: home, PATH: process.env["PATH"] ?? "" };
  if (sessionId !== undefined) env["CLAUDE_CODE_SESSION_ID"] = sessionId;
  const run = spawnSync("python3", [script, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env,
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
};

const digest = session(["digest", PAST]).stdout;

const section = (heading: string): string => {
  const start = digest.indexOf(`${heading}:`);
  const end = digest.indexOf("\n\n", start);
  return digest.slice(start, end === -1 ? undefined : end);
};

describe("the session-retro script's digest", () => {
  it("lists the slowest span first, timed from its two timestamps", () => {
    const first = section("slowest").split("\n")[1] ?? "";
    expect(first).toContain("30.0s");
    expect(first).toContain("Bash");
  });

  it("times two calls from one response as one span", () => {
    expect(section("slowest")).toMatch(/5\.0s\s+Bash, Read/);
  });

  it("counts a request's tokens once across its content blocks", () => {
    expect(digest).toMatch(/main tokens: input 1000, cache 50, output 100/);
  });

  it("totals every subagent, linked or not", () => {
    const subagents = section("subagents");
    expect(subagents).toContain("a1b2c3");
    expect(subagents).toContain("d4e5f6");
    expect(subagents).toContain("unlinked");
    expect(digest).toMatch(/subagent tokens: input 1500, cache 0, output 150/);
  });

  it("counts owner waits apart from the slowest calls", () => {
    expect(section("slowest")).not.toContain("AskUserQuestion");
    expect(digest).toMatch(/waiting on the owner: 600\.0s/);
  });

  it("reports a call with no result as pending", () => {
    expect(digest).toMatch(/pending: 1/);
    expect(section("errors")).not.toContain("Skill");
  });

  it("names the failed call and the repeated one", () => {
    expect(section("errors")).toContain("the suite failed");
    expect(section("repeated")).toContain("pnpm test");
  });

  it("skips and counts a line it cannot parse", () => {
    expect(digest).toMatch(/skipped lines: 1/);
  });

  it("reports the compaction", () => {
    expect(digest).toMatch(/compactions: 1/);
  });

  it("names the skills the session loaded", () => {
    expect(section("skills")).toContain("ce-plan");
    expect(section("skills")).toContain("ce-work");
  });
});

describe("the session-retro script on the current session", () => {
  it("stops at the retro's own invocation", () => {
    const current = session(["digest"], CURRENT).stdout;
    expect(current).toMatch(/calls: 1\b/);
    expect(current).not.toContain("session.py digest");
  });

  it("stops and says so outside Claude Code", () => {
    const run = session(["digest"]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("not a Claude Code session");
  });

  it("names an id that matches no session", () => {
    const run = session(["digest", "0000dead"]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("0000dead");
  });
});

describe("the session-retro script's other modes", () => {
  it("lists only the sessions under the given home, with titles", () => {
    const listed = session(["list"]).stdout;
    expect(listed).toContain("Fixture session");
    expect(listed).toContain("Current fixture");
    expect(listed.trim().split("\n")).toHaveLength(3);
  });

  it("shows one record with a long field cut short", () => {
    const shown = session(["show", PAST, "14"]).stdout;
    expect(shown).toContain("A long note.");
    expect(shown).toContain("[cut]");
    expect(shown.length).toBeLessThan(1500);
  });

  it("shows a subagent's record by its agent id", () => {
    const shown = session(["show", PAST, "--agent", "d4e5f6", "1"]).stdout;
    expect(shown).toContain("q-d4e5f6");
  });
});

const QUOTED = /`(?<token>[^`]+)`/g;

const withoutFences = (text: string): string => {
  const kept: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    else if (!inFence) kept.push(line);
  }
  return kept.join("\n");
};

const looksLikePath = (token: string): boolean =>
  !/[\s<>$*~]/.test(token) &&
  !token.startsWith("/") &&
  !token.startsWith("-") &&
  (token.includes("/") || /.\.[a-z]+$/.test(token));

const fromRoot = (token: string): string =>
  token.startsWith("references/") || token.startsWith("scripts/")
    ? path.join(skillDirectory, token)
    : token;

const named = ["SKILL.md", "references/categories.md"].flatMap((file) =>
  [
    ...withoutFences(
      readFileSync(path.join(repositoryRoot, skillDirectory, file), "utf8"),
    ).matchAll(QUOTED),
  ]
    .map((match) => match.groups?.["token"] ?? "")
    .filter(looksLikePath)
    .map(fromRoot),
);

describe("the session-retro skill's pointers", () => {
  it("points at files that are in the tree", () => {
    const missing = [...new Set(named)].filter(
      (file) => !existsSync(path.join(repositoryRoot, file)),
    );
    expect(missing, `${skillDirectory} names paths that do not exist`).toEqual([]);
  });

  it("names its script and the files a finding targets", () => {
    expect(named).toEqual(
      expect.arrayContaining([
        `${skillDirectory}/scripts/session.py`,
        "CODING_STANDARDS.md",
        "AGENTS.md",
        "docs/agents/issue-tracker.md",
      ]),
    );
  });
});
