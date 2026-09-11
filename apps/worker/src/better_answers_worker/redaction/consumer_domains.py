"""The email domains this repository reads as a consumer provider's, and when it did.

An email address is personal contact when the mailbox behind it is a person's own, and
the domain is what tells that apart from the rest: a supplier's owner writes from a
provider anybody may open an account with, and the same supplier's bid team writes from
the company. Without the distinction every address in a bid library is withheld, the
corporate ones included, and a reader entitled to the supplier's own contact details
loses them to a rule that exists to protect a person.

**This is a judgement and not a register.** Nobody publishes "the consumer email
providers of the United Kingdom", so what is below is this repository's reading of the
providers a British small business's people actually write from, settled on the date
``READ_ON`` names and against the pages ``SOURCE`` names. The pages are only where each
provider says which domains it issues a mailbox on; which of those providers count as
consumer is ours to say and is dated for that reason. The list is deliberately short
and deliberately British: an owner is on ``hotmail.co.uk`` far more often than on
``hotmail.com``. A domain missing from it is an address left in the text, which is the
direction the list is built to fail in.

**The list is part of the rule.** Editing it changes what the seam withholds exactly as
editing a recogniser does, so an edit here is a bump of ``RULE_VERSION`` in ``pins.py``
and a re-baseline of every finding written under the old one. The descriptor suite
holds a digest over these domains beside the one it holds over the category table, so
the list and the version cannot move apart without the suite going red.

**A domain closed to new sign-ups is still on it.** Microsoft reserved ``hotmail.co.uk``
and Yahoo withdrew ``ymail.com`` and ``yahoo.co.uk``, and the mailboxes issued on them
before that is what a bid library is full of — the owner who has written from the same
address for fifteen years is the case this rule exists for. What decides membership is
whether a consumer mailbox is or ever was issued on the domain, never whether one can
be opened there today.

**The match is exact on the domain, case-folded.** ``mail.gmail.com`` is not on the list
and is not meant to be: a subdomain of a consumer provider is not a mailbox a consumer
is given, and reading one as a person's own would put the machine-generated addresses
that live under such subdomains into the tier a person's own address is withheld under.
Case folding is because a domain is case-insensitive by the standard that defines it,
so an address a document happens to have shouted is the same address.
"""

#: The day this list was settled and every page below read.
READ_ON = "2026-09-11"

#: Where each family says which domains it issues a consumer mailbox on: the provider's
#: own sign-up page where a mailbox can still be opened, its own help page where the
#: domains are named there instead, and the provider's own site where the mailbox
#: arrives with a broadband account and is signed up for nowhere.
SOURCE: tuple[str, ...] = (
    "Google — gmail.com, googlemail.com: https://accounts.google.com/signup",
    "Microsoft — outlook.com, hotmail.com, hotmail.co.uk, live.com, live.co.uk:"
    " https://signup.live.com",
    "Yahoo — yahoo.com, yahoo.co.uk, ymail.com:"
    " https://uk.help.yahoo.com/kb/SLN2153.html",
    "Apple — icloud.com, me.com: https://account.apple.com",
    "Proton — proton.me, protonmail.com: https://account.proton.me/signup",
    "GMX — gmx.com, gmx.co.uk: https://www.gmx.co.uk",
    "AOL — aol.com, aol.co.uk: https://login.aol.com/account/create",
    "BT — btinternet.com: https://www.bt.com",
    "Sky — sky.com: https://www.sky.com",
    "Virgin Media — virginmedia.com: https://www.virginmedia.com",
)

#: The domains themselves, written out in full rather than as the labels a provider is
#: spoken of by, because what an address carries is a domain and a rule that matched a
#: label would match every domain that ends in one.
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
        "me.com",
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
    """Whether an email address sits on a domain this repository reads as a consumer's.

    The domain is everything after the last ``@`` rather than after the first, because
    a local part is allowed to hold one when it is quoted and the mailbox is decided by
    the last.
    """
    _, separator, domain = address.rpartition("@")
    return bool(separator) and domain.casefold() in CONSUMER_DOMAINS
