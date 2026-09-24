from collections.abc import Mapping, Sequence

import pytest

from better_answers_worker.redaction import Dismissal, Redaction, Restore, redact
from better_answers_worker.redaction.engine import Finding, Span, spans_detected
from better_answers_worker.redaction.pins import VERSION_STRING
from better_answers_worker.redaction.withholdings import (
    AN_ERASURE,
    IN_FORCE,
    OVERRIDDEN_BY_THE_ERASURE,
    RESTORED,
    SWITCHED_OFF,
    Withholding,
    WrittenSpan,
    overridden_in,
)
from planted_page import (
    A_CONSUMER_ADDRESS,
    A_HEALTH_AND_SAFETY_SENTENCE,
    A_HEALTH_SENTENCE,
    A_PLANTED_JOB_TITLE,
    A_VERB_FORM_HEALTH_SENTENCE,
    AN_ADDRESS_AROUND_A_NAME,
    AN_ENGINEERING_DIAGNOSIS,
    FINDINGS_BY_CATEGORY,
    FIXTURE_PAGE,
    PLANTED_SPANS,
    SERVICE_NOTES_PAGE,
    THE_DIAGNOSED_SENTENCE_AT,
    THE_ENGINEERS_SENTENCE_AT,
    the_engineers_section,
    typed_placeholders_under,
)

THE_SAFE_SET: Mapping[str, bool] = {"default_on": True, "default_off": False}


NOTHING_SWITCHABLE: Mapping[str, bool] = {"default_on": False, "default_off": False}


AN_HR_SHAPED_BINDING: Mapping[str, bool] = {"default_on": True, "default_off": True}


NO_SUPPRESSIONS: Sequence[Mapping[str, Sequence[str]]] = ()
SEED = "b0f3a1d2c4e5"


ANOTHER_SEED = "7c1e9b04af62"


LETTERS_UNDER_SEED: Mapping[str, str] = {
    "Rosalind Petheridge": "U",
    "Callum Whitcombe": "E",
    "Imogen Sarkar": "Y",
}
LETTERS_UNDER_ANOTHER_SEED: Mapping[str, str] = {
    "Rosalind Petheridge": "Q",
    "Callum Whitcombe": "R",
    "Imogen Sarkar": "X",
}


ONE_NAME_SUPPRESSED: Sequence[Mapping[str, Sequence[str]]] = (
    {"emails": (), "names": ("Rosalind Petheridge",), "other": ()},
)


A_COMPANY_ADDRESS = "callum.whitcombe@meridianfenland.co.uk"


A_FOURTH_OFFICER = "Oliver Denbigh"


A_STREET_AND_ITS_POSTCODE: tuple[str, ...] = ("9 Kestrel Lane", "LS22 4TD")


BARE_DATES: tuple[str, ...] = ("14 March 2024", "2 June 2023", "19 September 2023")


DATE_IN_CONTEXT = "3 February 1978"


FENCED_SORT_CODE = "00-00-99 ACCOUNT=87654321"


UNDER_ITS_OWN_PLACEHOLDER = "its-own-placeholder"


UNDER_ANOTHER_FINDINGS_PLACEHOLDER = "another-findings-placeholder"


NOT_WRITTEN_AT_ALL = "not-at-all"


A_PARTIAL_OVERLAP = "Write to 12 Acacia Avenue, Leeds LS1 4AB tel 0113 496 0000 today"


AN_ADDRESS_THE_BANK_RULE_RAN_INTO = (
    "Pay Imogen Sarkar, 12 Acacia Avenue, Leeds LS1 4AB 20-45-77 41234567 today"
)


def span_over(text: str, rule_id: str, run: str) -> Span:
    start = text.index(run)
    return Span(rule_id=rule_id, start=start, end=start + len(run), score=0.9)


def redacted_over(
    text: str, claims: Sequence[tuple[str, str]], rules_in_force: Mapping[str, bool]
) -> Redaction:
    spans = tuple(span_over(text, rule_id, run) for rule_id, run in claims)
    return redact(text, spans, rules_in_force, NO_SUPPRESSIONS, SEED)


def written_runs(found: Redaction, text: str) -> list[tuple[str, str]]:
    return [
        (text[span.start : span.end], span.withholding.finding.rule_id)
        for span in found.written_spans
    ]


@pytest.fixture(scope="module")
def page() -> str:
    return FIXTURE_PAGE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def spans(page: str) -> tuple[Span, ...]:
    return spans_detected(page)


@pytest.fixture(scope="module")
def on_a_plain_binding(page: str, spans: tuple[Span, ...]) -> Redaction:
    return redact(page, spans, THE_SAFE_SET, NO_SUPPRESSIONS, SEED)


@pytest.fixture(scope="module")
def with_nothing_switchable_on(page: str, spans: tuple[Span, ...]) -> Redaction:
    return redact(page, spans, NOTHING_SWITCHABLE, NO_SUPPRESSIONS, SEED)


@pytest.fixture(scope="module")
def on_an_hr_shaped_binding(page: str, spans: tuple[Span, ...]) -> Redaction:
    return redact(page, spans, AN_HR_SHAPED_BINDING, NO_SUPPRESSIONS, SEED)


