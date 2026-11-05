import { RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, assert, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { openApp } from "@test/open-app.tsx";
import { server } from "@test/stub-server.ts";
import { addressOf } from "@test/stubbed-api.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

afterEach(() => {
  cleanup();
  localStorage.clear();
  globalThis.history.replaceState(null, "", "/");
});

const SEND = "/email-otp/send-verification-otp";

const SIGN_IN = "/sign-in/email-otp";

const ADDRESS = "ada@example.test";

const sent = () => Response.json({ success: true });

const askedTooOften = (waitSeconds: number) => () =>
  Response.json(
    { code: "TOO_MANY_REQUESTS", message: "Too many requests" },
    { status: 429, headers: { "retry-after": String(waitSeconds) } },
  );

const refused = (code: string) => () => Response.json({ code, message: code }, { status: 400 });

const wire = (answers: Readonly<Record<string, () => Response>>) => {
  const asked = new Map<string, number>();
  server.answer = (input) => {
    const { pathname } = addressOf(input);
    asked.set(pathname, (asked.get(pathname) ?? 0) + 1);
    return Promise.resolve(answers[pathname]?.() ?? Response.json(null));
  };
  return (path: string): number => asked.get(path) ?? 0;
};

const triesLeft = (left: number): RegExp => new RegExp(String.raw`\b${String(left)}\b`);

const refusal = () => screen.getByRole("alert").textContent;

const addressTyped = async (): Promise<HTMLInputElement> => {
  const field = await screen.findByLabelText("Email Address");
  if (!(field instanceof HTMLInputElement)) {
    throw new Error("the Email Address label does not point to an input");
  }
  field.focus();
  fireEvent.change(field, { target: { value: ADDRESS } });
  return field;
};

const sendTheFirstCode = async () => {
  await addressTyped();
  fireEvent.click(screen.getByRole("button", { name: "Send Code" }));
};

/** jsdom does not submit a form on Enter, so the test submits the field's form directly. */
const pressEnterInTheEmailField = async () => {
  const { form } = await addressTyped();
  if (form === null) throw new Error("the email field is not inside a form");
  fireEvent.submit(form);
};

const codeField = async (): Promise<HTMLInputElement> => {
  const field = await screen.findByLabelText("Verification Code", { exact: true });
  if (!(field instanceof HTMLInputElement)) {
    throw new Error("the Verification Code label does not point to an input");
  }
  return field;
};

const openAtTheAddressBar = async (address: string) => {
  globalThis.history.replaceState(null, "", address);
  const clients = createAppClients();
  const router = createAppRouter(clients);
  await router.load();
  render(
    <Providers clients={clients}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return router;
};

const inDocumentOrder = (...elements: readonly HTMLElement[]): boolean =>
  elements.every(
    (element, at) =>
      at === 0 ||
      ((elements[at - 1]?.compareDocumentPosition(element) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
  );

it("shows a join heading when signing in from an invitation", async () => {
  wire({});
  const router = await openAtTheAddressBar("/invitations/01JINVITED00000000000000A");

  expect(
    await screen.findByRole("heading", { level: 1, name: "Sign In to Join a Workspace" }),
  ).toBeDefined();
  expect(router.state.location.pathname).toBe("/sign-in");
  expect(globalThis.location.search).toMatch(/^\?redirect=/);
  const main = within(screen.getByRole("main"));
  const [hint] = main.getAllByRole("paragraph");
  assert(hint !== undefined, "the email step has no hint under its heading");
  expect(hint.textContent).toMatch(/\S/u);
  expect(
    inDocumentOrder(
      main.getByRole("heading", { level: 1 }),
      hint,
      main.getByRole("textbox", { name: "Email Address" }),
      main.getByRole("button", { name: "Send Code" }),
    ),
  ).toBe(true);
});

it("shows a Claude heading when signing in to connect Claude", async () => {
  wire({});
  const carried = new URLSearchParams({
    response_type: "code",
    client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
    state: "state-from-the-host",
    exp: "4102444800",
    sig: "signed-by-the-api",
  });

  await openAtTheAddressBar(`/sign-in?${carried.toString()}`);

  expect(
    await screen.findByRole("heading", { level: 1, name: "Sign In to Connect Claude" }),
  ).toBeDefined();
});

it("announces a sent code in the existing status region", async () => {
  wire({ [SEND]: sent });
  await openApp("/sign-in");
  expect(await screen.findByRole("heading", { level: 1, name: "Sign In" })).toBeDefined();

  const said = screen.getAllByRole("status", { hidden: true });
  const alerts = screen.getAllByRole("alert", { hidden: true });
  expect(said, "the sign-in page does not have exactly one status region").toHaveLength(1);
  expect(said[0]?.textContent, "the status region holds words before anything happened").toBe("");
  expect(alerts, "the sign-in page does not have exactly one alert region").toHaveLength(1);
  expect(alerts[0]?.textContent, "the alert region holds words before anything happened").toBe("");
  const statusBefore = said[0];

  await pressEnterInTheEmailField();

  await waitFor(() => expect(screen.getByRole("status").textContent).toContain(ADDRESS));
  expect(
    screen.getByRole("status"),
    "the code step announced the code in a new status region",
  ).toBe(statusBefore);
  const refusals = screen.getAllByRole("alert", { hidden: true });
  expect(refusals, "the code step does not have exactly one alert region").toHaveLength(1);
  expect(
    refusals[0]?.textContent,
    "the code step's alert region holds words before a refusal",
  ).toBe("");
  expect(document.activeElement, "the code field does not have focus after sending").toBe(
    await codeField(),
  );
});

it("selects a wrong code and counts the tries left", async () => {
  const asked = wire({ [SEND]: sent, [SIGN_IN]: refused("INVALID_OTP") });
  await openApp("/sign-in");
  await sendTheFirstCode();
  const field = await codeField();

  fireEvent.change(field, { target: { value: "000001" } });

  await waitFor(() => expect(refusal()).toMatch(triesLeft(2)));
  expect(document.activeElement).toBe(field);
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect([field.selectionStart, field.selectionEnd], "the refused digits are not selected").toEqual(
    [0, 6],
  );

  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
  fireEvent.change(field, { target: { value: "000002" } });

  await waitFor(() => expect(refusal()).toMatch(triesLeft(1)));
  expect(asked(SIGN_IN), "the refused code was sent again").toBe(2);
});

it("names the wait after too many code requests", async () => {
  const asked = wire({ [SEND]: askedTooOften(61) });
  await openApp("/sign-in");

  await sendTheFirstCode();

  await waitFor(() => expect(refusal()).toMatch(/\b2 minutes\b/));
  expect(asked(SEND)).toBe(1);
  expect(
    screen.getByRole("heading", { level: 1, name: "Sign In" }),
    "a refused send left the email step",
  ).toBeDefined();
  expect(screen.queryByLabelText("Verification Code", { exact: true })).toBeNull();
});

it("an expired code moves focus to Send a New Code", async () => {
  const asked = wire({ [SEND]: sent, [SIGN_IN]: refused("OTP_EXPIRED") });
  await openApp("/sign-in");
  await sendTheFirstCode();
  const field = await codeField();
  await waitFor(() => expect(document.activeElement).toBe(field));

  fireEvent.change(field, { target: { value: "000001" } });

  await waitFor(() => expect(refusal()).toMatch(/\S/u));
  expect(refusal(), "an expired code still counts tries left").not.toMatch(/\d/u);
  const another = screen.getByRole("button", { name: "Send a New Code" });
  expect(document.activeElement, "Send a New Code does not have focus").toBe(another);

  fireEvent.click(another);

  await waitFor(() => expect(asked(SEND)).toBe(2));
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(field.value, "the code field still holds the expired digits").toBe("");
});
