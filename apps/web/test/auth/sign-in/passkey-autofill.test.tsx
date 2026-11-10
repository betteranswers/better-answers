import { act, cleanup, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { CodeRefused } from "@/features/auth/auth-hooks.ts";
import { usePasskeySignIn } from "@/features/auth/passkey-hooks.ts";
import { SIGN_IN_WORDS } from "@/features/auth/sign-in/sign-in-words.ts";
import { openApp } from "@test/open-app.tsx";
import { A_CHALLENGE, A_CREDENTIAL } from "@test/second-factor-api.ts";
import { server, type Asked } from "@test/stub-server.ts";
import { addressOf, answered } from "@test/stubbed-api.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const passkeyRoutes = (input: string | URL | Request): Promise<Response> =>
  addressOf(input).pathname === "/passkeys/sign-in"
    ? Promise.resolve(Response.json({ error: "passkey-unknown" }, { status: 401 }))
    : answered(A_CHALLENGE);

const waitingUntilAborted = (signal: AbortSignal | null | undefined): Promise<never> =>
  new Promise((_, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    });
  });

const aDevice = () => {
  let autofills = 0;
  return vi.fn<(options: CredentialRequestOptions) => Promise<unknown>>((options) => {
    if (options.mediation !== "conditional") {
      return Promise.reject(new DOMException("cancelled", "NotAllowedError"));
    }
    autofills += 1;
    return autofills === 1 ? waitingUntilAborted(options.signal) : Promise.resolve(A_CREDENTIAL);
  });
};

const wrapper = (properties: { readonly children: ReactNode }) => (
  <Providers clients={createAppClients()}>{properties.children}</Providers>
);

const withAConditionalDevice = (
  device: (options: CredentialRequestOptions) => Promise<unknown>,
) => {
  vi.stubGlobal(
    "PublicKeyCredential",
    Object.assign(() => undefined, { isConditionalMediationAvailable: async () => true }),
  );
  Object.defineProperty(navigator, "credentials", {
    value: { get: device },
    configurable: true,
  });
};

describe("signing in with a passkey from the email field", () => {
  it("reports a refused autofill passkey after a cancelled press", async () => {
    const field = document.createElement("input");
    field.setAttribute("autocomplete", "username webauthn");
    document.body.append(field);
    const device = aDevice();
    vi.stubGlobal("fetch", passkeyRoutes);
    withAConditionalDevice(device);
    const { result } = renderHook(() => usePasskeySignIn(true, () => undefined), { wrapper });
    await waitFor(() => {
      expect(device).toHaveBeenCalledOnce();
    });

    act(() => {
      result.current.signIn();
    });

    await waitFor(() => {
      expect(result.current.failure).toBeInstanceOf(CodeRefused);
    });
    expect(result.current.failure).toMatchObject({ word: "passkey-unknown" });
  });
});

const ADDRESS = "ada@example.test";

const NOTHING_GIVEN = () => Promise.resolve(null);

const aDevicePressedAs = (...presses: readonly (() => Promise<null>)[]) => {
  const waiting = [...presses];
  return vi.fn<(options: CredentialRequestOptions) => Promise<unknown>>((options) =>
    options.mediation === "conditional"
      ? waitingUntilAborted(options.signal)
      : (waiting.shift() ?? NOTHING_GIVEN)(),
  );
};

const onlyThePasskeyOptions = (asked: Asked): Promise<Response> =>
  addressOf(asked).pathname === "/passkeys/sign-in-options"
    ? answered(A_CHALLENGE)
    : Promise.resolve(Response.json(null));

describe("signing in with a passkey from the email step", () => {
  it("a cancelled passkey prompt leaves the email step unchanged", async () => {
    const prompt = Promise.withResolvers<null>();
    const device = aDevicePressedAs(() => prompt.promise, NOTHING_GIVEN);
    server.answer = onlyThePasskeyOptions;
    withAConditionalDevice(device);
    const user = userEvent.setup();
    await openApp("/sign-in");
    const field = await screen.findByLabelText(SIGN_IN_WORDS.emailAddress);
    await user.type(field, ADDRESS);
    const press = screen.getByRole("button", { name: SIGN_IN_WORDS.passkey });
    const alert = () => screen.getByRole("alert", { hidden: true });

    await user.click(press);

    await waitFor(() => {
      expect(press.getAttribute("aria-disabled")).toBe("true");
    });
    expect(press, "the passkey button is natively disabled, which drops its focus").toHaveProperty(
      "disabled",
      false,
    );
    expect(document.activeElement).toBe(press);

    prompt.reject(new DOMException("cancelled", "NotAllowedError"));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/\S/u);
    });
    expect(press.getAttribute("aria-disabled")).toBe("false");
    expect(alert().textContent, "a cancelled passkey prompt showed an alert").toBe("");
    expect(field).toHaveProperty("value", ADDRESS);
    expect(document.activeElement, "focus left the passkey button").toBe(press);

    await user.click(press);

    await waitFor(() => {
      expect(alert().textContent).toMatch(/\S/u);
    });
    expect(field).toHaveProperty("value", ADDRESS);
  });
});
