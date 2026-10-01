import { writeFileSync } from "node:fs";

import { AUDIT_ACTS_MODULE, declaredActNames, renderAuditActs } from "./audit-acts.ts";

writeFileSync(AUDIT_ACTS_MODULE, renderAuditActs(await declaredActNames()));
