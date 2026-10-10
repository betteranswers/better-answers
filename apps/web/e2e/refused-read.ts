import type { Page } from "@playwright/test";

import { NOT_THE_OPERATOR } from "@/features/console/refusal-words.ts";

/** The api's refusal of a console read for want of the mark, as a batch carries one answer back. */
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

/** The batch's other answers stay the api's own: a refused standing would close the whole console. */
export const refusedFromNowOn = (page: Page, procedure: string) =>
  page.route(
    (url) => url.pathname.includes(procedure),
    async (route) => {
      const answered = await route.fetch();
      const asked = new URL(route.request().url()).pathname.replace("/trpc/", "").split(",");
      const answers: readonly unknown[] = await answered.json();
      await route.fulfill({
        response: answered,
        json: answers.map((answer, at) => (asked[at] === procedure ? WITHOUT_THE_MARK : answer)),
      });
    },
  );
