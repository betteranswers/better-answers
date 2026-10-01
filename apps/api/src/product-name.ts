/** No imports: the SPA's typecheck reads this file through `AppRouter` and the invitation email. */
export const PRODUCT_NAME = "better-answers";

export const senderAt = (apex: string): string => `${PRODUCT_NAME} <no-reply@${apex}>`;