@pytest.fixture(scope="module")
def under_another_seed(page: str, spans: tuple[Span, ...]) -> Redaction:
    return redact(page, spans, AN_HR_SHAPED_BINDING, NO_SUPPRESSIONS, ANOTHER_SEED)


@pytest.fixture(scope="module")
def with_one_name_suppressed(page: str, spans: tuple[Span, ...]) -> Redaction:
    return redact(page, spans, AN_HR_SHAPED_BINDING, ONE_NAME_SUPPRESSED, SEED)


@pytest.fixture(scope="module")
def with_a_partial_overlap() -> Redaction:
    claims = (
        ("UK_HOME_ADDRESS", "12 Acacia Avenue, Leeds LS1 4AB"),
        ("PHONE_NUMBER", "LS1 4AB tel 0113 496 0000"),
    )
    return redacted_over(A_PARTIAL_OVERLAP, claims, THE_SAFE_SET)


def spans_under(found: Redaction, page: str, category: str) -> list[str]:
    return [
        page[finding.start : finding.end]
        for finding in found.findings
        if finding.category == category
    ]


def officers_block(text: str) -> str:
    opened = text.index("## Persons with significant control")
    return text[opened : text.index("## Finance", opened)]


def past_the_officers_block(text: str) -> str:
    return text[text.index("## Finance") :]


def tiers_of(found: Redaction, page: str, span: str) -> set[str]:
    return {
        finding.tier
        for finding in found.findings
        if page[finding.start : finding.end] == span
    }


def withholdings_over(found: Redaction, page: str, span: str) -> list[Withholding]:
    return [
        withholding
        for withholding in found.withholdings
        if page[withholding.finding.start : withholding.finding.end] == span
    ]


def withheld_tiers_of(found: Redaction, page: str, span: str) -> set[str]:
    return {withholding.tier for withholding in withholdings_over(found, page, span)}


def reasons_over(found: Redaction, page: str, span: str) -> set[str]:
    return {withholding.reason for withholding in withholdings_over(found, page, span)}


def written_over(found: Redaction, offset: int) -> list[WrittenSpan]:
    return [span for span in found.written_spans if span.start <= offset < span.end]


def how_written(found: Redaction, withholding: Withholding) -> str:
    if any(span.withholding == withholding for span in found.written_spans):
        return UNDER_ITS_OWN_PLACEHOLDER
    finding = withholding.finding
    if all(written_over(found, offset) for offset in range(finding.start, finding.end)):
        return UNDER_ANOTHER_FINDINGS_PLACEHOLDER
    return NOT_WRITTEN_AT_ALL


def test_every_span_is_cut_back_out_of_the_text_by_the_offsets_it_came_with(
    on_a_plain_binding: Redaction, page: str
) -> None:

    for category, planted in PLANTED_SPANS:
        assert planted in spans_under(on_a_plain_binding, page, category), (
            f"{category}: {planted!r} was not cut back out of the page"
        )


def test_the_recall_set_is_found_in_full(on_a_plain_binding: Redaction) -> None:

    counts = on_a_plain_binding.counts

    assert {
        category: counts.get(category, 0) for category in FINDINGS_BY_CATEGORY
    } == dict(FINDINGS_BY_CATEGORY)


def test_every_finding_names_the_tier_its_category_is_raised_at(
    on_a_plain_binding: Redaction,
) -> None:
    raised = {
        (finding.category, finding.tier) for finding in on_a_plain_binding.findings
    }

    assert ("special-category", "always") in raised
    assert ("bank-details", "always") in raised
    assert ("government-identifier", "always") in raised
    assert ("date-of-birth", "default-on") in raised
    assert ("home-address", "default-on") in raised
    assert ("personal-contact", "default-on") in raised


def test_the_always_set_is_withheld_where_every_switchable_rule_is_off(
    with_nothing_switchable_on: Redaction,
) -> None:

    redacted = with_nothing_switchable_on.text

    assert "00-00-00, account number 12345678" not in redacted
    assert "999 000 0018" not in redacted
    assert "cancer diagnosis" not in redacted

    assert redacted.count("[withheld]") == 7


def test_a_switchable_tier_that_is_off_leaves_its_spans_in_the_text(
    with_nothing_switchable_on: Redaction,
) -> None:

    redacted = with_nothing_switchable_on.text

    assert "3 February 1978" in redacted
    assert "14 Marlbrook Rise, Hensworth, NN12 3AB" in redacted
    assert A_CONSUMER_ADDRESS in redacted


def test_the_default_on_tier_writes_its_own_word_in_place_of_each_span(
    on_a_plain_binding: Redaction,
) -> None:

    redacted = on_a_plain_binding.text
    typed = typed_placeholders_under(THE_SAFE_SET)

    assert typed
    for placeholder, written in typed.items():
        assert redacted.count(placeholder) == written, placeholder
    assert A_CONSUMER_ADDRESS not in redacted


def test_a_job_title_stays_in_the_text_until_the_binding_switches_its_tier_on(
    on_a_plain_binding: Redaction, on_an_hr_shaped_binding: Redaction, page: str
) -> None:

    assert A_PLANTED_JOB_TITLE in spans_under(on_a_plain_binding, page, "job-title")
    assert tiers_of(on_a_plain_binding, page, A_PLANTED_JOB_TITLE) == {"default-off"}

    assert A_PLANTED_JOB_TITLE in on_a_plain_binding.text
    assert "[job title withheld]" not in on_a_plain_binding.text
    assert on_a_plain_binding.counts["job-title"] == 5

    assert A_PLANTED_JOB_TITLE not in on_an_hr_shaped_binding.text
    assert "[job title withheld]" in on_an_hr_shaped_binding.text
    assert on_an_hr_shaped_binding.counts["job-title"] == 5


