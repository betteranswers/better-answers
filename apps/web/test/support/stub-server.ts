export type Asked = string | URL | Request;

export type Ask = { readonly procedure: string; readonly input: unknown };

export const server: {
  answer: (asked: Asked, init?: RequestInit) => Promise<Response>;
  asks: Ask[];
} = {
  answer: () => Promise.reject(new TypeError("no stub answer is set")),
  asks: [],
};

/**
 * Better Auth's client captures `fetch` at creation, so a test file loads this through
 * `vi.hoisted`, before its imports.
 */
globalThis.fetch = (asked: Asked, init?: RequestInit) => server.answer(asked, init);
