import { writeFileSync } from "node:fs";

import {
  contractDigest,
  CONTRACT_STAMP_MODULE,
  CONTRACTS_ROOT,
  renderContractStamp,
} from "../src/contract-digest.ts";

writeFileSync(CONTRACT_STAMP_MODULE, renderContractStamp(contractDigest(CONTRACTS_ROOT)));
