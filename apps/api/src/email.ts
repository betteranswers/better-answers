/** Outside the auth module, so a procedure that emails pulls none of the auth server into the SPA's types. */
export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /** Sent as the alternative to `text`; an email without one goes as text alone. */
  readonly html?: string;
};

export type EmailSender = (message: EmailMessage) => Promise<void>;

/** What an email the api writes needs: the transport, and the origin its links point at. */
export type Mail = {
  readonly send: EmailSender;
  readonly publicUrl: string;
};
