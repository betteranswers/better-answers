import { useQueryClient, type DataTag, type QueryKey } from "@tanstack/react-query";

export type Undo = { readonly undo: () => void };

/**
 * A click must read as done within a tenth of a second, so the cache takes the act before the
 * api answers.
 */
export const useOptimistic = () => {
  const queryClient = useQueryClient();
  return async <Data>(
    queryKey: DataTag<QueryKey, Data, unknown>,
    change: (data: Data) => Data,
  ): Promise<Undo> => {
    await queryClient.cancelQueries({ queryKey });
    const before = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, (held) => (held === undefined ? held : change(held)));
    return {
      undo: () => {
        queryClient.setQueryData(queryKey, before);
      },
    };
  };
};
