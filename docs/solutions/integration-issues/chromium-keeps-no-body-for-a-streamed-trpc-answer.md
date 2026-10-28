---
title: "Chromium keeps no body for a streamed tRPC answer, so a spec reads it through route.fetch"
date: 2026-10-15
category: integration-issues
module: apps/web
problem_type: integration_issue
component: web
related_components:
  - testing-framework
applies_when:
  - "Reading an `ask.question` response, or another streamed tRPC answer, in a Playwright spec"
  - "Writing a browser spec that must show the api's refusal word before it asserts the page's sentence"
  - "Seeing `Protocol error (Network.getResponseBody): No data found for resource` from `response.text()`"
symptoms:
  - "response.text: Protocol error (Network.getResponseBody): No data found for resource with given identifier"
  - "Playwright's hint blamed a navigation (Response body is not available for a response that was navigated away from), though the page had not navigated"
  - "A browser spec for the spending-limit refusal on New question could not read the api's refusal word, so it passed on any failed ask"
root_cause: wrong_api
resolution_type: test_fix
severity: low
framework_version: "@playwright/test 1.64.0, Chromium"
retire_when: "a released @playwright/test returns the body of a fetch the page read as a stream from Response.text() in Chromium; check Playwright's release notes and try page.waitForResponse on ask.question"
tags:
  - playwright
  - playwright-specs
  - trpc
  - streaming
  - route-fetch
  - refusal
  - ask
---

# Chromium keeps no body for a streamed tRPC answer, so a spec reads it through route.fetch

## Problem

A browser spec must show the api refused for the reason it is testing before it asserts the page's sentence, because the sentence alone also shows on any other failure. For `ask.question`, which the web reads as a stream, Playwright in Chromium could not give the spec the response's body, so the spec had no way to read the refusal word.

## Symptoms

- `page.waitForResponse(...)` on the `ask.question` call, then `response.text()`, threw `Protocol error (Network.getResponseBody): No data found for resource with given identifier`.
- Playwright added that the body "is not available for a response that was navigated away from". It appends that hint to any protocol error from the body read. No navigation had happened, so the hint pointed the wrong way.
- Without the body, the spending-limit test on New question (`apps/web/e2e/ask/ask-new-question.spec.ts`, "says the spending limit in the refusal's sentence") asserted that an alert held words, that no answer was drawn and that the word stayed off the page, but never read the api's own word. Code review found it would still pass if the page dropped the spending limit's own sentence, or if the ask failed for another reason.

## What Didn't Work

- **`page.waitForResponse` and `response.text()`.** This is how `refusalAnswering` in `apps/web/e2e/refused-read.ts` reads a refusal: it waits for the response and calls `answered.json()`. It works for the procedures that `httpBatchLink` and `httpLink` answer in one JSON body. It failed for `ask.question` with the error above.
- **Reusing `refusalAnswering` as it stands.** Even with a body, it parses one JSON document. A streamed answer is a sequence of JSON lines, and the refusal is one line of it, so the helper's parse does not fit.

Per this session's reading, the cause is that the web reads this response as a stream. `apps/web/src/shared/api/link.ts` sends `ask.question` alone through `httpBatchStreamLink` (`STREAMED_PATH`, and `maxItems: 1`). DevTools keeps no copy of a body the page has consumed as a stream, so `Network.getResponseBody` has nothing to answer with. The tree does not prove that explanation; the error and the fix below are what this session observed.

## Solution

Read the body on its way to the page instead of after it arrives. `page.route` intercepts the call, `route.fetch()` sends it to the api, and `route.fulfill` hands the page the same answer:

```ts
// Streamed, so the refusal is a line of the body; the browser keeps no streamed body to read.
const refused = Promise.withResolvers<string>();
await page.route(
  (url) => url.pathname.includes("ask.question"),
  async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    refused.resolve(body);
    await route.fulfill({ response, body });
  },
);

await asked(page);

expect(await refused.promise, "the api did not refuse at the spending limit").toContain(
  "spending-limit-met",
);
expect(await modelCallsIn(request, workspaceId)).toEqual({ judge: 0, draft: 0 });
await saysARefusal(alerted(page));
await keepsItsWordOffThePage(page, "spending-limit-met");
```

The test now fails if the api answers with any other word. It also reads the scripted model's call count through the harness, which shows that the refusal came before any model call.

## Why This Works

`route.fetch()` makes the request from Playwright's side and returns a response whose body Playwright holds in full. The spec reads that copy. The page then gets the answer through `route.fulfill`, so the page's own read is unchanged except for timing.

The timing is the cost. `route.fetch()` waits for the whole body, so the page sees nothing until the stream has ended. That is harmless for a refusal, which ends the stream at once. It would break any test about streaming itself.

## Prevention

- Before you call `response.text()` or `response.json()` on a procedure in a spec, check whether the web streams it: look for the path in `apps/web/src/shared/api/link.ts`. If it is streamed, read it through `page.route` and `route.fetch()` as above.
- Route a streamed call only when the stream ends promptly, as a refusal's does. Never route it in a test that times the first content or checks the first drafted sentence before the stream ends. Those tests hold the model with the harness's `holds` script and release it with `releaseTheModel`, and the first sentence must reach the page while the rest is held.
- When a spec cannot read the refusal word, add another check that does not depend on the page. `modelCallsIn` is one such check for the asking procedures.

## Related Issues

- `docs/solutions/architecture-patterns/adr-0043-what-an-action-is.md` at `2729ebeec`, in the paragraph "Amended 15/10/2026 by the S2b ask plan" for U16 and KTD14, a detail the current ADR no longer holds: a streamed answer sends its status before any call settles, so a ceiling met inside it arrives in a body that answered 200. The spending limit's refusal follows the stream's first event, so it arrives the same way. That is a second reason `refusalAnswering` does not fit it.
- `docs/solutions/architecture-patterns/adr-0016.md`: a refusal ends the stream with no prose, which is why the buffered read ends promptly.
- `docs/solutions/logic-errors/workspace-switch-serves-left-workspace-member-after-failed-reread.md`: the same `route.fetch()` and `route.fulfill` pair, used there to let a call land and then take the page offline, not to read its body.
- `apps/web/.claude/skills/playwright-specs/SKILL.md`: a spec reads the api's answer before `saysARefusal`.
