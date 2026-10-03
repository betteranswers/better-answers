import type { Page } from "@playwright/test";

/**
 * A platform authenticator Chromium holds for the page, through the DevTools protocol: it verifies
 * its user and answers every prompt without one being shown.
 */
export const aVirtualAuthenticator = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    /** The passkeys the device holds, whether or not the platform still keeps them. */
    held: async (): Promise<number> =>
      (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials.length,

    /** A device whose fingerprint, face or PIN check fails. */
    stopsVerifying: () =>
      cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false }),

    /** Its owner away: every prompt waits unanswered, the email field's autofill included. */
    leftUnattended: () =>
      cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: false }),

    attendedAgain: () =>
      cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: true }),
  };
};

/** A browser with no WebAuthn at all, as an old or locked-down one is. */
export const withoutWebAuthn = (page: Page) =>
  page.addInitScript(() => {
    Object.defineProperty(window, "PublicKeyCredential", { value: undefined });
  });
