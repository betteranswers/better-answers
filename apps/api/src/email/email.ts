export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
};

export type EmailSender = (message: EmailMessage) => Promise<void>;

export type Mail = {
  readonly send: EmailSender;
  readonly publicUrl: string;
};
