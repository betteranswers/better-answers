import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every third-party action a workflow runs is pinned to a commit SHA with its tag beside it
 * as a comment (`T-040`). A tag is a moving reference into somebody else's repository, and
 * `build.yml`'s job holds a `packages: write` token for `ghcr.io`.
 *
 * That makes each `uses:` line two coupled values, and `[DEPS2]` is about exactly this: a
 * pinned value copied is a second pin that ages alone. An action cannot import a constant,
 * so the rule's usual remedy is unavailable and this test is what stands in its place —
 * `actions/checkout` appears four times and three other actions twice each, and nothing
 * else notices when one site is bumped and another is not.
 *
 * **What it cannot see.** Whether a SHA really is the commit its tag names lives on GitHub
 * and nowhere in this repository, so proving it needs a network call. `check` runs on every
 * pull request and reaches a real Postgres, not the internet, and a suite that calls the
 * GitHub API would fail on a rate limit rather than on a defect. So the agreement between a
 * SHA and its tag is checked **when the pin is written or moved** — resolved through
 * `repos/<owner>/<repo>/git/ref/tags/<tag>` and recorded in the PR body, as `T-040` did for
 * all nine — and Renovate maintains it after that (`renovate.json`, `pinDigests` on the
 * `github-actions` manager). What this test holds is everything that can be read off the
 * files: a SHA is there at all, a tag comment is there to read it against, and one action
 * carries one pin across the whole directory.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");

/**
 * `- uses: owner/repo@<40 hex> # v1.2.3`. A local reusable workflow (`uses: ./.github/…`)
 * is not an action reference and is matched separately below, because it is versioned by
 * the commit it is called from.
 */
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

/** Every `uses:` line in the directory, as `file:line` → the raw line. */
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

/** action → every distinct value it is pinned to across the directory. */
const distinctPer = (key: (pin: Pin) => string, value: (pin: Pin) => string) => {
  const seen = new Map<string, Set<string>>();
  for (const pin of pins()) {
    const values = seen.get(key(pin)) ?? new Set<string>();
    values.add(value(pin));
    seen.set(key(pin), values);
  }
  return seen;
};

describe("what the workflows are allowed to run (T-040)", () => {
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
    // [DEPS2] both ways, and both directions catch a different half-done bump: two SHAs
    // under one tag is a site somebody moved and a site they missed; two tags on one SHA
    // is a comment that stopped describing what runs.
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

  it("keeps enough actions under the check that an empty read would show", () => {
    // The two assertions above are satisfied by finding nothing at all — a renamed
    // directory, or a regex that stopped matching `uses:`, and both go quiet (T-039's
    // empty-snapshot guard, same shape).
    expect(workflowFiles().length).toBeGreaterThan(0);
    expect(pins().length).toBeGreaterThan(0);
    expect(pins().length).toEqual(usesLines().filter(({ line }) => !LOCAL_USES.test(line)).length);
  });
});