def test_a_bare_date_is_not_a_finding_and_a_date_beside_date_of_birth_is(
    on_a_plain_binding: Redaction, page: str
) -> None:

    dates = spans_under(on_a_plain_binding, page, "date-of-birth")

    assert dates == [DATE_IN_CONTEXT]
    for bare in BARE_DATES:
        assert bare not in dates
        assert bare in on_a_plain_binding.text


def test_an_email_on_a_consumer_domain_is_personal_contact_and_a_company_one_is_not(
    on_a_plain_binding: Redaction, page: str
) -> None:

    contact = spans_under(on_a_plain_binding, page, "personal-contact")

    assert A_CONSUMER_ADDRESS in contact

    opened = page.index(A_COMPANY_ADDRESS)
    closed = opened + len(A_COMPANY_ADDRESS)

    assert [
        finding
        for finding in on_a_plain_binding.findings
        if finding.start < closed and opened < finding.end
    ] == []

    assert A_COMPANY_ADDRESS in on_a_plain_binding.text


def test_the_telephone_number_is_personal_contact_whatever_the_domain_rule_does(
    on_a_plain_binding: Redaction, page: str
) -> None:

    assert "07700 900123" in spans_under(on_a_plain_binding, page, "personal-contact")
    assert "07700 900123" not in on_a_plain_binding.text


def test_a_shouted_consumer_domain_is_still_the_same_domain() -> None:

    shouted = (
        "Her own address is R.PETHERIDGE@GMAIL.COM and the office takes enquiries at"
        " enquiries@meridianfenland.co.uk."
    )

    found = redact(
        shouted, spans_detected(shouted), THE_SAFE_SET, NO_SUPPRESSIONS, SEED
    )

    assert "R.PETHERIDGE@GMAIL.COM" not in found.text
    assert found.text.count("[personal contact withheld]") == 1
    assert "enquiries@meridianfenland.co.uk" in found.text


def test_a_health_cue_withholds_its_sentence_and_narrows_the_document(
    on_a_plain_binding: Redaction, page: str
) -> None:

    sentences = spans_under(on_a_plain_binding, page, "special-category")

    assert sentences == [A_HEALTH_SENTENCE]
    assert on_a_plain_binding.verdict == "Restricted"
    assert A_HEALTH_SENTENCE not in on_a_plain_binding.text


def test_an_ordinary_sentence_carrying_a_health_word_is_kept_on_every_binding(
    on_a_plain_binding: Redaction,
    with_nothing_switchable_on: Redaction,
    on_an_hr_shaped_binding: Redaction,
    page: str,
) -> None:

    opened = page.index(A_HEALTH_AND_SAFETY_SENTENCE)
    closed = opened + len(A_HEALTH_AND_SAFETY_SENTENCE)

    for found in (
        with_nothing_switchable_on,
        on_a_plain_binding,
        on_an_hr_shaped_binding,
    ):
        assert [
            finding
            for finding in found.findings
            if finding.start < closed and opened < finding.end
        ] == []
        assert A_HEALTH_AND_SAFETY_SENTENCE in found.text


def test_a_cue_is_the_lemma_of_the_word_a_document_wrote_and_not_its_spelling() -> None:

    cued = (
        "Sickness absence is logged by the site office.\n\n"
        "Her medications were changed in the spring.\n\n"
        "The framework agreement was signed on 14 March 2024."
    )

    found = redact(cued, spans_detected(cued), THE_SAFE_SET, NO_SUPPRESSIONS, SEED)

    assert "Sickness absence is logged by the site office." not in found.text
    assert "Her medications were changed in the spring." not in found.text
    assert "The framework agreement was signed on 14 March 2024." in found.text


def test_a_page_with_no_special_category_cue_narrows_nothing() -> None:

    uncued = "The framework agreement was signed on 14 March 2024."

    found = redact(uncued, spans_detected(uncued), THE_SAFE_SET, NO_SUPPRESSIONS, SEED)

    assert found.verdict is None
    assert [
        finding for finding in found.findings if finding.category == "special-category"
    ] == []


def test_a_sort_code_shaped_number_inside_a_code_fence_is_a_finding_today(
    on_a_plain_binding: Redaction, page: str
) -> None:

    assert FENCED_SORT_CODE in spans_under(on_a_plain_binding, page, "bank-details")


def test_the_redaction_carries_the_version_string_every_finding_rides_on(
    on_a_plain_binding: Redaction,
) -> None:
    assert on_a_plain_binding.version == VERSION_STRING


def test_a_name_passes_through_on_a_plain_binding_and_is_a_pseudonym_on_an_hr_one(
    on_a_plain_binding: Redaction, on_an_hr_shaped_binding: Redaction
) -> None:

    assert "Imogen Sarkar" in on_a_plain_binding.text
    assert "[person " not in on_a_plain_binding.text

    assert "Imogen Sarkar" not in on_an_hr_shaped_binding.text
    assert "[person Y]" in on_an_hr_shaped_binding.text


