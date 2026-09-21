READ_ON = "2026-09-11"


SOURCE: tuple[str, ...] = (
    "Google — gmail.com, googlemail.com: https://accounts.google.com/signup",
    "Microsoft — outlook.com, hotmail.com, hotmail.co.uk, live.com, live.co.uk,"
    " msn.com: https://signup.live.com",
    "Yahoo — yahoo.com, yahoo.co.uk, ymail.com, myyahoo.com:"
    " https://uk.help.yahoo.com/kb/SLN2153.html",
    "Apple — icloud.com, me.com, mac.com: https://account.apple.com",
    "Proton — proton.me, protonmail.com: https://account.proton.me/signup",
    "GMX — gmx.com, gmx.co.uk: https://www.gmx.co.uk",
    "AOL — aol.com, aol.co.uk: https://login.aol.com/account/create",
    "BT — btinternet.com: https://www.bt.com",
    "Sky — sky.com: https://www.sky.com",
    "Virgin Media — virginmedia.com: https://www.virginmedia.com",
)


CONSUMER_DOMAINS: frozenset[str] = frozenset(
    {
        "aol.co.uk",
        "aol.com",
        "btinternet.com",
        "gmail.com",
        "gmx.co.uk",
        "gmx.com",
        "googlemail.com",
        "hotmail.co.uk",
        "hotmail.com",
        "icloud.com",
        "live.co.uk",
        "live.com",
        "mac.com",
        "me.com",
        "msn.com",
        "myyahoo.com",
        "outlook.com",
        "proton.me",
        "protonmail.com",
        "sky.com",
        "virginmedia.com",
        "yahoo.co.uk",
        "yahoo.com",
        "ymail.com",
    }
)


def is_a_consumer_address(address: str) -> bool:
    _, separator, domain = address.rpartition("@")
    return bool(separator) and domain.casefold() in CONSUMER_DOMAINS
