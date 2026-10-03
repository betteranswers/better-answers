import { createOTP } from "@better-auth/utils/otp";
import { generateRandomString, symmetricEncrypt } from "better-auth/crypto";

import { AUTHENTICATOR_CODE_LENGTH } from "@better-answers/schema/second-factor";

import { PRODUCT_NAME } from "../product-name.ts";
import type { Auth } from "./auth.ts";
import { AUTHENTICATOR_STEP_SECONDS } from "./constants.ts";

/** The plugin's own, so its verify accepts a key made here. */
export const OTP_SETTINGS = {
  digits: AUTHENTICATOR_CODE_LENGTH,
  period: AUTHENTICATOR_STEP_SECONDS,
};

/** The plugin's own length for a new key. */
const SECRET_LENGTH = 32;

export type MintedKey = {
  /** As the plugin keeps a secret, so its verify can open it. */
  readonly sealed: string;

  /** The `otpauth://` address a QR code carries, naming `label`. */
  readonly setupAddress: string;
};

/** The plugin's own making and sealing of a key; it rejects as the library does. */
export const mintAuthenticatorKey = async (auth: Auth, label: string): Promise<MintedKey> => {
  const secret = generateRandomString(SECRET_LENGTH);
  const sealed = await symmetricEncrypt({ key: (await auth.$context).secretConfig, data: secret });
  return { sealed, setupAddress: createOTP(secret, OTP_SETTINGS).url(PRODUCT_NAME, label) };
};
