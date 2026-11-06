import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

import { refusalOf, useTRPC, type ApiError, type RefusalWord } from "@/shared/api/trpc.ts";
import { memberChanged } from "@/shared/member/member.ts";

const OWNER_FORBIDS: RefusalWord = "owner-forbids";

export const ownsNoLonger = (failure: Error | ApiError | null): boolean =>
  failure !== null && refusalOf(failure)?.word === OWNER_FORBIDS;

export const useOwnershipLost = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const here = useRef(true);

  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);

  return useCallback(() => {
    void memberChanged(queryClient, api, { readAgain: true, ifUnread: "keep" }).then(() => {
      if (here.current) void router.invalidate();
    });
  }, [queryClient, api, router]);
};

export const useArrivalDecidedAgainOnceUnowned = (unowned: boolean) => {
  const ownershipLost = useOwnershipLost();

  useEffect(() => {
    if (unowned) ownershipLost();
  }, [unowned, ownershipLost]);
};
