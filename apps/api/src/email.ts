/** Outside the auth module, so a procedure that emails pulls none of the auth server into the SPA's types. */
export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
};

export type EmailSender = (message: EmailMessage) => Promise<void>;

/**
 * What an email the api writes needs: the transport, the origin its links point at, and the
 * operator's address, undefined where the deployment names none.
 */
export type Mail = {
  readonly send: EmailSender;
  readonly publicUrl: string;
  readonly operatorAddress: string | undefined;
};
