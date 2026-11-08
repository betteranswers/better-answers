import { BUNDLE_MANIFEST_PATH, type SENSITIVITIES } from "@better-answers/schema";
import { conceptIndexRows, testData, type MigratedPostgres } from "@better-answers/schema/testing";

import { treeCommitted } from "./bundle.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

export type Indexed = {
  readonly path: string;
  readonly title: string;
  readonly sensitivity: (typeof SENSITIVITIES)[number];
  readonly audienceGroups: readonly string[] | null;
};

export type BundleIndexed = { readonly head: string; readonly iriOf: (path: string) => string };

export const bundleIndexed = async (
  db: MigratedPostgres,
  scenario: Scenario,
  files: ReadonlyMap<string, string>,
  indexed: readonly Indexed[],
): Promise<BundleIndexed> => {
  const { git, workspaceId } = scenario;
  const head = await treeCommitted(git, workspaceId, files, "Land the knowledge base");
  const client = await db.pool.connect();
  try {
    await testData(client).bundleCommit({ workspaceId, sha: head });
    const alike = new Map<string, { readonly visibility: Indexed; readonly held: Indexed[] }>();
    for (const each of indexed) {
      const key = `${each.sensitivity} ${each.audienceGroups?.join(",") ?? ""}`;
      const group = alike.get(key) ?? { visibility: each, held: [] };
      group.held.push(each);
      alike.set(key, group);
    }
    const minted = await Promise.all(
      [...alike.values()].map(async ({ visibility, held }) => {
        const iris = await conceptIndexRows(client, {
          workspaceId,
          commitSha: head,
          conceptType: "Policy",
          sensitivity: visibility.sensitivity,
          audienceGroups: visibility.audienceGroups,
          concepts: held.map(({ path, title }) => ({ path, title })),
        });
        return held.map(({ path }, at) => [path, iris[at] ?? ""] as const);
      }),
    );
    const iris = new Map(minted.flat());
    return {
      head,
      iriOf: (path) => {
        const iri = iris.get(path);
        if (iri === undefined) throw new Error(`no concept is indexed at ${path}`);
        return iri;
      },
    };
  } finally {
    client.release();
  }
};

export const wideBundle = (
  db: MigratedPostgres,
  scenario: Scenario,
  count: number,
): Promise<BundleIndexed> => {
  const paths = Array.from({ length: count }, (_unused, at) => `knowledge/wide/concept-${at}.md`);
  return bundleIndexed(
    db,
    scenario,
    new Map([
      [BUNDLE_MANIFEST_PATH, "owner: Acme\n"],
      ...paths.map((path, at): [string, string] => [
        path,
        `---\ntitle: Rule ${String(at)}\ntype: Policy\n---\n\nRule ${String(at)} holds.\n`,
      ]),
    ]),
    paths.map((path, at) => ({
      path,
      title: `Rule ${String(at)}`,
      sensitivity: "Internal",
      audienceGroups: null,
    })),
  );
};
