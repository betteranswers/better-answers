import type { Page } from "@playwright/test";

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
    held: async (): Promise<number> =>
      (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials.length,

    stopsVerifying: () =>
      cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false }),

    leftUnattended: () =>
      cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: false }),

    attendedAgain: () =>
      cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: true }),
  };
};
