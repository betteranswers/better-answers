import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { NO_WORKSPACE_HEADING } from "@/features/auth/workspace/workspace-words.ts";
import {
  DISPLAY_NAME_MAX_CHARACTERS,
  DISPLAY_NAME_WORDS,
} from "@/shared/member/display-name-words.ts";
import { aPersonNamedWithNoWorkspace, signedInAs } from "@test/signed-in-without-workspace.ts";
import { server } from "@test/stub-server.ts";
import { aRefusalAnswer, openPageOutsideShell, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const saved = () =>
  server.asks.filter((ask) => ask.procedure === "person.setDisplayName").map((ask) => ask.input);

it("says what to change in a bad name, then saves", async () => {
  const api = aPersonNamedWithNoWorkspace("");
  const answers = [
    () => aRefusalAnswer("display-name-angle-bracket", "malformed", 400),
    () => aRefusalAnswer("display-name-too-long", "malformed", 400),
    () => {
      api.set("/get-session", () => signedInAs("Priya Shah"));
      return read({});
    },
  ];
  api.set("person.setDisplayName", () => answers.shift()?.());
  const router = await openPageOutsideShell("/display-name", api);
  expect(
    await screen.findByRole("heading", { level: 1, name: DISPLAY_NAME_WORDS.heading }),
  ).toBeDefined();
  const field = screen.getByLabelText(DISPLAY_NAME_WORDS.label);
  const save = screen.getByRole("button", { name: DISPLAY_NAME_WORDS.save });

  const regions = screen.getAllByRole("alert", { hidden: true });
  expect(regions, "the display-name page does not have exactly one alert region").toHaveLength(1);
  const alertBefore = regions[0];
  expect(alertBefore?.textContent, "the alert region holds words before a refusal").toBe("");

  const bracketed = "Priya <priya@acme.invalid>";
  fireEvent.change(field, { target: { value: bracketed } });
  fireEvent.click(save);

  await waitFor(() => expect(alertBefore?.textContent).toMatch(/\S/u));
  const said = alertBefore?.textContent;
  expect(document.body.textContent, "the page shows the refusal's word").not.toContain(
    "display-name-angle-bracket",
  );
  expect(screen.getByRole("alert"), "the refusal appeared in a new alert region").toBe(alertBefore);
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByRole("heading", { level: 1, name: DISPLAY_NAME_WORDS.heading })).toBeDefined();

  const tooLong = "a".repeat(DISPLAY_NAME_MAX_CHARACTERS + 1);
  fireEvent.change(field, { target: { value: tooLong } });
  fireEvent.click(save);

  await waitFor(() =>
    expect(alertBefore?.textContent).toMatch(
      new RegExp(String.raw`\b${String(DISPLAY_NAME_MAX_CHARACTERS)}\b`),
    ),
  );
  expect(alertBefore?.textContent).not.toBe(said);
  expect(document.body.textContent, "the page shows the refusal's word").not.toContain(
    "display-name-too-long",
  );

  fireEvent.change(field, { target: { value: "Priya Shah" } });
  fireEvent.click(save);

  await waitFor(() => expect(router.state.location.pathname).toBe("/no-workspace"));
  expect(
    await screen.findByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING }),
  ).toBeDefined();
  expect(saved()).toEqual([
    { displayName: bracketed },
    { displayName: tooLong },
    { displayName: "Priya Shah" },
  ]);
});
