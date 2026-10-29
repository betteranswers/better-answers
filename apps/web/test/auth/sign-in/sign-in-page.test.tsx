import { RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { SIGN_IN_WORDS } from "@/features/auth/sign-in/sign-in-words.ts";
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

const refused = (code: string) => () => Response.json({ code, message: code }, { status: 400 });

/** Anything the page asks that is not named here is answered as a person who is signed out. */
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
  if (!(field instanceof HTMLInputElement)) throw new Error("the email field is no input");
  field.focus();
  fireEvent.change(field, { target: { value: ADDRESS } });
  return field;
};

const sendTheFirstCode = async () => {
  await addressTyped();
  fireEvent.click(screen.getByRole("button", { name: "Send Code" }));
};

/** jsdom turns no Enter into a submit, so the form the field sits in is submitted instead. */
const enterPressedInTheAddress = async () => {
  const { form } = await addressTyped();
  if (form === null) throw new Error("the email field sits in no form");
  fireEvent.submit(form);
};

const codeField = async (): Promise<HTMLInputElement> => {
  const field = await screen.findByLabelText("Verification Code", { exact: true });
  if (!(field instanceof HTMLInputElement)) throw new Error("the code field is no input");
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

const rowOf = (button: HTMLElement): HTMLElement => {
  const row = button.parentElement;
  if (row === null) throw new Error("the code step draws no row of actions");
  return row;
};

const inDocumentOrder = (...drawn: readonly HTMLElement[]): boolean =>
  drawn.every(
    (element, at) =>
      at === 0 ||
      ((drawn[at - 1]?.compareDocumentPosition(element) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
  );

it("draws a row of secondary actions in one treatment", async () => {
  wire({ [SEND]: sent });
  await openApp("/sign-in");
  await sendTheFirstCode();
  await codeField();
  expect(screen.getByRole("status").textContent, "the page says nothing of the email").toMatch(
    /\S/,
  );

  const treatments = within(rowOf(screen.getByRole("button", { name: "Send a New Code" })))
    .getAllByRole("button")
    .map((button) => button.dataset["variant"]);

  expect([...new Set(treatments)], "the row mixes its treatments").toEqual(["outline"]);
});

it("names joining a workspace when sign-in carries an invitation", async () => {
  wire({});
  const router = await openAtTheAddressBar("/invitations/01JINVITED00000000000000A");

  expect(
    await screen.findByRole("heading", { level: 1, name: "Sign In to Join a Workspace" }),
  ).toBeDefined();
  expect(router.state.location.pathname).toBe("/sign-in");
  expect(globalThis.location.search).toMatch(/^\?redirect=/);
  const main = within(screen.getByRole("main"));
  expect(
    inDocumentOrder(
      main.getByRole("heading", { level: 1 }),
      main.getByText(SIGN_IN_WORDS.emailStep.joining.hint),
      main.getByRole("textbox", { name: "Email Address" }),
      main.getByRole("button", { name: "Send Code" }),
    ),
  ).toBe(true);
});

it("names connecting Claude when sign-in carries Claude's request", async () => {
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

it("announces a sent code in the standing region, keeping focus", async () => {
  wire({ [SEND]: sent });
  await openApp("/sign-in");
  expect(await screen.findByRole("heading", { level: 1, name: "Sign In" })).toBeDefined();

  const said = screen.getAllByRole("status", { hidden: true });
  const alerts = screen.getAllByRole("alert", { hidden: true });
  expect(said, "the sign-in page stands no status region").toHaveLength(1);
  expect(said[0]?.textContent, "the status region stands with words already in it").toBe("");
  expect(alerts, "the sign-in page stands no alert region").toHaveLength(1);
  expect(alerts[0]?.textContent, "the alert region stands with words already in it").toBe("");
  const stood = said[0];

  await enterPressedInTheAddress();

  await waitFor(() => expect(screen.getByRole("status").textContent).toContain(ADDRESS));
  expect(
    screen.getByRole("status"),
    "the code step said the code went in a status region of its own",
  ).toBe(stood);
  const refusals = screen.getAllByRole("alert", { hidden: true });
  expect(refusals, "the code step stood an alert region of its own").toHaveLength(1);
  expect(refusals[0]?.textContent, "the code step's alert region holds words").toBe("");
  expect(document.activeElement, "sending the code took focus from the field").toBe(
    await codeField(),
  );
});

it("sends a wrong code once, selected, naming two tries left", async () => {
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

  fireEvent.click(screen.getByRole("button", { name: SIGN_IN_WORDS.signIn }));
  fireEvent.change(field, { target: { value: "000002" } });

  await waitFor(() => expect(refusal()).toMatch(triesLeft(1)));
  expect(asked(SIGN_IN), "the refused code was sent again").toBe(2);
});
