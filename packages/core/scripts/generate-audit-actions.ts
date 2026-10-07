import { writeFileSync } from "node:fs";

import { AUDIT_ACTIONS_MODULE, declaredActionNames, renderAuditActions } from "./audit-actions.ts";

writeFileSync(AUDIT_ACTIONS_MODULE, renderAuditActions(await declaredActionNames()));
