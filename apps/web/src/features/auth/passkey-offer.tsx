import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Icon } from "@/shared/icon.tsx";
import { Banner, BannerAction, BannerClose, BannerTitle } from "@/shared/ui/kibo-ui/banner.tsx";

import { PASSKEY_WORDS } from "./account-words.ts";
import { passkeysHere, useDismissPasskeyOffer } from "./passkey-hooks.ts";
import { ADD_A_PASSKEY_BUTTON } from "./passkeys-part.tsx";
import { useSecondFactor, type SecondFactor } from "./second-factor-hooks.ts";

const offered = (held: SecondFactor | undefined): boolean =>
  held !== undefined && held.passkeys.length === 0 && !held.passkeyOfferDismissed;

type OfferProperties = { readonly onDismissed: () => void };

/**
 * Offered once, above a frame's toolbar, to a person holding no passkey. It never takes focus or
 * announces itself as it arrives.
 */
export function PasskeyOffer(properties: OfferProperties) {
  const [here] = useState(passkeysHere);
  return here ? <OfferWhereHeld {...properties} /> : null;
}

/** Read only where the browser can use a passkey, so no other browser asks. */
function OfferWhereHeld(properties: OfferProperties) {
  const read = useSecondFactor();
  const dismiss = useDismissPasskeyOffer();
  if (!offered(read.data)) return null;

  return (
    <section aria-label={PASSKEY_WORDS.heading} className="px-4 pt-4 md:px-8">
      <Banner className="max-w-page flex-wrap py-2">
        <BannerTitle>{PASSKEY_WORDS.offer}</BannerTitle>
        <BannerAction asChild>
          <Link to="/account" hash={ADD_A_PASSKEY_BUTTON}>
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
