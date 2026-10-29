import path from "node:path";

import { repositoryRoot } from "@better-answers/devtools/paths";

export { repositoryRoot };

export const workspaceRoot = path.join(repositoryRoot, "packages/core");
