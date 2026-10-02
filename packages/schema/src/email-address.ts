import { z } from "zod";

const keepsPartLimits = (address: string): boolean => {
  const at = address.indexOf("@");
  const labels = address.slice(at + 1).split(".");
  return at <= 64 && labels.every((label) => label.length <= 63);
};

/** The limits mail sets on the whole address, its local part and each label, so a real one is never refused. */
export const EMAIL_ADDRESS = z.email().max(254).refine(keepsPartLimits);
