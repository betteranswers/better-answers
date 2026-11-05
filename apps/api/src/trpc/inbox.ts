import {
  acceptSuggestions,
  acceptWaitingInput,
  declineSuggestion,
  declineWaitingInput,
  waitingEdit,
  waitingEditInput,
  waitingOnYou,
  type AcceptSuggestionRefusal,
} from "@better-answers/core/concepts";
import { err, ok } from "@better-answers/core/kernel";
import { parseLocator, passageAt } from "@better-answers/core/sources";

import { doorTold, type Doors } from "../doors.ts";
import {
  crossing,
  given,
  logFailure,
  ownTransactionProcedure,
  parsedBy,
  queryProcedure,
  router,
} from "./base.ts";

type Decided = {
  readonly suggestionId: string;
  readonly outcome: "accepted" | "unconfirmed" | AcceptSuggestionRefusal;
};

const bundleOf = (doors: Doors) => {
  const git = doorTold(doors.git, "no bundle store is configured");
  return git.ok ? ok(git.value) : err(new Error(git.error));
};

export const inboxRouter = router({
  waiting: queryProcedure.query(({ ctx }) =>
    crossing(ctx, waitingOnYou.name, waitingOnYou(ctx.principal, ctx.tx)),
  ),
  item: queryProcedure.input(parsedBy(waitingEditInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      waitingEdit.name,
      given(input, (asked) =>
        waitingEdit(ctx.principal, ctx.tx, asked, {
          passageAt: (locator) => passageAt(ctx.principal, ctx.tx, locator),
          namesPassage: (locator) => parseLocator(locator).ok,
        }),
      ),
    ),
  ),
  accept: ownTransactionProcedure.input(parsedBy(acceptWaitingInput)).mutation(({ ctx, input }) =>
    crossing(
      ctx,
      acceptSuggestions.name,
      given(input, async (asked) => {
        const git = bundleOf(ctx.doors);
        if (!git.ok) return git;
        const accepted = await acceptSuggestions(
          ctx.principal,
          { git: git.value, postgres: ctx.doors.postgres, clock: ctx.doors.clock },
          asked,
        );
        if (!accepted.ok) return accepted;
        const outcomes = accepted.value.map(({ suggestionId, outcome }): Decided => {
          if (outcome.ok) return { suggestionId, outcome: "accepted" };
          if (!(outcome.error instanceof Error)) return { suggestionId, outcome: outcome.error };
          logFailure(ctx.log, acceptSuggestions.name, outcome.error);
          return { suggestionId, outcome: "unconfirmed" };
        });
        return ok({ outcomes });
      }),
    ),
  ),
  decline: ownTransactionProcedure.input(parsedBy(declineWaitingInput)).mutation(({ ctx, input }) =>
    crossing(
      ctx,
      declineSuggestion.name,
      given(input, (asked) => {
        const git = bundleOf(ctx.doors);
        if (!git.ok) return Promise.resolve(git);
        return declineSuggestion(
          ctx.principal,
          { git: git.value, postgres: ctx.doors.postgres },
          asked,
        );
      }),
    ),
  ),
});
