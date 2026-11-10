import { findPackageJSON } from "node:module";
import path from "node:path";

const WORKSPACE_PARENTS: ReadonlySet<string> = new Set(["apps", "packages"]);

export const rootsOf = (fileUrl: string) => {
  const manifest = findPackageJSON(".", fileUrl);
  if (manifest === undefined) throw new Error(`no package.json above ${fileUrl}`);
  const workspaceRoot = path.dirname(manifest);
  const repositoryRoot = path.dirname(path.dirname(workspaceRoot));
  if (!WORKSPACE_PARENTS.has(path.basename(path.dirname(workspaceRoot)))) {
    throw new Error(
      `${manifest} is no workspace of apps/ or packages/, so ${fileUrl} has no roots`,
    );
  }
  return { workspaceRoot, repositoryRoot };
};
