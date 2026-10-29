export type Asked = string | URL | Request;

export type Ask = { readonly procedure: string; readonly input: unknown };

export const server: {
  answer: (asked: Asked, init?: RequestInit) => Promise<Response>;
  /** Each procedure the app asked, in the order asked, with the input it sent. */
  asks: Ask[];
} = {
  answer: () => Promise.reject(new TypeError("unanswered")),
  asks: [],
};

/**
 * Better Auth's client keeps the `fetch` it finds when made, so a test file loads this through
 * `vi.hoisted`, ahead of its imports.
 */
globalThis.fetch = (asked: Asked, init?: RequestInit) => server.answer(asked, init);
