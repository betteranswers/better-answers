/** Outside the auth module, so a procedure that emails pulls none of the auth server into the SPA's types. */
export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
};

export type EmailSender = (message: EmailMessage) => Promise<void>;

/** What an email the api writes needs: the transport, and the origin its links point at. */
export type Mail = {
  readonly send: EmailSender;
  readonly publicUrl: string;

  /** Where a flagged display name is told; undefined where the deployment names no operator. */
  readonly operatorAddress: string | undefined;
};
