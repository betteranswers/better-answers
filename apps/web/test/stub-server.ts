export type Asked = string | URL | Request;

export const server = {
  answer: (_asked: Asked): Promise<Response> => Promise.reject(new TypeError("unanswered")),
};

/**
 * Better Auth's client keeps the `fetch` it finds when made, so a test file loads this through
 * `vi.hoisted`, ahead of its imports.
 */
globalThis.fetch = (asked: Asked) => server.answer(asked);
