import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { DISPLAY_NAME_MAX_CHARACTERS } from "@/shared/member/display-name-words.ts";
import { aPersonNamedWithNoWorkspace, signedInAs } from "@test/signed-in-without-workspace.ts";
import { server } from "@test/stub-server.ts";
import { aRefusalAnswer, openOutsideTheShellAt, read } from "@test/two-workspaces.ts";

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
  const router = await openOutsideTheShellAt("/display-name", api);
  expect(await screen.findByRole("heading", { level: 1, name: "Your Name" })).toBeDefined();
  const field = screen.getByLabelText("Display Name");
  const save = screen.getByRole("button", { name: "Save and Continue" });

  const regions = screen.getAllByRole("alert", { hidden: true });
  expect(regions, "the display-name page stands no refusal region").toHaveLength(1);
  const stood = regions[0];
  expect(stood?.textContent, "the refusal region stands with words already in it").toBe("");

  const bracketed = "Priya <priya@acme.invalid>";
  fireEvent.change(field, { target: { value: bracketed } });
  fireEvent.click(save);

  await waitFor(() => expect(stood?.textContent).toMatch(/< or >/));
  const said = stood?.textContent;
  expect(document.body.textContent, "the page shows the refusal's word").not.toContain(
    "display-name-angle-bracket",
  );
  expect(screen.getByRole("alert"), "the refusal was said in a region of its own").toBe(stood);
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByRole("heading", { level: 1, name: "Your Name" })).toBeDefined();

  const tooLong = "a".repeat(DISPLAY_NAME_MAX_CHARACTERS + 1);
  fireEvent.change(field, { target: { value: tooLong } });
  fireEvent.click(save);

  await waitFor(() =>
    expect(stood?.textContent).toMatch(
      new RegExp(String.raw`\b${String(DISPLAY_NAME_MAX_CHARACTERS)}\b`),
    ),
  );
  expect(stood?.textContent).not.toBe(said);
  expect(document.body.textContent, "the page shows the refusal's word").not.toContain(
    "display-name-too-long",
  );

  fireEvent.change(field, { target: { value: "Priya Shah" } });
  fireEvent.click(save);

  await waitFor(() => expect(router.state.location.pathname).toBe("/no-workspace"));
  expect(await screen.findByRole("heading", { level: 1, name: "No Workspace Yet" })).toBeDefined();
  expect(saved()).toEqual([
    { displayName: bracketed },
    { displayName: tooLong },
    { displayName: "Priya Shah" },
  ]);
});
