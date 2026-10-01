import type { Transporter } from "nodemailer";
import type { Logger } from "pino";

import { normalizeError } from "@better-answers/core/kernel";

import type { EmailSender } from "./email.ts";

const domainOf = (address: string): string | null => address.split("@")[1] ?? null;

/** With no transport every send throws, so a sign-in code that cannot go never reads as sent. */
export const emailSender = (
  transport: Transporter | undefined,
  from: string,
  logger: Logger,
): EmailSender => {
  if (transport === undefined) {
    return async (message) => {
      logger.error({ to_domain: domainOf(message.to) }, "no email transport is configured");
      throw new Error("no email transport is configured");
    };
  }
  return async (message) => {
    try {
      await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (cause) {
      throw normalizeError(cause);
    }
    logger.info({ to_domain: domainOf(message.to) }, "email sent");
  };
};
