import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  hookScript,
  recordsItsArgv,
  runHook,
  scratchRoot,
  stubsOnPath,
  type HookRun,
} from "@better-answers/devtools/worktree-hooks";

const script = path.join(import.meta.dirname, "../../../../scripts/jdocmunch-watch-cap.sh");
const hook = hookScript("watch-cap-hook");

const scratch = scratchRoot("jdocmunch-watch-cap");

const CAP = "<integer>1073741824</integer>";

/** The plist as `jdocmunch-mcp watch-install` writes it: no `SoftResourceLimits`. */
const INSTALLED = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>us.gravelle.jdocmunch-watch</string>
  <key>StandardErrorPath</key><string>/tmp/watch.err</string>
</dict></plist>
`;

let made = 0;

/** A plist at its own path, or none, and a `launchctl` stub that logs its argv. */
const machine = (
  plist: string | undefined,
): { readonly plistPath: string; readonly log: string; readonly env: Record<string, string> } => {
  made += 1;
  const plistPath = path.join(scratch, `watch-${String(made)}.plist`);
  if (plist !== undefined) writeFileSync(plistPath, plist);
  const log = path.join(scratch, `launchctl-${String(made)}`);
  const bin = stubsOnPath(path.join(scratch, `bin-${String(made)}`), {
    launchctl: recordsItsArgv(log),
  });
  return {
    plistPath,
    log,
    env: {
      JDOCMUNCH_WATCH_PLIST: plistPath,
      PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
    },
  };
};

const run = (file: string, env: Record<string, string>, argv: string[] = []): HookRun =>
  runHook(file, { argv, env });

const reloads = (log: string): string[] =>
  existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];

describe("putting the cap back on the watcher's log", () => {
  it("adds the 1 GB cap and reloads the watcher", () => {
    const { plistPath, log, env } = machine(INSTALLED);
    const applied = run(script, env);
    expect(applied.status).toBe(0);
    const written = readFileSync(plistPath, "utf8");
    expect(written).toContain("<key>FileSize</key>");
    expect(written).toContain(CAP);
    expect(written).toContain("us.gravelle.jdocmunch-watch");
    expect(reloads(log)).toEqual([
      expect.stringMatching(new RegExp(`^bootout gui/\\d+ ${plistPath}$`)),
      expect.stringMatching(new RegExp(`^bootstrap gui/\\d+ ${plistPath}$`)),
    ]);
  });

  it("changes nothing and reloads nothing when the cap is there", () => {
    const { plistPath, log, env } = machine(INSTALLED);
    run(script, env);
    const once = readFileSync(plistPath, "utf8");
    const again = run(script, env);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("Nothing changed");
    expect(readFileSync(plistPath, "utf8")).toBe(once);
    expect(reloads(log)).toHaveLength(2);
  });

  it("refuses when the watcher was never installed", () => {
    const { log, env } = machine(undefined);
    const refused = run(script, env);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("jdocmunch-mcp watch-install");
    expect(reloads(log)).toEqual([]);
  });
});

describe("the session-start warning that the cap is gone", () => {
  it("shows a message naming the script that restores it", () => {
    const { env } = machine(INSTALLED);
    const said = run(hook, env);
    expect(said.status).toBe(0);
    const message = z
      .object({ systemMessage: z.string() })
      .parse(JSON.parse(said.stdout)).systemMessage;
    expect(message).toContain("bash scripts/jdocmunch-watch-cap.sh");
  });

  it.each([
    ["the cap is in place", true],
    ["no watcher is installed", false],
  ] as const)("says nothing when %s", (_, installed) => {
    const { env } = machine(installed ? INSTALLED : undefined);
    if (installed) run(script, env);
    const said = run(hook, env);
    expect(said.status).toBe(0);
    expect(said.stdout).toBe("");
  });

  it("never touches the plist or the service", () => {
    const { plistPath, log, env } = machine(INSTALLED);
    run(hook, env);
    expect(readFileSync(plistPath, "utf8")).toBe(INSTALLED);
    expect(reloads(log)).toEqual([]);
  });
});
