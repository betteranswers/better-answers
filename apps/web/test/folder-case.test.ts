import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Folder names under the SPA's source, run rather than remembered.
 *
 * `unicorn/filename-case` holds the file half of the convention, and oxlint 1.80 has no rule
 * over a directory's own name — so the half that would otherwise live in review is a walk of
 * the tree. A folder named `SharedUi` reads the same as `shared-ui` on a
 * case-insensitive filesystem, which is what makes a rename a commit that changes nothing
 * on the machine that made it and everything on the machine that builds it.
 *
 * Bulletproof React exempts a `__tests__` folder from the convention. That exemption is not
 * carried: tests here live beside the source tree in `apps/web/test/` and `apps/web/e2e/`,
 * so there is no folder inside `src/` for it to be about.
 */

const source = path.resolve(import.meta.dirname, "../src");

/** Lower-case words joined by single hyphens, and nothing else: `shared`, `ai-elements`. */
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const foldersUnder = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const here = path.join(directory, entry.name);
      return [path.relative(source, here), ...foldersUnder(here)];
    });

describe("the SPA's folders", () => {
  it("names every folder under its source in kebab-case, whatever the filesystem's case rules", () => {
    const folders = foldersUnder(source);

    // A walk that found nothing would pass this test while checking nothing — the silent
    // green a moved or renamed source directory would otherwise buy.
    expect(folders.length).toBeGreaterThan(0);
    expect(folders.filter((folder) => !KEBAB_CASE.test(path.basename(folder)))).toEqual([]);
  });
});
