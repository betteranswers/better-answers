import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { CodeRefused } from "@/features/auth/auth-hooks.ts";
import { usePasskeySignIn } from "@/features/auth/passkey-hooks.ts";

import { addressOf, answered } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const SIGN_IN_OPTIONS = { challenge: "Y2hhbGxlbmdl", userVerification: "required" };

const aByte = (): ArrayBuffer => new Uint8Array([1]).buffer;

const A_CREDENTIAL = {
  id: "a2V5",
  rawId: aByte(),
  type: "public-key",
  response: {
    authenticatorData: aByte(),
    clientDataJSON: aByte(),
    signature: aByte(),
    userHandle: null,
  },
  getClientExtensionResults: () => ({}),
  authenticatorAttachment: "platform",
};

/** The api asks for any passkey, and refuses the one picked as no longer held. */
const passkeyRoutes = (input: string | URL | Request): Promise<Response> =>
  addressOf(input).pathname === "/passkeys/sign-in"
    ? Promise.resolve(Response.json({ error: "passkey-unknown" }, { status: 401 }))
    : answered(SIGN_IN_OPTIONS);

/** A wait still open ends as the browser ends it, when another ceremony starts. */
const waitingUntilAborted = (signal: AbortSignal | null | undefined): Promise<never> =>
  new Promise((_, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    });
  });

/** The person cancels the press's prompt, then picks from the email field the second time. */
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

describe("signing in with a passkey from the email field", () => {
  it("says a refused autofill pick after a cancelled press", async () => {
    const field = document.createElement("input");
    field.setAttribute("autocomplete", "username webauthn");
    document.body.append(field);
    const device = aDevice();
    vi.stubGlobal("fetch", passkeyRoutes);
    vi.stubGlobal(
      "PublicKeyCredential",
      Object.assign(() => undefined, { isConditionalMediationAvailable: async () => true }),
    );
    Object.defineProperty(navigator, "credentials", {
      value: { get: device },
      configurable: true,
    });
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
