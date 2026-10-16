import type { Page } from "@playwright/test";
import { z } from "zod";

import { NOT_THE_OPERATOR } from "@/features/console/refusal-words.ts";

const WITHOUT_THE_MARK = {
  error: {
    message: NOT_THE_OPERATOR,
    code: -32_003,
    data: {
      code: "FORBIDDEN",
      httpStatus: 403,
      refusal: { word: NOT_THE_OPERATOR, class: "forbidden" },
    },
  },
};

/** A batch's address names its procedures in the order of its answers; a call sent alone names one. */
const askedAt = (url: string): readonly string[] =>
  new URL(url).pathname.replace("/trpc/", "").split(",");

export const refusedFromNowOn = (page: Page, procedure: string) =>
  page.route(
    (url) => askedAt(url.href).includes(procedure),
    async (route) => {
      const answered = await route.fetch();
      const asked = askedAt(route.request().url());
      const answers: readonly unknown[] = await answered.json();
      await route.fulfill({
        response: answered,
        json: answers.map((answer, at) => (asked[at] === procedure ? WITHOUT_THE_MARK : answer)),
      });
    },
  );

const aRefusedCall = z.object({
  error: z.object({
    data: z.object({
      httpStatus: z.number(),
      refusal: z
        .object({
          word: z.string(),
          class: z.string(),
          items: z.record(z.string(), z.string()).optional(),
        })
        .optional(),
      retryAfterSeconds: z.number().optional(),
    }),
  }),
});

export const refusalAnswering = async (page: Page, procedure: string) => {
  const answered = await page.waitForResponse((answer) =>
    askedAt(answer.url()).includes(procedure),
  );
  const answers: unknown = await answered.json();
  const answer = Array.isArray(answers)
    ? answers[askedAt(answered.url()).indexOf(procedure)]
    : answers;
  const refused = aRefusedCall.safeParse(answer);
  if (!refused.success) throw new Error(`the api did not refuse ${procedure}`);
  const { httpStatus, refusal, retryAfterSeconds } = refused.data.error.data;
  return { status: httpStatus, ...refusal, waitSeconds: retryAfterSeconds };
};

/** Better Auth names a refusal in `code`, and one of the api's own routes in `error`. */
const aRefusalOutsideTrpc = z.object({ code: z.string().optional(), error: z.string().optional() });

const wholeSeconds = z.coerce.number().int().optional();

/** A path outside tRPC, Better Auth's or the api's own, asked for before the action as `refusalAnswering` is. */
export const authAnswering = async (page: Page, path: string) => {
  const answered = await page.waitForResponse((answer) => new URL(answer.url()).pathname === path);
  if (answered.ok()) throw new Error(`the api did not refuse ${path}`);
  const { code, error } = aRefusalOutsideTrpc.parse(await answered.json());
  return {
    status: answered.status(),
    code,
    word: error,
    waitSeconds: wholeSeconds.parse(answered.headers()["retry-after"]),
  };
};
