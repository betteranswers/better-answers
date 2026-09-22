import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const fixture = z.object({ gates: z.array(z.string()) });

const GATES = path.resolve(import.meta.dirname, "../gates-printing-a-tag.json");

const read = (): readonly string[] => {
  const parsed: unknown = JSON.parse(readFileSync(GATES, "utf8"));
  return fixture.parse(parsed).gates;
};

const gates = read();

const A_TEST_PATH = /(?:^|\/)(?:tests?|e2e)\/|\.test\.[cm]?tsx?$/;

export const stringsGoUnread = (filename: string): boolean => {
  const posix = filename.replaceAll("\\", "/");
  return A_TEST_PATH.test(posix) || gates.some((gate) => posix.endsWith(gate));
};
