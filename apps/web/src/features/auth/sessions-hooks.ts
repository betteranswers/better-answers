import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/shared/api/trpc.ts";

export const useSessions = () => {
  const api = useTRPC();
  return useQuery(api.person.sessions.queryOptions());
};

export type SessionsRead = ReturnType<typeof useSessions>;

export type SessionShown = NonNullable<SessionsRead["data"]>[number];

/** Awaited by each sign-out that landed; a refused one keeps its row with its alert. */
const useRereadTheSessions = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries(api.person.sessions.queryFilter());
};

export const useSignOutSession = () => {
  const api = useTRPC();
  const reread = useRereadTheSessions();
  return useMutation(api.person.signOutSession.mutationOptions({ onSuccess: reread }));
};

export const useSignOutOtherSessions = () => {
  const api = useTRPC();
  const reread = useRereadTheSessions();
  return useMutation(api.person.signOutOtherSessions.mutationOptions({ onSuccess: reread }));
};
