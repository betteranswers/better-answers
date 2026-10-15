import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";

import { useOptimistic, type Undo } from "@/shared/api/optimistic.ts";
import { useTRPC, type ApiError } from "@/shared/api/trpc.ts";

type Api = ReturnType<typeof useTRPC>;

type QuestionsAskedPage = inferOutput<Api["questions"]["asked"]>;

/** One record as the reading Admin may read it now: a concept they cannot read is simply absent. */
export type AskedRecord = QuestionsAskedPage["records"][number];

export type Feedback = AskedRecord["feedback"][number];

export type ConceptRead = AskedRecord["concepts"][number];

export type FlagClosing = inferInput<Api["questions"]["closeFlag"]>["closedAs"];

const FLAG = "flag" satisfies Feedback["verdict"];

export const isAFlag = (feedback: Feedback): boolean => feedback.verdict === FLAG;

export const isOpen = (feedback: Feedback): boolean =>
  isAFlag(feedback) && feedback.closedAt === null;

/** Flagged first, then newest, a page at a time; the cursor goes back as the page served it. */
export const useQuestionsAsked = () => {
  const api = useTRPC();
  return useInfiniteQuery(
    api.questions.asked.infiniteQueryOptions(
      {},
      { getNextPageParam: (page) => page.nextCursor ?? undefined },
    ),
  );
};

export type QuestionsAsked = ReturnType<typeof useQuestionsAsked>;

type Closing = { readonly feedbackId: string; readonly closedAs: FlagClosing };

/** Shown until the read answers again with the instant the api recorded. */
const nowSaid = (): string => new Date().toISOString();

const closedIn = (record: AskedRecord, closing: Closing, at: string): AskedRecord => {
  if (!record.feedback.some((feedback) => feedback.id === closing.feedbackId)) return record;
  const feedback = record.feedback.map((given) =>
    given.id === closing.feedbackId
      ? { ...given, closedAs: closing.closedAs, closedAt: at }
      : given,
  );
  return { ...record, feedback, flagged: feedback.some(isOpen) };
};

const holdsTheFlag = (page: QuestionsAskedPage, closing: Closing): boolean =>
  page.records.some((record) => record.feedback.some((given) => given.id === closing.feedbackId));

/** A page without the flag keeps its reference, so nothing reading it draws again. */
const pageClosed = (page: QuestionsAskedPage, closing: Closing, at: string): QuestionsAskedPage =>
  holdsTheFlag(page, closing)
    ? { ...page, records: page.records.map((record) => closedIn(record, closing, at)) }
    : page;

/** A closing reads as done within a tenth of a second: the record leaves the flagged group at once. */
export const useCloseFlag = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const optimistic = useOptimistic();
  const queryKey = api.questions.asked.infiniteQueryKey({});
  return useMutation(
    api.questions.closeFlag.mutationOptions({
      onMutate: (closing: Closing): Promise<Undo> => {
        const at = nowSaid();
        return optimistic(queryKey, (held) =>
          held.pages.some((page) => holdsTheFlag(page, closing))
            ? { ...held, pages: held.pages.map((page) => pageClosed(page, closing, at)) }
            : held,
        );
      },
      onError: (_refusal: ApiError, _closing: Closing, taken: Undo | undefined) => {
        taken?.undo();
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey }),
    }),
  );
};
