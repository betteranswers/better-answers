import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Icon } from "@/shared/icon.tsx";
import { Banner, BannerAction, BannerClose, BannerTitle } from "@/shared/ui/kibo-ui/banner.tsx";

import { PASSKEY_WORDS } from "./account-words.ts";
import { passkeysHere, useDismissPasskeyOffer } from "./passkey-hooks.ts";
import { ADD_A_PASSKEY_BUTTON } from "./passkeys-part.tsx";
import { useSecondFactorOnce, type SecondFactor } from "./second-factor-hooks.ts";
import { passkeyOfferShown, rememberThePasskeyOfferShown } from "./session-memory.ts";

const ACCOUNT = "/account";

const offered = (held: SecondFactor | undefined): boolean =>
  held !== undefined && held.passkeys.length === 0 && !held.passkeyOfferDismissed;

/** The page drawn, not the one asked for: a frame being left would draw the offer and spend it. */
const useAddressDrawn = (): string | undefined =>
  useRouterState({ select: (state) => state.matches.at(-1)?.pathname });

/** The address the offer is drawn on, and how the offer says so as it draws. */
export type OfferPlace = {
  readonly heldAt: string | undefined;
  readonly holdAt: (address: string) => void;
};

/** Held by the frame: a workspace's key draws the page beneath it afresh, and the offer with it. */
export const useOfferPlace = (): OfferPlace => {
  const drawn = useAddressDrawn();
  const [heldAt, holdAt] = useState<string>();
  // During render, setting only this hook's own state: any other address ends the offer for good.
  if (heldAt !== undefined && heldAt !== drawn) holdAt(undefined);
  return { heldAt, holdAt };
};

type OfferProperties = { readonly place: OfferPlace; readonly onDismissed: () => void };

/**
 * Offered once per sign-in, on the first page that draws it, to a person holding no passkey. It
 * never takes focus or announces itself.
 */
export function PasskeyOffer(properties: OfferProperties) {
  const [here] = useState(passkeysHere);
  const drawn = useAddressDrawn();
  // Account is where the offer leads, so it is not offered there again.
  if (!here || drawn === undefined || drawn === ACCOUNT) return null;

  // Keyed by the address, so each page arrives asking afresh whether the offer was shown.
  return <OfferOnThisPage key={drawn} address={drawn} {...properties} />;
}

/**
 * Read only where a passkey can be used, so no other browser asks. Only the page that first draws
 * the offer keeps it.
 */
function OfferOnThisPage(properties: OfferProperties & { readonly address: string }) {
  const { address } = properties;
  const { heldAt, holdAt } = properties.place;
  // A page the frame draws again keeps the offer it was showing, whatever the browser's mark says.
  const [owedOnArrival] = useState(() => heldAt === address || !passkeyOfferShown());
  const read = useSecondFactorOnce();
  const dismiss = useDismissPasskeyOffer();
  const offering = owedOnArrival && offered(read.data);

  // Marked as it draws, not as the frame mounts, so a person whose read is slow still sees it once.
  useEffect(() => {
    if (!offering) return;
    rememberThePasskeyOfferShown();
    holdAt(address);
  }, [offering, address, holdAt]);

  if (!offering) return null;

  return (
    <section aria-label={PASSKEY_WORDS.heading} className="px-4 pt-4 md:px-8">
      <Banner className="max-w-page flex-wrap py-2">
        <BannerTitle>{PASSKEY_WORDS.offer}</BannerTitle>
        <BannerAction asChild>
          <Link to={ACCOUNT} hash={ADD_A_PASSKEY_BUTTON}>
            {PASSKEY_WORDS.add}
          </Link>
        </BannerAction>
        <BannerClose
          aria-label={PASSKEY_WORDS.dismissOffer}
          onClick={() => {
            dismiss.mutate();
            properties.onDismissed();
          }}
        >
          <Icon name="remove" />
        </BannerClose>
      </Banner>
    </section>
  );
}
