import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { askOfOurRoute } from "../auth-hooks.ts";
import { answeredByThisDevice } from "../passkey-hooks.ts";
import { useRereadTheSecondFactor } from "./second-factor-hooks.ts";

const PASSKEY_OPTIONS_PATH = "/second-factor/confirm/passkey-options";

const PASSKEY_PATH = "/second-factor/confirm/passkey";

const AUTHENTICATOR_PATH = "/second-factor/confirm/authenticator";

const RECOVERY_PATH = "/second-factor/recovery";

const RESTORE_PATH = "/second-factor/restore";

const confirmed = z.object({ confirmed: z.literal(true) });

const granted = z.object({ granted: z.literal(true) });

const confirmWithAPasskey = async () =>
  askOfOurRoute(
    PASSKEY_PATH,
    { response: await answeredByThisDevice(PASSKEY_OPTIONS_PATH) },
    confirmed,
  );

export const useConfirmByPasskey = () => {
  const reread = useRereadTheSecondFactor();
  return useMutation({ mutationFn: confirmWithAPasskey, onSuccess: reread });
};

const useSendACode = <Answer>(path: string, answer: z.ZodType<Answer>) => {
  const reread = useRereadTheSecondFactor();
  return useMutation({
    mutationFn: (code: string) => askOfOurRoute(path, { code }, answer),
    onSettled: reread,
  });
};

export const useConfirmByAuthenticator = () => useSendACode(AUTHENTICATOR_PATH, confirmed);

export const useSpendARecoveryCode = () => useSendACode(RECOVERY_PATH, granted);

export const useAcceptARestoreCode = () => useSendACode(RESTORE_PATH, granted);

export type SendingACode = ReturnType<typeof useSpendARecoveryCode>;
