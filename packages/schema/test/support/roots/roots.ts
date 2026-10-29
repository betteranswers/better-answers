import { findPackageJSON } from "node:module";
import path from "node:path";

const manifest = findPackageJSON(".", import.meta.url);
if (manifest === undefined) throw new Error(`no package.json above ${import.meta.url}`);

export const workspaceRoot = path.dirname(manifest);

export const repositoryRoot = path.dirname(path.dirname(workspaceRoot));
