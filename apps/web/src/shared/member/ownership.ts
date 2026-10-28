import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { refusalOf, useTRPC, type ApiError, type RefusalWord } from "@/shared/api/trpc.ts";
import { memberChanged } from "@/shared/member/member.ts";

const OWNER_FORBIDS: RefusalWord = "owner-forbids";

export const ownsNoLonger = (failure: Error | ApiError | null): boolean =>
  failure !== null && refusalOf(failure)?.word === OWNER_FORBIDS;

export const useArrivalDecidedAgainOnceUnowned = (unowned: boolean) => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    if (!unowned) return;
    let here = true;
    void memberChanged(queryClient, api, { readAgain: true, ifUnread: "keep" }).then(() => {
      if (here) void router.invalidate();
    });
    return () => {
      here = false;
    };
  }, [unowned, queryClient, api, router]);
};
