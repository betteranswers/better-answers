import { z } from "zod";

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