def test_the_same_name_is_the_same_letter_everywhere_in_one_binding(
    on_an_hr_shaped_binding: Redaction, page: str
) -> None:

    assert page.count("Imogen Sarkar") == 3
    assert on_an_hr_shaped_binding.text.count("[person Y]") == 3


def test_a_different_seed_gives_the_same_name_a_different_letter(
    on_an_hr_shaped_binding: Redaction, under_another_seed: Redaction
) -> None:

    for name, letter in LETTERS_UNDER_SEED.items():
        under_one = f"[person {letter}]"
        under_other = f"[person {LETTERS_UNDER_ANOTHER_SEED[name]}]"

        assert under_one != under_other
        assert under_one in on_an_hr_shaped_binding.text
        assert under_one not in under_another_seed.text
        assert under_other in under_another_seed.text


def test_a_name_inside_an_officers_block_is_withheld_with_its_block_whatever_the_rules(
    on_a_plain_binding: Redaction,
    on_an_hr_shaped_binding: Redaction,
    with_nothing_switchable_on: Redaction,
) -> None:

    for found in (
        on_a_plain_binding,
        on_an_hr_shaped_binding,
        with_nothing_switchable_on,
    ):
        block = officers_block(found.text)

        assert "Rosalind Petheridge" not in block
        assert "Callum Whitcombe" not in block
        assert "[person " not in block
        assert block.count("[withheld]") == 2


def test_the_same_name_outside_the_block_is_still_its_own_tier(
    on_a_plain_binding: Redaction, on_an_hr_shaped_binding: Redaction, page: str
) -> None:

    assert "Rosalind Petheridge" in past_the_officers_block(on_a_plain_binding.text)
    assert "[person U]" in past_the_officers_block(on_an_hr_shaped_binding.text)
    assert tiers_of(on_a_plain_binding, page, "Rosalind Petheridge") == {
        "always",
        "default-off",
    }


def test_a_signatory_named_inside_a_home_address_is_withheld_with_its_block(
    on_a_plain_binding: Redaction,
    with_nothing_switchable_on: Redaction,
    page: str,
) -> None:

    assert AN_ADDRESS_AROUND_A_NAME in spans_under(
        on_a_plain_binding, page, "home-address"
    )
    assert tiers_of(on_a_plain_binding, page, A_FOURTH_OFFICER) == {"always"}

    assert A_FOURTH_OFFICER not in on_a_plain_binding.text
    for end_of_the_address in A_STREET_AND_ITS_POSTCODE:
        assert end_of_the_address not in on_a_plain_binding.text

    (his_name,) = withholdings_over(on_a_plain_binding, page, A_FOURTH_OFFICER)
    (the_address,) = withholdings_over(
        on_a_plain_binding, page, AN_ADDRESS_AROUND_A_NAME
    )

    assert (his_name.withheld, how_written(on_a_plain_binding, his_name)) == (
        True,
        UNDER_ANOTHER_FINDINGS_PLACEHOLDER,
    )
    assert [
        (page[span.start : span.end], span.withholding)
        for span in on_a_plain_binding.written_spans
        if span.start < the_address.finding.end and the_address.finding.start < span.end
    ] == [(AN_ADDRESS_AROUND_A_NAME, the_address)]

    assert A_FOURTH_OFFICER not in with_nothing_switchable_on.text
    for end_of_the_address in A_STREET_AND_ITS_POSTCODE:
        assert end_of_the_address in with_nothing_switchable_on.text

    (under_no_address,) = withholdings_over(
        with_nothing_switchable_on, page, A_FOURTH_OFFICER
    )

    assert (
        under_no_address.withheld,
        how_written(with_nothing_switchable_on, under_no_address),
    ) == (True, UNDER_ITS_OWN_PLACEHOLDER)


def test_a_suppressed_name_is_withheld_and_every_other_name_is_untouched(
    on_an_hr_shaped_binding: Redaction, with_one_name_suppressed: Redaction
) -> None:

    assert "[person U]" in on_an_hr_shaped_binding.text
    assert "[person U]" not in with_one_name_suppressed.text

    for letter in ("E", "Y"):
        assert with_one_name_suppressed.text.count(
            f"[person {letter}]"
        ) == on_an_hr_shaped_binding.text.count(f"[person {letter}]")


def test_a_suppression_withholds_the_named_person_at_the_always_tier_and_rewrites_none(
    on_a_plain_binding: Redaction, with_one_name_suppressed: Redaction, page: str
) -> None:

    assert tiers_of(on_a_plain_binding, page, "Rosalind Petheridge") == {
        "always",
        "default-off",
    }
    assert tiers_of(with_one_name_suppressed, page, "Rosalind Petheridge") == {
        "always",
        "default-off",
    }

    assert withheld_tiers_of(with_one_name_suppressed, page, "Rosalind Petheridge") == {
        "always"
    }
    assert withheld_tiers_of(with_one_name_suppressed, page, "Imogen Sarkar") == {
        "default-off"
    }


