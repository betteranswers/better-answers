import { z } from "zod";

import { conceptIriOf } from "@better-answers/schema";

import type { ReturnedConcept } from "../src/answering/index.ts";
import { openModelClient, type ModelClient } from "../src/llm/index.ts";

/** One `Answer` a judge is asked about, as `ask` returns it. */
export const A_CANDIDATE: ReturnedConcept = {
  iri: conceptIriOf("01J6AAAAAAAAAAAAAAAAAAAAAA"),
  url: "/knowledge/search/01J6AAAAAAAAAAAAAAAAAAAAAA",
  kind: "Answer",
  title: "How long are audit logs kept?",
  collection: "audits",
  body: "Audit logs are kept for thirteen months.\n",
  trust: {
    tier: "unverified",
    status: "current",
    verifiedBy: null,
    verifiedAt: null,
    rider: null,
  },
  trustWords: "Unverified",
  evidence: [],
};

/** A request as the fake wire saw it. */
export type WireSent = { readonly url: string; readonly headers: unknown; readonly body: string };

/** A model client whose wire keeps what it is sent and answers each request as `answer` does. */
export const clientAnswering = (
  answer: (body: string) => Promise<Response>,
): { readonly sent: WireSent[]; readonly client: ModelClient } => {
  const sent: WireSent[] = [];
  const client = openModelClient({
    fetch: async (input, init) => {
      const body = typeof init?.body === "string" ? init.body : "";
      const url = input instanceof Request ? input.url : input.toString();
      sent.push({ url, headers: init?.headers, body });
      return answer(body);
    },
    clock: { now: () => new Date() },
    log: { info: () => {} },
  });
  return { sent, client };
};

const messagesBody = z.object({ messages: z.array(z.object({ content: z.string() })) });

/** The prompt a Messages request body carried. */
export const promptOf = (body: string): string =>
  messagesBody.parse(JSON.parse(body)).messages[0]?.content ?? "";

/** Each candidate's number, by the question it was written for, as the judge's prompt names them. */
export const candidatesIn = (prompt: string): ReadonlyMap<string, string> =>
  new Map(
    [
      ...prompt.matchAll(
        /<candidate number="(\d+)">\n<collection>[^<]*<\/collection>\n<written_for>([^<]*)<\/written_for>/g,
      ),
    ].map(([, place = "", title = ""]) => [title, place]),
  );

/** A Messages reply whose one text block is `text`, at a stated usage. */
const messagesReplyOf = (text: string): string =>
  JSON.stringify({
    id: "msg_01",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1_580, output_tokens: 96 },
  });

const decisionBody = z.object({
  questions: z.record(
    z.string(),
    z.object({ instructions: z.object({ written_for: z.string() }) }),
  ),
});

/** Each candidate's question id, by the question it was written for, as a decision call names them. */
export const decisionCandidatesIn = (body: string): ReadonlyMap<string, string> =>
  new Map(
    Object.entries(decisionBody.parse(JSON.parse(body)).questions).map(([id, question]) => [
      question.instructions.written_for,
      id,
    ]),
  );

/**
 * Workers AI's reply giving each candidate the probability of yes `yes` holds for its title, and
 * nought to the rest.
 */
export const decisionReplyTo = (yes: ReadonlyMap<string, number>, body: string): string =>
  JSON.stringify({
    result: {
      model: "clef-flash",
      answers: Object.fromEntries(
        [...decisionCandidatesIn(body)].map(([title, id]) => [
          id,
          { type: "noul", noul: yes.get(title) ?? 0 },
        ]),
      ),
      usage: { input_tokens: 2_400, output_tokens: 3 },
    },
    success: true,
    errors: [],
    messages: [],
  });

/** The reply of a judge saying yes to each candidate written for one of `fits`, no to the rest. */
export const judgeReplyTo = (fits: readonly string[], body: string): string =>
  messagesReplyOf(
    JSON.stringify(
      Object.fromEntries(
        [...candidatesIn(promptOf(body))].map(([title, place]) => [
          place,
          fits.includes(title) ? "yes" : "no",
        ]),
      ),
    ),
  );
