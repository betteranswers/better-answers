import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");

const PINNED_USES =
  /^\s*(?:-\s+)?uses:\s+(?<action>[^./\s][^@\s]*)@(?<sha>[0-9a-f]{40})\s+#\s+(?<tag>\S+)\s*$/;
const ANY_USES = /^\s*(?:-\s+)?uses:\s+(?<reference>\S+)/;
const LOCAL_USES = /^\s*(?:-\s+)?uses:\s+\.\//;

type Pin = { readonly action: string; readonly sha: string; readonly tag: string };

const workflowFiles = (): readonly string[] =>
  readdirSync(workflowDirectory)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .sort();

const linesOf = (file: string): readonly string[] =>
  readFileSync(path.join(workflowDirectory, file), "utf8").split("\n");

const usesLines = (): readonly { readonly where: string; readonly line: string }[] =>
  workflowFiles().flatMap((file) =>
    linesOf(file).flatMap((line, index) =>
      ANY_USES.test(line) ? [{ where: `${file}:${index + 1}`, line: line.trim() }] : [],
    ),
  );

const pins = (): readonly Pin[] =>
  usesLines().flatMap(({ line }) => {
    const groups = PINNED_USES.exec(line)?.groups;
    const action = groups?.["action"];
    const sha = groups?.["sha"];
    const tag = groups?.["tag"];
    return action === undefined || sha === undefined || tag === undefined
      ? []
      : [{ action, sha, tag }];
  });

const distinctPer = (key: (pin: Pin) => string, value: (pin: Pin) => string) => {
  const seen = new Map<string, Set<string>>();
  for (const pin of pins()) {
    const values = seen.get(key(pin)) ?? new Set<string>();
    values.add(value(pin));
    seen.set(key(pin), values);
  }
  return seen;
};

describe("what the workflows are allowed to run", () => {
  it("runs no third-party action from a moving reference", () => {
    const unpinned = usesLines()
      .filter(({ line }) => !LOCAL_USES.test(line) && !PINNED_USES.test(line))
      .map(({ where, line }) => `${where}: ${line}`);

    expect(
      unpinned,
      "a workflow names an action by something other than a 40-hex commit SHA with its tag as a trailing comment. Resolve the tag with `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` (dereference an annotated tag through `git/tags/<sha>`), then write `uses: owner/repo@<sha> # <tag>`.",
    ).toEqual([]);
  });

  it("gives one action one pin, however many workflows run it", () => {
    const shasPerAction = [
      ...distinctPer(
        (pin) => pin.action,
        (pin) => pin.sha,
      ),
    ].flatMap(([action, shas]) =>
      shas.size > 1 ? [`${action}: ${[...shas].sort().join(", ")}`] : [],
    );
    const tagsPerSha = [
      ...distinctPer(
        (pin) => `${pin.action}@${pin.sha}`,
        (pin) => pin.tag,
      ),
    ].flatMap(([pinned, tags]) =>
      tags.size > 1 ? [`${pinned}: ${[...tags].sort().join(", ")}`] : [],
    );

    expect(shasPerAction, "one action is pinned to two different commits.").toEqual([]);
    expect(tagsPerSha, "one pinned commit is labelled with two different tags.").toEqual([]);
  });

  it("reads enough pins that an empty read would show", () => {
    expect(workflowFiles().length).toBeGreaterThan(0);
    expect(pins().length).toBeGreaterThan(0);
    expect(pins().length).toEqual(usesLines().filter(({ line }) => !LOCAL_USES.test(line)).length);
  });
});