def test_the_same_inputs_twice_give_identical_output(
    on_an_hr_shaped_binding: Redaction,
    page: str,
    spans: tuple[Span, ...],
) -> None:

    again = redact(page, spans, AN_HR_SHAPED_BINDING, NO_SUPPRESSIONS, SEED)

    assert again.text == on_an_hr_shaped_binding.text
    assert again.findings == on_an_hr_shaped_binding.findings
    assert again.withholdings == on_an_hr_shaped_binding.withholdings
    assert again.written_spans == on_an_hr_shaped_binding.written_spans
    assert again.counts == on_an_hr_shaped_binding.counts
    assert again.verdict == on_an_hr_shaped_binding.verdict
    assert again.version == on_an_hr_shaped_binding.version


THE_COMPANYS_OWN_ACCOUNT = "00-00-00, account number 12345678"


def restore_of(found: Redaction, page: str, span: str, tier: str = "always") -> Restore:
    (finding,) = [
        finding
        for finding in found.findings
        if finding.tier == tier and page[finding.start : finding.end] == span
    ]
    return Restore(rule_id=finding.rule_id, start=finding.start, end=finding.end)


def test_a_restored_span_is_left_in_the_text_and_is_still_the_finding_it_was(
    on_a_plain_binding: Redaction,
    page: str,
    spans: tuple[Span, ...],
) -> None:

    kept = restore_of(on_a_plain_binding, page, THE_COMPANYS_OWN_ACCOUNT)

    found = redact(page, spans, THE_SAFE_SET, NO_SUPPRESSIONS, SEED, [kept])

    assert THE_COMPANYS_OWN_ACCOUNT not in on_a_plain_binding.text
    assert THE_COMPANYS_OWN_ACCOUNT in found.text
    assert found.findings == on_a_plain_binding.findings
    assert found.counts == on_a_plain_binding.counts

    assert FENCED_SORT_CODE not in found.text


def test_a_restore_is_of_one_rules_span_and_another_rule_over_it_restores_nothing(
    on_a_plain_binding: Redaction,
    page: str,
    spans: tuple[Span, ...],
) -> None:

    kept = restore_of(on_a_plain_binding, page, THE_COMPANYS_OWN_ACCOUNT)
    under_another_rule = Restore(rule_id="UK_NHS", start=kept.start, end=kept.end)

    found = redact(
        page, spans, THE_SAFE_SET, NO_SUPPRESSIONS, SEED, [under_another_rule]
    )

    assert found.text == on_a_plain_binding.text


def test_an_unrestored_finding_over_the_same_characters_still_withholds_them(
    on_a_plain_binding: Redaction,
    page: str,
    spans: tuple[Span, ...],
) -> None:

    his_name = restore_of(on_a_plain_binding, page, A_FOURTH_OFFICER)

    under_the_address = redact(
        page, spans, THE_SAFE_SET, NO_SUPPRESSIONS, SEED, [his_name]
    )
    with_the_address_off = redact(
        page, spans, NOTHING_SWITCHABLE, NO_SUPPRESSIONS, SEED, [his_name]
    )

    assert A_FOURTH_OFFICER not in under_the_address.text
    assert A_FOURTH_OFFICER in with_the_address_off.text


def test_an_erasure_outranks_a_restore(
    on_an_hr_shaped_binding: Redaction,
    page: str,
    spans: tuple[Span, ...],
) -> None:

    in_the_block = restore_of(on_an_hr_shaped_binding, page, "Rosalind Petheridge")

    restored = redact(
        page, spans, AN_HR_SHAPED_BINDING, NO_SUPPRESSIONS, SEED, [in_the_block]
    )
    erased = redact(
        page, spans, AN_HR_SHAPED_BINDING, ONE_NAME_SUPPRESSED, SEED, [in_the_block]
    )

    assert "Rosalind Petheridge" in officers_block(restored.text)
    assert "Rosalind Petheridge" not in erased.text

    assert overridden_in(restored.withholdings) == ()
    assert [
        Restore(rule_id=finding.rule_id, start=finding.start, end=finding.end)
        for finding in overridden_in(erased.withholdings)
    ] == [in_the_block]


def test_the_withholding_names_the_first_of_the_five_reasons_that_holds(
    on_a_plain_binding: Redaction,
    on_an_hr_shaped_binding: Redaction,
    page: str,
    spans: tuple[Span, ...],
) -> None:

    kept = restore_of(on_a_plain_binding, page, THE_COMPANYS_OWN_ACCOUNT)
    in_the_block = restore_of(on_an_hr_shaped_binding, page, "Rosalind Petheridge")

    restored = redact(page, spans, THE_SAFE_SET, NO_SUPPRESSIONS, SEED, [kept])
    erased = redact(
        page, spans, AN_HR_SHAPED_BINDING, ONE_NAME_SUPPRESSED, SEED, [in_the_block]
    )

    assert reasons_over(on_a_plain_binding, page, THE_COMPANYS_OWN_ACCOUNT) == {
        IN_FORCE
    }
    assert reasons_over(on_a_plain_binding, page, A_PLANTED_JOB_TITLE) == {SWITCHED_OFF}
    assert reasons_over(restored, page, THE_COMPANYS_OWN_ACCOUNT) == {RESTORED}
    assert reasons_over(erased, page, "Rosalind Petheridge") == {
        OVERRIDDEN_BY_THE_ERASURE,
        AN_ERASURE,
    }

    assert {
        withholding.reason
        for found in (on_a_plain_binding, restored, erased)
        for withholding in found.withholdings
    } == {OVERRIDDEN_BY_THE_ERASURE, AN_ERASURE, RESTORED, SWITCHED_OFF, IN_FORCE}


