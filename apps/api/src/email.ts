/** Outside the auth module, so a procedure that emails pulls none of the auth server into the SPA's types. */
export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
};

export type EmailSender = (message: EmailMessage) => Promise<void>;
