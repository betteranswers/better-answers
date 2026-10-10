import { declareRefusals } from "../kernel/index.ts";

export const RUN_REFUSALS = declareRefusals("runs", {
  "no-such-job": "absent",
});