def test_the_seam_answers_one_withholding_for_each_finding_in_the_order_it_raised_them(
    on_a_plain_binding: Redaction,
    with_nothing_switchable_on: Redaction,
    with_one_name_suppressed: Redaction,
) -> None:

    for found in (
        on_a_plain_binding,
        with_nothing_switchable_on,
        with_one_name_suppressed,
    ):
        assert found.findings
        assert [one.finding for one in found.withholdings] == list(found.findings)


def test_a_restore_moves_neither_the_counts_nor_the_verdict_the_findings_give(
    on_a_plain_binding: Redaction,
    page: str,
    spans: tuple[Span, ...],
) -> None:

    kept = restore_of(on_a_plain_binding, page, A_HEALTH_SENTENCE)

    found = redact(page, spans, THE_SAFE_SET, NO_SUPPRESSIONS, SEED, [kept])

    assert A_HEALTH_SENTENCE not in on_a_plain_binding.text
    assert A_HEALTH_SENTENCE in found.text
    assert found.verdict == "Restricted"
    assert found.counts["special-category"] == 1
    assert found.counts == on_a_plain_binding.counts


@pytest.fixture(scope="module")
def service_notes() -> str:
    return SERVICE_NOTES_PAGE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def service_spans(service_notes: str) -> tuple[Span, ...]:
    return spans_detected(service_notes)


def health_findings_on(found: Redaction) -> list[tuple[int, int]]:
    return [
        (finding.start, finding.end)
        for finding in found.findings
        if finding.category == "special-category"
    ]


def dismissal_at(at: tuple[int, int]) -> Dismissal:
    return Dismissal(rule_id="HEALTH_CUE", start=at[0], end=at[1])


def test_a_health_cue_in_the_verb_form_withholds_its_sentence_and_narrows_the_page(
    service_notes: str, service_spans: tuple[Span, ...]
) -> None:
    start, end = THE_DIAGNOSED_SENTENCE_AT

    found = redact(service_notes, service_spans, THE_SAFE_SET, NO_SUPPRESSIONS, SEED)

    assert service_notes[start:end] == A_VERB_FORM_HEALTH_SENTENCE
    assert THE_DIAGNOSED_SENTENCE_AT in health_findings_on(found)
    assert [
        (withholding.tier, withholding.withheld)
        for withholding in withholdings_over(
            found, service_notes, A_VERB_FORM_HEALTH_SENTENCE
        )
    ] == [("always", True)]
    assert A_VERB_FORM_HEALTH_SENTENCE not in found.text
    assert found.verdict == "Restricted"


def test_the_verb_withholds_an_engineers_diagnosis_of_a_fault_too(
    service_notes: str, service_spans: tuple[Span, ...]
) -> None:
    start, end = THE_ENGINEERS_SENTENCE_AT

    found = redact(service_notes, service_spans, THE_SAFE_SET, NO_SUPPRESSIONS, SEED)

    assert service_notes[start:end] == AN_ENGINEERING_DIAGNOSIS
    assert health_findings_on(found) == [
        THE_ENGINEERS_SENTENCE_AT,
        THE_DIAGNOSED_SENTENCE_AT,
    ]
    assert AN_ENGINEERING_DIAGNOSIS not in found.text


def test_dismissing_every_special_category_finding_lifts_the_verdict_and_nothing_else(
    service_notes: str, service_spans: tuple[Span, ...]
) -> None:
    standing = redact(service_notes, service_spans, THE_SAFE_SET, NO_SUPPRESSIONS, SEED)

    found = redact(
        service_notes,
        service_spans,
        THE_SAFE_SET,
        NO_SUPPRESSIONS,
        SEED,
        dismissals=[
            dismissal_at(THE_ENGINEERS_SENTENCE_AT),
            dismissal_at(THE_DIAGNOSED_SENTENCE_AT),
        ],
    )

    assert (standing.verdict, standing.lifted) == ("Restricted", False)
    assert (found.verdict, found.lifted) == (None, True)
    assert found.text == standing.text
    assert found.findings == standing.findings
    assert found.counts == standing.counts


def test_a_dismissal_that_leaves_one_special_category_finding_standing_lifts_nothing(
    service_notes: str, service_spans: tuple[Span, ...]
) -> None:

    found = redact(
        service_notes,
        service_spans,
        THE_SAFE_SET,
        NO_SUPPRESSIONS,
        SEED,
        dismissals=[dismissal_at(THE_ENGINEERS_SENTENCE_AT)],
    )

    assert (found.verdict, found.lifted) == ("Restricted", False)


def test_dismissing_an_engineers_diagnosis_lifts_its_page_and_keeps_it_withheld() -> (
    None
):
    section = the_engineers_section()
    spans = spans_detected(section)
    start, end = THE_ENGINEERS_SENTENCE_AT

    standing = redact(section, spans, THE_SAFE_SET, NO_SUPPRESSIONS, SEED)
    dismissed = redact(
        section,
        spans,
        THE_SAFE_SET,
        NO_SUPPRESSIONS,
        SEED,
        dismissals=[dismissal_at(THE_ENGINEERS_SENTENCE_AT)],
    )

    assert section[start:end] == AN_ENGINEERING_DIAGNOSIS
    assert health_findings_on(standing) == [THE_ENGINEERS_SENTENCE_AT]
    assert (standing.verdict, dismissed.verdict, dismissed.lifted) == (
        "Restricted",
        None,
        True,
    )
    assert AN_ENGINEERING_DIAGNOSIS not in dismissed.text


