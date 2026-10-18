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

const useAddressDrawn = (): string | undefined =>
  useRouterState({ select: (state) => state.matches.at(-1)?.pathname });

export type OfferPlace = {
  readonly heldAt: string | undefined;
  readonly holdAt: (address: string) => void;
};

export const useOfferPlace = (): OfferPlace => {
  const drawn = useAddressDrawn();
  const [heldAt, holdAt] = useState<string>();
  if (heldAt !== undefined && heldAt !== drawn) holdAt(undefined);
  return { heldAt, holdAt };
};

type OfferProperties = { readonly place: OfferPlace; readonly onDismissed: () => void };

export function PasskeyOffer(properties: OfferProperties) {
  const [here] = useState(passkeysHere);
  const drawn = useAddressDrawn();
  if (!here || drawn === undefined || drawn === ACCOUNT) return null;

  return <OfferOnThisPage key={drawn} address={drawn} {...properties} />;
}

function OfferOnThisPage(properties: OfferProperties & { readonly address: string }) {
  const { address } = properties;
  const { heldAt, holdAt } = properties.place;
  const [owedOnArrival] = useState(() => heldAt === address || !passkeyOfferShown());
  const read = useSecondFactorOnce();
  const dismiss = useDismissPasskeyOffer();
  const offering = owedOnArrival && offered(read.data);

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
