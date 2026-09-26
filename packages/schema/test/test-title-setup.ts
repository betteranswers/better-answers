import { beforeEach } from "vitest";

import { holdTitle } from "./test-title.ts";

beforeEach(({ task }) => {
  holdTitle(task.name);
});