def test_a_span_both_kept_and_dismissed_is_back_in_the_text_and_lifts_the_verdict(
    service_notes: str, service_spans: tuple[Span, ...]
) -> None:
    both = [THE_ENGINEERS_SENTENCE_AT, THE_DIAGNOSED_SENTENCE_AT]

    found = redact(
        service_notes,
        service_spans,
        THE_SAFE_SET,
        NO_SUPPRESSIONS,
        SEED,
        [Restore(rule_id="HEALTH_CUE", start=start, end=end) for start, end in both],
        [dismissal_at(at) for at in both],
    )

    assert AN_ENGINEERING_DIAGNOSIS in found.text
    assert A_VERB_FORM_HEALTH_SENTENCE in found.text
    assert (found.verdict, found.lifted) == (None, True)


def test_a_dismissal_under_another_rule_dismisses_nothing(
    service_notes: str, service_spans: tuple[Span, ...]
) -> None:
    start, end = THE_ENGINEERS_SENTENCE_AT
    both = [
        Dismissal(rule_id="UK_NHS", start=start, end=end),
        dismissal_at(THE_DIAGNOSED_SENTENCE_AT),
    ]

    found = redact(
        service_notes,
        service_spans,
        THE_SAFE_SET,
        NO_SUPPRESSIONS,
        SEED,
        dismissals=both,
    )

    assert (found.verdict, found.lifted) == ("Restricted", False)


def test_a_keep_lets_a_health_sentence_back_in_and_lifts_nothing(
    service_notes: str, service_spans: tuple[Span, ...]
) -> None:
    kept = [
        Restore(rule_id="HEALTH_CUE", start=start, end=end)
        for start, end in (THE_ENGINEERS_SENTENCE_AT, THE_DIAGNOSED_SENTENCE_AT)
    ]

    found = redact(
        service_notes, service_spans, THE_SAFE_SET, NO_SUPPRESSIONS, SEED, kept
    )

    assert AN_ENGINEERING_DIAGNOSIS in found.text
    assert (found.verdict, found.lifted) == ("Restricted", False)


def test_a_page_that_raises_no_special_category_finding_is_never_lifted() -> None:
    text = "The sort code is 00-00-00 and the account number is 12345678."

    found = redacted_over(
        text,
        [("UK_BANK_ACCOUNT", "00-00-00 and the account number is 12345678")],
        THE_SAFE_SET,
    )

    assert (found.verdict, found.lifted) == (None, False)


def test_each_withheld_character_lies_under_one_written_span_and_a_kept_one_writes_none(
    on_a_plain_binding: Redaction,
    with_nothing_switchable_on: Redaction,
    on_an_hr_shaped_binding: Redaction,
    under_another_seed: Redaction,
    with_one_name_suppressed: Redaction,
    with_a_partial_overlap: Redaction,
) -> None:

    for found in (
        on_a_plain_binding,
        with_nothing_switchable_on,
        on_an_hr_shaped_binding,
        under_another_seed,
        with_one_name_suppressed,
        with_a_partial_overlap,
    ):
        assert found.written_spans
        for span in found.written_spans:
            finding = span.withholding.finding
            assert span.withholding in found.withholdings, span
            assert span.withholding.withheld, span
            assert finding.start <= span.start < span.end <= finding.end, span
        for withholding in found.withholdings:
            finding = withholding.finding
            if withholding.withheld:
                assert [
                    offset
                    for offset in range(finding.start, finding.end)
                    if len(written_over(found, offset)) != 1
                ] == [], (withholding.reason, finding)


def test_a_loser_of_a_partial_overlap_gives_up_only_the_characters_the_winner_takes(
    with_a_partial_overlap: Redaction,
) -> None:

    the_address, the_phone = with_a_partial_overlap.withholdings

    assert [
        (span.start, span.end, span.withholding)
        for span in with_a_partial_overlap.written_spans
    ] == [(9, 40, the_address), (40, 58, the_phone)]
    assert [
        (one.finding.category, one.tier, one.finding.rule_id)
        for one in (the_address, the_phone)
    ] == [
        ("home-address", "default-on", "UK_HOME_ADDRESS"),
        ("personal-contact", "default-on", "PHONE_NUMBER"),
    ]
    assert with_a_partial_overlap.text == (
        "Write to [home address withheld][personal contact withheld] today"
    )


def test_a_trimmed_loser_is_still_the_finding_it_was_raised_as(
    with_a_partial_overlap: Redaction,
) -> None:

    the_address = Finding(
        category="home-address",
        tier="default-on",
        rule_id="UK_HOME_ADDRESS",
        start=9,
        end=40,
        score=0.9,
    )
    the_phone = Finding(
        category="personal-contact",
        tier="default-on",
        rule_id="PHONE_NUMBER",
        start=33,
        end=58,
        score=0.9,
    )

    assert with_a_partial_overlap.findings == (the_address, the_phone)
    assert with_a_partial_overlap.withholdings == (
        Withholding(the_address, withheld=True, tier="default-on", reason=IN_FORCE),
        Withholding(the_phone, withheld=True, tier="default-on", reason=IN_FORCE),
    )
    assert with_a_partial_overlap.counts == {"home-address": 1, "personal-contact": 1}
    assert with_a_partial_overlap.verdict is None
    assert overridden_in(with_a_partial_overlap.withholdings) == ()


