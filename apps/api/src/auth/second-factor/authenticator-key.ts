import { createOTP } from "@better-auth/utils/otp";
import { generateRandomString, symmetricEncrypt } from "better-auth/crypto";

import { AUTHENTICATOR_CODE_LENGTH } from "@better-answers/schema/second-factor";

import { PRODUCT_NAME } from "../../product-name.ts";
import type { Auth } from "../auth.ts";
import { AUTHENTICATOR_STEP_SECONDS } from "../constants.ts";

export const OTP_SETTINGS = {
  digits: AUTHENTICATOR_CODE_LENGTH,
  period: AUTHENTICATOR_STEP_SECONDS,
};

const SECRET_LENGTH = 32;

export type MintedKey = {
  readonly sealed: string;

  readonly setupAddress: string;
};

export const mintAuthenticatorKey = async (auth: Auth, label: string): Promise<MintedKey> => {
  const secret = generateRandomString(SECRET_LENGTH);
  const sealed = await symmetricEncrypt({ key: (await auth.$context).secretConfig, data: secret });
  return { sealed, setupAddress: createOTP(secret, OTP_SETTINGS).url(PRODUCT_NAME, label) };
};
