import { Hono } from "hono";

import { harnessControl } from "./harness-control.ts";
import type { TestApp } from "./harness.ts";

/** Mounted as `serve.ts` mounts it, so the answer is the one the browser suite reads. */
export const askedOfTheHarness = async (app: TestApp, path: string, body: unknown) => {
  const answered = await new Hono().route("/", harnessControl(app)).request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const said: unknown = await answered.json();
  return { status: answered.status, said };
};