@pytest.mark.parametrize(
    ("text", "claims", "written"),
    [
        pytest.param(
            "From 12 Acacia Avenue, Leeds LS1 4AB tel 0113 496 0000"
            " to 9 Kestrel Lane, Wetherby LS22 4TD",
            (
                ("UK_HOME_ADDRESS", "12 Acacia Avenue, Leeds LS1 4AB"),
                ("PHONE_NUMBER", "LS1 4AB tel 0113 496 0000 to 9"),
                ("UK_HOME_ADDRESS", "9 Kestrel Lane, Wetherby LS22 4TD"),
            ),
            [
                ("12 Acacia Avenue, Leeds LS1 4AB", "UK_HOME_ADDRESS"),
                (" tel 0113 496 0000 to ", "PHONE_NUMBER"),
                ("9 Kestrel Lane, Wetherby LS22 4TD", "UK_HOME_ADDRESS"),
            ],
            id="beaten on both sides",
        ),
        pytest.param(
            A_PARTIAL_OVERLAP,
            (
                ("UK_HOME_ADDRESS", "12 Acacia Avenue, Leeds LS1 4AB"),
                ("PHONE_NUMBER", "LS1 4AB tel 0113 496 0000"),
                ("UK_HOME_ADDRESS", "Leeds LS1 4AB tel"),
            ),
            [
                ("12 Acacia Avenue, Leeds LS1 4AB", "UK_HOME_ADDRESS"),
                (" tel 0113 496 0000", "PHONE_NUMBER"),
            ],
            id="covered by two winners between them",
        ),
        pytest.param(
            "NHS number 943 476 5919 on file",
            (("UK_NHS", "943 476 5919"), ("PHONE_NUMBER", "943 476 5919")),
            [("943 476 5919", "UK_NHS")],
            id="the same run claimed by two rules",
        ),
    ],
)
def test_a_loser_is_written_over_what_its_winners_leave_and_nowhere_if_they_leave_none(
    text: str, claims: tuple[tuple[str, str], ...], written: list[tuple[str, str]]
) -> None:

    found = redacted_over(text, claims, THE_SAFE_SET)

    assert written_runs(found, text) == written


@pytest.mark.parametrize(
    "inside",
    [
        pytest.param((("PERSON", "Imogen Sarkar"),), id="a finding inside it"),
        pytest.param(
            (("PERSON", "Imogen Sarkar"), ("PERSON", "Sarkar")),
            id="a finding inside a finding inside it",
        ),
    ],
)
def test_a_finding_inside_a_losing_container_is_withheld_under_what_the_container_keeps(
    inside: tuple[tuple[str, str], ...],
) -> None:

    text = AN_ADDRESS_THE_BANK_RULE_RAN_INTO
    claims = (
        ("UK_HOME_ADDRESS", "Imogen Sarkar, 12 Acacia Avenue, Leeds LS1 4AB"),
        *inside,
        ("UK_BANK_ACCOUNT", "4AB 20-45-77 41234567"),
    )

    found = redacted_over(text, claims, AN_HR_SHAPED_BINDING)

    assert written_runs(found, text) == [
        ("Imogen Sarkar, 12 Acacia Avenue, Leeds LS1 ", "UK_HOME_ADDRESS"),
        ("4AB 20-45-77 41234567", "UK_BANK_ACCOUNT"),
    ]
    assert [
        (one.withheld, how_written(found, one))
        for one in found.withholdings
        if one.finding.rule_id == "PERSON"
    ] == [(True, UNDER_ANOTHER_FINDINGS_PLACEHOLDER)] * len(inside)
    assert found.text == "Pay [home address withheld][withheld] today"


def test_a_name_that_lost_part_of_its_run_is_written_with_the_whole_names_letter() -> (
    None
):

    text = (
        "Imogen Sarkar asked Rosalind Petheridge to write to"
        " Imogen Sarkar, 9 Kestrel Lane, Wetherby LS22 4TD"
    )
    again = text.rindex("Imogen Sarkar")
    spans = (
        span_over(text, "PERSON", "Imogen Sarkar"),
        span_over(text, "PERSON", "Rosalind Petheridge"),
        Span(
            rule_id="PERSON", start=again, end=again + len("Imogen Sarkar"), score=0.9
        ),
        span_over(text, "UK_HOME_ADDRESS", "Sarkar, 9 Kestrel Lane, Wetherby LS22 4TD"),
    )

    found = redact(text, spans, AN_HR_SHAPED_BINDING, NO_SUPPRESSIONS, SEED)

    assert written_runs(found, text) == [
        ("Imogen Sarkar", "PERSON"),
        ("Rosalind Petheridge", "PERSON"),
        ("Imogen ", "PERSON"),
        ("Sarkar, 9 Kestrel Lane, Wetherby LS22 4TD", "UK_HOME_ADDRESS"),
    ]
    assert found.text == (
        "[person U] asked [person E] to write to [person U][home address withheld]"
    )
